const db = require('../db').callbackPool;
const { checkVisitorQuery,
  insertOtpQuery,
  selectOtpQuery,
  deleteOtpQuery,
  fetchVisitorQuery,
  insertVisitorQuery,
  insertAppointmentQuery,
  updateAppointmentQuery,
  getAppointmentByIdQuery,
  getAppointmentsTableDataQuery,
  getRemarksByAppointmentIdQuery,
  updateVisitorQrQuery } = require('../queries/appointment_queries');
const { generateVisitorQr } = require('../utils/generate_qr');
const sendOTP = require('../utils/sendEmail');
const qrUtil = require('../utils/generate_qr');

exports.createAppointment = async (req, res) => {
  console.log('Creating appointment with data:', req.body); // Debug log
  
  const {
    first_name,
    last_name,
    email,
    phone,
    gender,
    aadhar_no,
    address,
    purpose_of_visit,
    appointment_date,
    appointment_time,
    duration,
    company_id,
    department_id,
    designation_id,
    whom_to_meet,
    reminder,
    remarks
  } = req.body;

  // Handle uploaded image
  const image = req.file ? req.file.filename : (req.body.image || null);

  // Smart date formatting: handles both 'dd-mm-yyyy' and 'yyyy-mm-dd' (ISO format from HTML date input)
  function formatDate(dateString) {
    if (!dateString) {
      console.error('Date string is empty or undefined');
      return null;
    }
    
    // Check if it's already in ISO format (yyyy-mm-dd) - from HTML date input
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString; // Already in correct MySQL format
    }
    
    // Handle dd-mm-yyyy format
    if (dateString.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = dateString.split('-');
      return `${year}-${month}-${day}`;
    }
    
    console.error('Unrecognized date format:', dateString);
    return dateString; // Return as-is and let MySQL handle it
  }

  const formattedDate = formatDate(appointment_date);
  console.log('Formatted date:', formattedDate); // Debug log

  const visitorData = [
    first_name,
    last_name,
    email,
    phone,
    gender,
    company_id,
    department_id,
    designation_id,
    whom_to_meet,
    purpose_of_visit,  // This maps to 'purpose' column (purpose_id)
    aadhar_no,
    address || '',
    image || null,
    1,               // otp_verified
    'active'         // qr_status
  ];

  console.log('Visitor data array:', visitorData); // Debug log


  db.query(insertVisitorQuery, visitorData, async (err, result) => {
    if (err) {
      console.error('Visitor insert error:', err);
      return res.status(500).send('Failed to create visitor');
    }

    const visitor_id = result.insertId;

    try {
      const qrCode = await generateVisitorQr(visitor_id);
      db.query(updateVisitorQrQuery, [qrCode, visitor_id], (err) => {
        if (err) {
          console.error('QR code update error:', err);
          return res.status(500).send('Failed to save QR code');
        }

        const appointmentData = [
          visitor_id,
          formattedDate,
          appointment_time,
          duration,
          purpose_of_visit,
          company_id,
          department_id,
          designation_id,
          whom_to_meet,
          reminder,
          remarks
        ];

        db.query(insertAppointmentQuery, appointmentData, (err2, result2) => {
          if (err2) {
            console.error('Appointment insert error:', err2);
            return res.status(500).send('Failed to create appointment');
          }

          res.status(201).send({
            message: 'Visitor and appointment created successfully',
            visitor_id,
            appointment_id: result2.insertId,
            qr_code: qrCode
          });
        });
      });

    } catch (qrErr) {
      console.error('QR generation error:', qrErr);
      return res.status(500).send('QR Code generation failed');
    }
  });
};

exports.updateAppointment = (req, res) => {
  const appointment_id = req.params.id;
  const {
    visitor_id,
    appointment_date,
    appointment_time,
    duration,
    purpose_of_visit,
    company_id,
    department_id,
    designation_id,
    whom_to_meet,
    reminder,
    remarks
  } = req.body;

  const data = [
    visitor_id,
    appointment_date,
    appointment_time,
    duration,
    purpose_of_visit,
    company_id,
    department_id,
    designation_id,
    whom_to_meet,
    reminder,
    remarks
  ];

  db.query(updateAppointmentQuery, [...data, appointment_id], (err, result) => {
    if (err) {
      console.error('Update error:', err);
      return res.status(500).send('Server error');
    }

    if (result.affectedRows === 0) {
      return res.status(404).send({ message: 'Appointment not found' });
    }

    res.send({ message: 'Appointment updated successfully' });
  });
};

exports.getAppointmentById = (req, res) => {
  const appointment_id = req.body.id;

  if (!appointment_id) {
    return res.status(400).json({ message: 'Appointment ID is required' });
  }

  db.query(getAppointmentByIdQuery, [appointment_id], (err, results) => {
    if (err) {
      console.error('Fetch error:', err);
      return res.status(500).send('Server error');
    }

    if (results.length === 0) {
      return res.status(404).send({ message: 'Appointment not found' });
    }

    const row = results[0];
    res.status(200).send({
      appointment_id: row.appointment_id,
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      duration: row.duration,
      purpose_of_visit: row.purpose_of_visit,
      company_id: row.company_id,
      department_id: row.department_id,
      designation_id: row.designation_id,
      reminder: row.reminder,
      remarks: row.remarks,
      visitor: {
        first_name: row.visitor_first_name,
        last_name: row.visitor_last_name,
        email: row.visitor_email,
        phone: row.visitor_phone
      },
      whom_to_meet: {
        first_name: row.emp_first_name,
        last_name: row.emp_last_name,
        email: row.emp_email
      }
    });
  });
};


exports.getAppointmentsTableData = (req, res) => {
  db.query(getAppointmentsTableDataQuery, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json({
      message: 'Appointments fetched successfully',
      data: results
    });
  });
};

exports.postRemarksByAppointmentId = (req, res) => {
  const { appointment_id } = req.body;

  if (!appointment_id) {
    return res.status(400).json({ error: 'appointment_id is required in request body' });
  }

  db.query(getRemarksByAppointmentIdQuery, [appointment_id], (err, results) => {
    if (err) {
      console.error('Error fetching remarks:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No remarks found for this appointment' });
    }

    res.status(200).json({
      appointment_id,
      remarks: results[0].remarks,
    });
  });
};


exports.sendOtp = (req, res) => {
  const { contact } = req.body;

  if (!contact) {
    return res.status(400).json({ message: 'Phone number or email is required' });
  }

  const isEmail = contact.includes('@');
  const phone = isEmail ? null : contact;
  const email = isEmail ? contact : null;

  db.query(checkVisitorQuery, [phone, email], (err, visitorResults) => {
    if (err) return res.status(500).json({ message: 'DB error', error: err });

    if (visitorResults.length === 0) {
      return res.status(404).json({ message: 'No visitor found with this contact' });
    }

    // const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const otp = '1234';
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry


    db.query(insertOtpQuery, [phone, email, otp, expiry], async (err2) => {
      if (err2) return res.status(500).json({ message: 'DB error', error: err2 });

      console.log(`OTP for ${contact} is: ${otp}`);

      try {
        if (email) {
          // Send OTP via email
          await sendOTP(email, otp);
        } else {
          // For phone, you can add SMS sending logic here later
          console.log('Phone OTP - implement SMS sending here');
        }

        res.json({ message: 'OTP generated and sent' });
      } catch (emailErr) {
        console.error('Error sending email:', emailErr);
        res.status(500).json({ message: 'Failed to send OTP email' });
      }
    });
  });
};

exports.verifyOtp = (req, res) => {
  const { contact, otp } = req.body;

  console.log('Received contact:', contact);
  console.log('Received OTP from frontend:', otp);

  if (!contact || !otp) {
    return res.status(400).json({ message: 'Contact and OTP are required' });
  }

  const isEmail = contact.includes('@');
  const phone = isEmail ? null : contact;
  const email = isEmail ? contact : null;

  console.log('Is email?', isEmail, '| Phone:', phone, '| Email:', email);

  db.query(selectOtpQuery, [phone, phone, email, email], (err, otpResults) => {
    console.log("OTP query result:", otpResults);

    if (err) {
      console.error('DB error while checking OTP:', err);
      return res.status(500).json({ message: 'DB error while checking OTP', error: err });
    }

    if (!otpResults.length) {
      console.warn('OTP not found in DB');
      return res.status(404).json({ message: 'OTP not found' });
    }

    const record = otpResults[0];

    console.log('OTP from DB:', record.otp);
    console.log('OTP expiry time:', record.expires_at);

    if (record.otp.trim() !== otp.trim()) {
      console.warn('OTP mismatch');
      return res.status(401).json({ message: 'Invalid OTP' });
    }

    if (new Date() > record.expires_at) {
      console.warn('OTP expired');
      return res.status(401).json({ message: 'OTP expired' });
    }

    // Do not delete OTP immediately to allow for network retries/idempotency
    // DB will clean it up or it will expire naturally
    /*
    db.query(deleteOtpQuery, [phone, email], (err2) => {
      if (err2) console.error('Failed to delete OTP:', err2);
    });
    */

    db.query(fetchVisitorQuery, [phone, email], (err3, visitorResults) => {
      if (err3) {
        console.error('DB error fetching visitor info:', err3);
        return res.status(500).json({ message: 'DB error fetching visitor info', error: err3 });
      }

      if (!visitorResults.length) {
        console.warn('No active appointment found for this visitor');
        return res.status(404).json({ message: 'No active appointment found for this visitor' });
      }

      const data = visitorResults[0];
      console.log('Visitor data:', data);

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const imageUrl = data.image ? `${baseUrl}/uploads/${data.image}` : null;

      res.status(200).json({
        visitor_name: `${data.first_name} ${data.last_name}`,
        appointment_id: data.appointment_id,
        image: imageUrl,
        whom_to_meet: data.whom_to_meet,
        purpose: data.purpose,
        phone: data.phone,
        address: data.address,
        qr_code: data.qr_code
      });
    });
  });
};


