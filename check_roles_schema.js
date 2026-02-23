const mysql = require('mysql2');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

connection.query('DESCRIBE roles', (err, results) => {
  if (err) {
    console.error("Error describing roles table:", err);
  } else {
    console.log("Table 'roles' structure:");
    console.log(JSON.stringify(results.map(r => r.Field), null, 2));
  }
  connection.end();
});
