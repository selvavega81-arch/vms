const bcrypt = require('bcrypt');
const db = require('../db').callbackPool; // Use callback-style pool explicitly
const {
  insertEmployeeQuery,
  updateEmployeeQuery,
  getAllEmployeesQuery,
  getEmployeeByIdQuery,
  deleteEmployeeByIdQuery,
  checkEmployeeExistsQuery
} = require('../queries/employees_queries');

// Add new employee
exports.addEmployee = async (req, res) => {
  const {
    first_name, last_name, email, phone, gender,
    company_id, department_id, designation_id, role_id, password
  } = req.body;

  const image = req.file ? req.file.filename : null;

  try {
    // Check if email or phone already exists
    db.query(checkEmployeeExistsQuery, [email, phone], async (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      if (result.length > 0) {
        return res.status(400).json({ message: 'Email or Phone already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      db.query(
        insertEmployeeQuery,
        [first_name, last_name, email, phone, gender, company_id, department_id, designation_id, role_id, image, hashedPassword],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          res.status(201).json({ message: 'Employee added successfully', emp_id: result.insertId });
        }
      );
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Update employee
exports.updateEmployee = (req, res) => {
  const emp_id = req.params.id;
  const {
    first_name, last_name, email, phone, gender,
    company_id, department_id, designation_id, role_id
  } = req.body;

  const image = req.file ? req.file.filename : req.body.image;

  db.query(
    updateEmployeeQuery,
    [first_name, last_name, email, phone, gender, company_id, department_id, designation_id, role_id, image, emp_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Employee updated successfully' });
    }
  );
};

// Get all employees
exports.getAllEmployees = (req, res) => {
  db.query(getAllEmployeesQuery, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// Get employee by ID
exports.getEmployeeById = (req, res) => {
  const emp_id = req.params.id;
  db.query(getEmployeeByIdQuery, [emp_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    if (result.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.json(result[0]);
  });
};

// Delete employee
exports.deleteEmployee = (req, res) => {
  const emp_id = req.params.id;
  db.query(deleteEmployeeByIdQuery, [emp_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Employee deleted successfully' });
  });
};
