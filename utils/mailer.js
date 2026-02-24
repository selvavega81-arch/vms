const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const nodemailer = require("nodemailer");

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("Email credentials not found");
}
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    connectionTimeout: 10000, // 10 seconds to connect
    greetingTimeout: 10000,   // 10 seconds for greeting
    socketTimeout: 15000 
});
const sendEmail = async (options) => {
    return transporter.sendMail({
        from: process.env.EMAIL_USER,
        ...options
    });
};

module.exports = sendEmail;



// const data={
//     first_name:"test",
//     last_name:"test",
//     designation_id:"test",
//     whomToMeet:"test",
//     purpose:"test", 
//     aadhar_no:"test",
//     address:"test",
//     phone:"test",
//     email:"test"
// }
// const  mailOptions =async () => {
//       await sendEmail({
//         to: "sellva204@gmail.com",
//         subject: `${data.first_name} ${data.last_name} has checked in`,
//         html: `<h1>${data.first_name} ${data.last_name} has checked in</h1>
//         <p>${data.designation_id}</p>
//         <p>${data.whomToMeet}</p>
//         <p>${data.purpose}</p>
//         <p>${data.aadhar_no}</p>
//         <p>${data.address}</p>
//         <p>${data.phone}</p>
//         <p>${data.email}</p>`
// });
// console.log("mail sent");
// }
// mailOptions();
