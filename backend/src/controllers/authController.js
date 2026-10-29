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

// POST /api/auth/users
const createUser = asyncHandler(async (req, res) => {
  const { name, user_name, role, email, password } = req.body;
  const userName = (name || user_name || '').trim();

  if (!userName) {
    return res.status(400).json({
      success: false,
      message: 'User name is required'
    });
  }

  // Generate unique email if omitted
  let userEmail = email ? email.trim().toLowerCase() : null;
  if (!userEmail) {
    const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    userEmail = `${slug || 'user'}_${Date.now()}_${randSuffix}@pharmacy.local`;
  }

  // Check email uniqueness
  const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [userEmail]);
  if (existing.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'A user with this email address already exists'
    });
  }

  // Hash password (default: admin123)
  const plainPassword = password || 'admin123';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(plainPassword, salt);

  const normalizedRole = (role || 'pharmacist').trim().toLowerCase();

  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [userName, userEmail, passwordHash, normalizedRole]
  );

  const newUserId = result.insertId;
  const [rows] = await pool.query(
    'SELECT user_id, name, name AS user_name, email, role FROM users WHERE user_id = ?',
    [newUserId]
  );

  res.status(201).json({
    success: true,
    data: rows[0],
    message: 'User registered successfully'
  });
});

// PUT /api/auth/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }

  const { name, user_name, role, email, password } = req.body;
  const userName = (name || user_name || '').trim();
  const normalizedRole = role ? role.trim().toLowerCase() : null;

  const updates = [];
  const params = [];

  if (userName) {
    updates.push('name = ?');
    params.push(userName);
  }
  if (normalizedRole) {
    updates.push('role = ?');
    params.push(normalizedRole);
  }
  if (email) {
    updates.push('email = ?');
    params.push(email.trim().toLowerCase());
  }
  if (password) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }

  if (updates.length > 0) {
    params.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);
  }

  const [rows] = await pool.query(
    'SELECT user_id, name, name AS user_name, email, role FROM users WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.json({
    success: true,
    data: rows[0],
    message: 'User updated successfully'
  });
});

// DELETE /api/auth/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }

  if (userId === 1) {
    return res.status(400).json({
      success: false,
      message: 'Primary administrator (#1) cannot be deleted'
    });
  }

  if (req.user && req.user.user_id === userId) {
    return res.status(400).json({
      success: false,
      message: 'You cannot delete your own active session account'
    });
  }

  const [result] = await pool.query('DELETE FROM users WHERE user_id = ?', [userId]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.json({
    success: true,
    message: 'User deleted successfully'
  });
});

module.exports = {
  login,
  me,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
};

