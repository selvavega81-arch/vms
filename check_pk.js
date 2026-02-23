const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

connection.query('DESCRIBE employees', (err, results) => {
  if (err) {
    console.error(err);
  } else {
    const pk = results.find(row => row.Key === 'PRI');
    console.log('Primary Key of employees table:', pk ? pk.Field : 'Not found');
  }
  connection.end();
});
