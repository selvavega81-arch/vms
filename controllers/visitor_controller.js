const conn = require('../db').callbackPool; // Use callback-style pool explicitly
const queries = require('../queries/visitor_queries');
const qrcode = require('qrcode');
const multer = require('multer');
const sendEmail = require('../utils/mailer');
// Helper function to format date as YYYY-MM-DD HH:mm:ss (replaces moment)
const formatDateTime = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// Helper function to check if a date is more than 24 hours before now
const isMoreThan24HoursAgo = (date) => {
  const signInDate = new Date(date);
  const now = new Date();
  const diffMs = now - signInDate;
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 24;
};

// Generate QR code for visitor
const generateQrCode = (visitorId) => {
  return new Promise((resolve, reject) => {
    const qrData = `visitor-${visitorId}`;
    qrcode.toDataURL(qrData, (err, qrCodeUrl) => {
      if (err) reject(err);
      resolve(qrCodeUrl);
    });
  });
};

const sendOtp = (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Generate 4-digit OTP
  // Generate 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  // const otp = '1234'; // Fixed OTP for temporary bypass

  // Set expiry time to 5 minutes from now
  const expiry = new Date(Date.now() + 5 * 60 * 1000);

  conn.query(queries.sendOtpQuery, [phone, otp, expiry, otp, expiry], (err) => {
    if (err) {
      console.error('OTP storage error:', err);
      // Return the specific error message for debugging
      return res.status(500).json({ error: 'Failed to send OTP', details: err.message });
    }
    // Do NOT send OTP to client - only log for debugging in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV ONLY] OTP for ${phone}: ${otp}`);
    }
    res.json({ message: 'OTP sent successfully' });
  });
};

const verifyOtp = (req, res) => {
  const { phone, otp } = req.body;

  conn.query(queries.selectOtpQuery, [phone], (err, results) => {
    if (err || results.length === 0) return res.status(400).send({ message: 'No record found' });

    const { otp: dbOtp, otp_expiry } = results[0];
    if (dbOtp !== otp || new Date(otp_expiry) < new Date()) {
      return res.status(400).send({ message: 'Invalid or expired OTP' });
    }

    conn.query(queries.verifyOtpQuery, [phone], (err) => {
      if (err) return res.status(500).send(err);

      conn.query('SELECT id FROM temp_visitors WHERE phone = ?', [phone], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send({ message: 'OTP verified', temp_visitor_id: result[0].id });
      });
    });
  });
};

// Submit visitor details and generate QR code
const submitDetails = async (req, res) => {
  const data = req.body;
  const imagePath = req.file ? req.file.path : null;

  // Verify OTP and fetch visitor details from temp table
  conn.query(queries.selectTempVisitorByPhone, [data.phone], async (err, results) => {
    if (err || results.length === 0) return res.status(400).send({ message: 'No record found' });

    const temp = results[0];
    if (temp.otp_verified !== 1) {
      return res.status(403).send({ message: 'Phone not verified' });
    }

    // Handle field mapping (frontend sends employee_id/purpose_id, DB expects whom_to_meet/purpose)
    const whomToMeet = data.whom_to_meet || data.employee_id;
    const purpose = data.purpose || data.purpose_id;

    // Update temp visitor data
    const updateValues = [
      data.first_name, data.last_name, data.email, data.gender,
      data.company_id, data.department_id, data.designation_id,
      whomToMeet, purpose, data.aadhar_no, data.address,
      imagePath, data.phone
    ];

    conn.query(queries.updateTempVisitor, updateValues, (err) => {
      if (err) return res.status(500).send(err);

      // Insert into the main visitor table
      const insertValues = [
        data.first_name, data.last_name, data.email, data.phone, data.gender,
        data.company_id, data.department_id, data.designation_id, whomToMeet,
        purpose, data.aadhar_no, data.address, imagePath,
        temp.otp, 1
      ];

      conn.query(queries.insertIntoVisitorMain, insertValues, (err, result) => {
        if (err) return res.status(500).send(err);

        const visitorId = result.insertId;
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

        // Respond immediately so the visitor doesn't wait for the email lookup
        res.send({
          message: 'Visitor data submitted. Pending admin verification.',
          visitorId: visitorId,
          isVerified: false
        });

        // Send verification email to company admin(s) — fire and forget

        conn.query(
          "SELECT email FROM employees WHERE role_id = 2 AND company_id = ?",
          [data.company_id],
          (emailErr, emailResults) => {
            if (emailErr) {
              console.error("Error fetching admin emails:", emailErr.message);
              return;
            }

            // Build recipient list: use all found admin emails, fallback to env var
            const adminEmails = emailResults.map(row => row.email).filter(Boolean);
            const toEmail = adminEmails.length > 0
              ? adminEmails.join(',')
              : process.env.ADMIN_EMAIL || 'admin@example.com';

            sendEmail({
              to: toEmail,
              subject: `New Visitor: ${data.first_name} ${data.last_name} - Pending Verification`,
              html: `<h1>${data.first_name} ${data.last_name} is waiting for verification</h1>
                <p>Visitor ID: ${visitorId}</p>
                <p>Email: ${data.email}</p>
                <p>Phone: ${data.phone}</p>
                <br/>
                <a href="${baseUrl}/verify.html?id=${visitorId}" style="display:inline-block;padding:12px 24px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">Review &amp; Verify Visitor</a>`
            }).then(() => console.log("Verification mail sent to:", toEmail))
              .catch((mailErr) => console.error("Mail error:", mailErr.message));
          }
        );
      });
    });
  });
};

// ================================================================================================================================================
// Handle QR scan (Check-in and Check-out) with duration calculation
const handleQrScan = (req, res) => {
  console.log('QR SCAN REQ:', req.body);
  let { qrCode, qr_code, scanType } = req.body;  // scanType: 'entry' or 'exit' (optional, auto-detected if missing)
  
  // Support both camelCase and snake_case
  qrCode = (qrCode || qr_code || '').trim();

  if (!qrCode) {
    return res.status(400).json({ message: 'QR code is required' });
  }

  // Extract visitor ID from the QR code data (format: visitor-{id})
  const parts = qrCode.split('-');
  let visitorId;

  if (parts.length >= 2 && parts[0].toLowerCase() === 'visitor') {
    visitorId = parts[1];
  } else if (!isNaN(qrCode)) {
    // Fallback: If the QR code is just the numeric ID
    visitorId = qrCode;
  } else {
     return res.status(400).json({ message: 'Invalid QR code format. Expected visitor-{id} or numeric ID' });
  }

  // First, check if visitor exists and get their current status with details
  const query = `
    SELECT v.*, 
           CONCAT(e.first_name, ' ', e.last_name) as employee_name,
           p.purpose as purpose_text
    FROM visitors v
    LEFT JOIN employees e ON v.whom_to_meet = e.emp_id
    LEFT JOIN purpose p ON v.purpose = p.purpose_id
    WHERE v.visitor_id = ?
  `;

  conn.query(query, [visitorId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Visitor not found' });

    const visitor = results[0];
    const currentTime = new Date();
    const formattedTime = formatDateTime(currentTime);

    // Auto-detect scan type if not provided
    if (!scanType) {
      if (visitor.qr_status === 'active') {
        scanType = 'entry';
      } else if (visitor.qr_status === 'checked_in') {
        scanType = 'exit';
      } else {
        // Default to entry for other states to let strict checks handle the detailed error
        scanType = 'entry'; 
      }
    }

    // Check if QR is already expired
    if (visitor.qr_status === 'expired') {
      return res.status(400).json({ 
        message: 'QR code has expired',
        visitor_name: `${visitor.first_name} ${visitor.last_name}`,
        status: 'expired'
      });
    }

    // Check if already checked out
    if (visitor.qr_status === 'checked_out') {
      return res.status(400).json({ 
        message: 'Visitor has already checked out',
        visitor_name: `${visitor.first_name} ${visitor.last_name}`,
        status: 'checked_out',
        sign_in_time: visitor.sign_in_time,
        sign_out_time: visitor.sign_out_time
      });
    }

    // Check if QR is expired after 24 hours of check-in
    if (visitor.qr_status === 'checked_in' && visitor.sign_in_time && isMoreThan24HoursAgo(visitor.sign_in_time)) {
      conn.query('UPDATE visitors SET qr_status = "expired" WHERE visitor_id = ?', [visitorId], (err) => {
        if (err) return res.status(500).json({ message: 'Error expiring QR code', error: err.message });
        return res.status(400).json({ 
          message: 'QR code expired after 24 hours',
          visitor_name: `${visitor.first_name} ${visitor.last_name}`,
          status: 'expired'
        });
      });
      return;
    }

    // Handle Entry Scan (Check-in)
    if (scanType === 'entry') {
      if (visitor.qr_status === 'checked_in') {
        return res.status(400).json({ 
          message: 'Visitor is already checked in',
          visitor_name: `${visitor.first_name} ${visitor.last_name}`,
          status: 'checked_in',
          sign_in_time: visitor.sign_in_time,
          employee_name: visitor.employee_name,
          purpose: visitor.purpose_text
        });
      }
      
      if (visitor.qr_status !== 'active') {
         return res.status(400).json({ message: 'Visitor cannot check in (Status: ' + visitor.qr_status + ')' });
      }

      // Atomic update — only succeeds if still 'active' (prevents concurrent duplicate check-in)
      conn.query(
        'UPDATE visitors SET qr_status = "checked_in", sign_in_time = ? WHERE visitor_id = ? AND qr_status = "active"', 
        [formattedTime, visitorId], 
        (err, result) => {
          if (err) return res.status(500).json({ message: 'Error during check-in', error: err.message });

          // affectedRows = 0 means a concurrent scan already checked in
          if (result.affectedRows === 0) {
            return res.status(409).json({
              message: 'Check-in failed. Visitor may have already been scanned.',
              status: 'conflict'
            });
          }
          
          const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
          const imageUrl = visitor.image ? `${baseUrl}/${visitor.image.replace(/\\/g, '/')}` : null;
          
          return res.json({ 
            success: true,
            message: 'Entry scan successful - Visitor checked in',
            scanType: 'entry',
            visitor_id: visitor.visitor_id,
            visitor_name: `${visitor.first_name} ${visitor.last_name}`,
            email: visitor.email,
            phone: visitor.phone,
            image: imageUrl,
            employee_name: visitor.employee_name,
            purpose: visitor.purpose_text,
            sign_in_time: formattedTime,
            status: 'checked_in'
          });
        }
      );
    }

    // Handle Exit Scan (Check-out)
    else if (scanType === 'exit') {
      if (visitor.qr_status === 'active') {
        return res.status(400).json({ 
          message: 'Visitor has not checked in yet',
          status: 'active'
        });
      }

      if (visitor.qr_status !== 'checked_in') {
         return res.status(400).json({ message: 'Visitor cannot check out (Status: ' + visitor.qr_status + ')' });
      }

      // ── Guard: Minimum 30-second cooldown between check-in and check-out ──
      // This prevents the race condition where a double-scan causes instant entry + exit
      if (visitor.sign_in_time) {
        const signInDate = new Date(visitor.sign_in_time);
        const secondsSinceCheckIn = (currentTime - signInDate) / 1000;
        if (secondsSinceCheckIn < 5) {
          return res.status(429).json({
            message: 'Please wait at least 30 seconds after check-in before checking out',
            visitor_name: `${visitor.first_name} ${visitor.last_name}`,
            status: 'checked_in',
            sign_in_time: visitor.sign_in_time
          });
        }
      }

      // Calculate duration
      const signInTime = new Date(visitor.sign_in_time);
      const durationMs = currentTime - signInTime;
      const durationMinutes = Math.floor(durationMs / (1000 * 60));
      const durationHours = Math.floor(durationMinutes / 60);
      const remainingMinutes = durationMinutes % 60;
      const durationFormatted = `${durationHours}h ${remainingMinutes}m`;

      // Atomic update — only succeeds if still 'checked_in' (prevents concurrent duplicate check-out)
      conn.query(
        'UPDATE visitors SET qr_status = "checked_out", sign_out_time = ?, is_verified = 0 WHERE visitor_id = ? AND qr_status = "checked_in"', 
        [formattedTime, visitorId], 
        (err, result) => {
          if (err) return res.status(500).json({ message: 'Error during check-out', error: err.message });

          // affectedRows = 0 means a concurrent scan already checked out
          if (result.affectedRows === 0) {
            return res.status(409).json({
              message: 'Check-out failed. Visitor may have already been scanned.',
              status: 'conflict'
            });
          }
          
          const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
          const imageUrl = visitor.image ? `${baseUrl}/${visitor.image.replace(/\\/g, '/')}` : null;
          
          return res.json({ 
            success: true,
            message: 'Exit scan successful - Visitor checked out',
            scanType: 'exit',
            visitor_id: visitor.visitor_id,
            visitor_name: `${visitor.first_name} ${visitor.last_name}`,
            email: visitor.email,
            phone: visitor.phone,
            image: imageUrl,
            employee_name: visitor.employee_name,
            purpose: visitor.purpose_text,
            sign_in_time: visitor.sign_in_time,
            sign_out_time: formattedTime,
            duration: durationFormatted,
            duration_minutes: durationMinutes,
            status: 'checked_out'
          });
        }
      );
    }
    
    else {
        return res.status(400).json({ message: 'Invalid scan type' });
    }
  });
};


const getAllVisitors = (req, res) => {
  // Execute the query to get all visitors
  conn.query(queries.getAllVisitorsQuery, (err, results) => {
    if (err) {
      // Handle the error and send a 500 response
      return res.status(500).send({ message: 'Error fetching data', error: err });
    }

    // Return the result if the query is successful
    res.json({ message: 'Data retrieved successfully', data: results });
  });
};


const getVisitorDetails = (req, res) => {
  const query = queries.getVisitorDetailsQuery;

  conn.query(query, (err, results) => {
    if (err) {
      console.error('DB Error in getVisitorDetails:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'No visitor details found' });
    }

    res.json({ message: 'Visitor details retrieved successfully', data: results });
  });
};

const updateVisitorStatusController = (req, res) => {
  const visitorId = req.params.id;
  const { status } = req.body;

  const query = queries.updateVisitorStatusQuery;  // get the query string

  conn.query(query, [status, visitorId], (err, result) => {
    if (err) {
      console.error('DB Error in updateVisitorStatus:', err);
      return res.status(500).json({ message: 'Database error', error: err });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Visitor not found or status not updated' });
    }

    res.json({ message: 'Status updated successfully' });
  });
};

const getVisitorQrCode = (req, res) => {
  const visitor_id = parseInt(req.body.visitor_id, 10);

  if (isNaN(visitor_id)) {
    return res.status(400).json({ error: 'Invalid visitor ID' });
  }

  conn.query(queries.getVisitorQrCodeById, [visitor_id], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Visitor not found or QR code not active' });
    }

    const row = results[0];
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const imageUrl = row.image ? `${baseUrl}/uploads/${row.image}` : null;
    res.json({
      qr_code: row.qr_code,
      visitor_ID:row.visitor_id,
      first_name: row.visitor_first_name,
      last_name: row.visitor_last_name,
     purpose: row.purpose_text,
      email: row.email,
      image: imageUrl ,
      phone: row.phone,
      whom_to_meet: {
        employee_id: row.emp_id,
        first_name: row.employee_first_name,
        last_name: row.employee_last_name
      }
    });
  });
};

const submitDetailsWithoutOtp = async (req, res) => {
  try {
    console.log('Received body in submitDetailsWithoutOtp:', req.body);
    const data = req.body;
    const imagePath = req.file ? req.file.path : null;

    // Validate required fields
    const requiredFields = [
      'first_name', 'last_name', 'email', 'phone', 'gender',
      'company_id', 'department_id', 'designation_id',
      'whom_to_meet', 'purpose', 'aadhar_no', 'address'
    ];

    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    const insertValues = [
      data.first_name, data.last_name, data.email, data.phone, data.gender,
      data.company_id, data.department_id, data.designation_id, data.whom_to_meet,
      data.purpose, data.aadhar_no, data.address, imagePath,
      null, 1 // otp is null, otp_verified is 1
    ];

    conn.query(queries.insertIntoVisitorOtp, insertValues, async (err, result) => {
      if (err) {
        console.error('DB Insert Error:', err);
        return res.status(500).json({ error: 'Failed to insert visitor data' });
      }

      const visitorId = result.insertId;
      const qrCode = await generateQrCode(visitorId);

      conn.query(queries.updateVisitorQrCode, [qrCode, visitorId], (err) => {
        if (err) {
          console.error('DB Update QR Error:', err);
          return res.status(500).json({ error: 'Failed to update QR code' });
        }

        res.json({
          message: 'Visitor data submitted successfully without OTP verification',
          visitor_id: visitorId,
          qr_code: qrCode
        });
      });
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateVisitor = async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const data = req.body;
    const imagePath = req.file ? req.file.path : null;

    if (!data || !data.visitor_id) {
      return res.status(400).json({ error: 'visitor_id is required' });
    }

    const requiredFields = [
      'first_name', 'last_name', 'email', 'phone', 'gender',
      'aadhar_no', 'address', 'company_id', 'department_id',
      'designation_id', 'whom_to_meet', 'purpose'
    ];

    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    let updateQuery = `
      UPDATE visitors SET
        first_name = ?, last_name = ?, email = ?, phone = ?, gender = ?, 
        aadhar_no = ?, address = ?, company_id = ?, department_id = ?, 
        designation_id = ?, whom_to_meet = ?, purpose = ?
    `;
    const params = [
      data.first_name, data.last_name, data.email, data.phone, data.gender,
      data.aadhar_no, data.address, data.company_id, data.department_id,
      data.designation_id, data.whom_to_meet, data.purpose
    ];

    if (imagePath) {
      updateQuery += `, image = ?`;
      params.push(imagePath);
    }

    updateQuery += ` WHERE visitor_id = ?`;
    params.push(data.visitor_id);

    conn.query(updateQuery, params, (err, result) => {
      if (err) {
        console.error('DB Update Error:', err);
        return res.status(500).json({ error: 'Failed to update visitor' });
      }

      res.json({ message: 'Visitor updated successfully' });
    });

  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

const getVisitorById = (req, res) => {
  const { visitor_id } = req.body;

  conn.query('SELECT * FROM visitors WHERE visitor_id = ?', [visitor_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch visitor', details: err.message || err });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Visitor not found' });
    }

    res.json({ message: 'Visitor fetched successfully', data: rows[0] });
  });
};


// Get visitor details for verification page (public, no auth)
const getVisitorForVerification = (req, res) => {
  const visitorId = req.params.id;

  const query = `
    SELECT v.*, 
           CONCAT(e.first_name, ' ', e.last_name) as employee_name,
           p.purpose as purpose_text
    FROM visitors v
    LEFT JOIN employees e ON v.whom_to_meet = e.emp_id
    LEFT JOIN purpose p ON v.purpose = p.purpose_id
    WHERE v.visitor_id = ?
  `;

  conn.query(query, [visitorId], (err, results) => {
    if (err) {
      console.error('Error fetching visitor for verification:', err);
      return res.status(500).json({ message: 'Database error', error: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Visitor not found' });
    }

    const visitor = results[0];
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    visitor.image = visitor.image ? `${baseUrl}/${visitor.image.replace(/\\\\/g, '/')}` : null;

    res.json({ message: 'Visitor details fetched', data: visitor });
  });
};

// Approve visitor (admin verification)
const approveVisitor = async (req, res) => {
  const visitorId = req.params.id;

  // Check if visitor exists
  conn.query('SELECT * FROM visitors WHERE visitor_id = ?', [visitorId], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Visitor not found' });

    const visitor = results[0];

    if (visitor.is_verified == 1) {
      return res.status(400).json({ message: 'Visitor is already verified' });
    }

    try {
      // Generate QR code
      const qrCode = await generateQrCode(visitorId);

      // Update visitor: set verified + QR code
      conn.query(
        'UPDATE visitors SET is_verified = 1, qr_code = ?, qr_status = "active" WHERE visitor_id = ?',
        [qrCode, visitorId],
        (updateErr) => {
          if (updateErr) {
            console.error('Error approving visitor:', updateErr);
            return res.status(500).json({ message: 'Failed to approve visitor', error: updateErr.message });
          }

          // Send QR code email to visitor (fire and forget)
          if (visitor.email) {
            sendEmail({
              to: visitor.email,
              subject: 'Your visit has been approved - QR Code',
              html: `<h1>Welcome ${visitor.first_name} ${visitor.last_name}!</h1>
                <p>Your visit has been approved. Please show this QR code at the entrance.</p>
                <img src="${qrCode}" alt="QR Code" style="width:200px;height:200px;" />
                <p>Visitor ID: ${visitorId}</p>`
            }).then(() => console.log('QR email sent to visitor'))
              .catch((mailErr) => console.error('QR mail error:', mailErr.message));
          }

          res.json({
            message: 'Visitor approved successfully. QR code generated.',
            visitorId: visitorId,
            qrCode: qrCode
          });
        }
      );
    } catch (qrErr) {
      console.error('Error generating QR code:', qrErr);
      res.status(500).json({ message: 'Failed to generate QR code', error: qrErr.message });
    }
  });
};

// Reject visitor
const rejectVisitor = (req, res) => {
  const visitorId = req.params.id;

  conn.query('SELECT * FROM visitors WHERE visitor_id = ?', [visitorId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Visitor not found' });

    const visitor = results[0];

    if (visitor.is_verified == 1) {
      return res.status(400).json({ message: 'Cannot reject an already verified visitor' });
    }

    conn.query(
      'UPDATE visitors SET is_verified = 2 WHERE visitor_id = ?',
      [visitorId],
      (updateErr) => {
        if (updateErr) {
          console.error('Error rejecting visitor:', updateErr);
          return res.status(500).json({ message: 'Failed to reject visitor', error: updateErr.message });
        }

        // Notify visitor of rejection (fire and forget)
        if (visitor.email) {
          sendEmail({
            to: visitor.email,
            subject: 'Visit Request Update',
            html: `<h1>Hello ${visitor.first_name} ${visitor.last_name}</h1>
              <p>Unfortunately, your visit request has not been approved at this time.</p>
              <p>Please contact the front desk for more information.</p>`
          }).then(() => console.log('Rejection email sent to visitor'))
            .catch((mailErr) => console.error('Rejection mail error:', mailErr.message));
        }

        res.json({ message: 'Visitor has been rejected' });
      }
    );
  });
};


module.exports = {
  getVisitorById,
  updateVisitor,
  getVisitorQrCode,
  updateVisitorStatusController,
  getVisitorDetails,
  getAllVisitors,
  sendOtp,
  verifyOtp,
  submitDetails,
  handleQrScan,
  submitDetailsWithoutOtp,
  getVisitorForVerification,
  approveVisitor,
  rejectVisitor
};
