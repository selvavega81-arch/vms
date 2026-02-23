const nodemailer = require('nodemailer');

/**
 * Send OTP via email
 * @param {string} email - Recipient email address
 * @param {string} otp - OTP code to send
 */
async function sendOTP(email, otp) {
  // Validate environment variables
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('SMTP credentials not configured in environment variables');
    throw new Error('Email service not configured');
  }

  const transporter = nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: `"Visitor Management System" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your OTP Code - Visitor Management System',
    text: `Your OTP code is ${otp}. This code will expire in 5 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Visitor Management System</h2>
        <p>Your OTP verification code is:</p>
        <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p style="color: #666;">This code will expire in 5 minutes.</p>
        <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = sendOTP;
