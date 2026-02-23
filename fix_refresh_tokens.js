const mysql = require('mysql2');
const dotenv = require('dotenv');
const path = require('path');

// Explicitly load the .env file
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("Error loading .env file:", result.error);
}

console.log("DB Config from .env:");
console.log("HOST:", process.env.DB_HOST);
console.log("PORT:", process.env.DB_PORT);
console.log("USER:", process.env.DB_USER);
console.log("DB_NAME:", process.env.DB_NAME);

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const createTableQuery = `
CREATE TABLE IF NOT EXISTS refresh_tokens(
    id int PRIMARY KEY AUTO_INCREMENT,
    employee_id int,
    token text,
    expires_at TIMESTAMP default (CURRENT_DATE + INTERVAL 7 DAY),
    CONSTRAINT fk_employee
        FOREIGN KEY(employee_id)
        REFERENCES employees(emp_id)
        ON DELETE CASCADE
);
`;

connection.connect(err => {
  if (err) {
    console.error("Connection failed:", err);
    return;
  }
  console.log("Connected to MySQL successfully on port", connection.config.port);

  connection.query(createTableQuery, (err, results) => {
    if (err) {
      console.error("Error creating table:", err);
    } else {
      console.log("Table 'refresh_tokens' ensured.");
      console.log(results);
    }
    connection.end();
  });
});
