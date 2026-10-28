const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  // Fetch user by email
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  if (rows.length === 0) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  const user = rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  const secret = process.env.JWT_SECRET || 'secret';
  const tokenPayload = {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const token = jwt.sign(tokenPayload, secret, { expiresIn: '1d' });

  res.json({
    success: true,
    data: {
      token,
      user: tokenPayload
    },
    message: 'Login successful'
  });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT user_id, name, email, role FROM users WHERE user_id = ?', [req.user.user_id]);
  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({
    success: true,
    data: rows[0]
  });
});

// GET /api/auth/users (for frontend Users screen)
const getAllUsers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT user_id, name, name AS user_name, email, role FROM users ORDER BY user_id ASC');
  res.json({
    success: true,
    data: rows
  });
});

module.exports = {
  login,
  me,
  getAllUsers
};
