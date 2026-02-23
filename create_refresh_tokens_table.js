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

connection.query(createTableQuery, (err, results) => {
  if (err) {
    console.error("Error creating table:", err);
  } else {
    console.log("Table 'refresh_tokens' created successfully.");
  }
  connection.end();
});
