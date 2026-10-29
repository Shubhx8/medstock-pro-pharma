const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/signup or /api/auth/register
const signup = asyncHandler(async (req, res) => {
  const { name, user_name, email, password, role } = req.body;
  const fullName = (name || user_name || '').trim();
  const userEmail = (email || '').trim().toLowerCase();
  const plainPassword = (password || '').trim();

  if (!fullName) {
    return res.status(400).json({ success: false, message: 'Full name is required' });
  }

  if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
  }

  if (!plainPassword || plainPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
  }

  // Check email uniqueness
  const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [userEmail]);
  if (existing.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'An account with this email address already exists. Please sign in.'
    });
  }

  // Normalize role
  let normalizedRole = (role || 'pharmacist').trim().toLowerCase();
  if (!['admin', 'pharmacist', 'storekeeper'].includes(normalizedRole)) {
    normalizedRole = 'pharmacist';
  }

  // Hash password with bcrypt salt = 10
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(plainPassword, salt);

  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [fullName, userEmail, passwordHash, normalizedRole]
  );

  const newUserId = result.insertId;
  const tokenPayload = {
    user_id: newUserId,
    name: fullName,
    email: userEmail,
    role: normalizedRole
  };

  const secret = process.env.JWT_SECRET || 'secret';
  const token = jwt.sign(tokenPayload, secret, { expiresIn: '7d' });

  res.status(201).json({
    success: true,
    data: {
      token,
      user: tokenPayload
    },
    message: 'Account created successfully'
  });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, user_id, password } = req.body;

  if (!password || (!email && !user_id)) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  let rows;
  if (user_id) {
    [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [Number(user_id)]);
  } else {
    [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  }

  if (rows.length === 0) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or user account not found'
    });
  }

  const user = rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Incorrect password. Please try again.'
    });
  }

  const secret = process.env.JWT_SECRET || 'secret';
  const tokenPayload = {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const token = jwt.sign(tokenPayload, secret, { expiresIn: '7d' });

  res.json({
    success: true,
    data: {
      token,
      user: tokenPayload
    },
    message: `Welcome back, ${user.name}`
  });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
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

  const normalizedRole = (role || 'pharmacist').trim().toLowerCase();
  const defaultPwd = normalizedRole === 'admin' ? 'admin123' : 'staff123';
  const plainPassword = password || defaultPwd;
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(plainPassword, salt);

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

  // Check user existence
  const [userRows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
  if (userRows.length === 0) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  const targetUser = userRows[0];

  // Reassign any historical sales and disposals linked to this user to primary admin #1
  // so financial logs and disposal audit trails remain unbroken
  await pool.query('UPDATE sale SET created_by = 1 WHERE created_by = ?', [userId]);
  await pool.query('UPDATE disposal SET approved_by = 1 WHERE approved_by = ?', [userId]);

  const [result] = await pool.query('DELETE FROM users WHERE user_id = ?', [userId]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.json({
    success: true,
    message: `User "${targetUser.name}" deleted successfully`
  });
});

module.exports = {
  signup,
  login,
  logout,
  me,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
};

