const otpGenerator = require('otp-generator');
const otpStore = {}; // Temporary in-memory store

exports.sendOtp = async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ status: false, message: "Phone number is required" });
  }

  const otp = otpGenerator.generate(6, { digits: true, alphabets: false, specialChars: false });
  otpStore[phone] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 }; // Expires in 5 mins

  console.log(`OTP for ${phone}: ${otp}`); // Replace with SMS send logic

  return res.status(200).json({ status: true, message: "OTP sent successfully" });
};

exports.verifyOtp = (req, res) => {
  const { phone, otp } = req.body;

  const record = otpStore[phone];
  if (!record) {
    return res.status(400).json({ status: false, message: "OTP not sent or expired" });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[phone];
    return res.status(400).json({ status: false, message: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ status: false, message: "Invalid OTP" });
  }

  delete otpStore[phone];
  return res.status(200).json({ status: true, message: "OTP verified successfully" });
};
