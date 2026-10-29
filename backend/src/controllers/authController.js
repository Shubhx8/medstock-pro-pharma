const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, user_id, password } = req.body;

  if (!password || (!email && !user_id)) {
    return res.status(400).json({
      success: false,
      message: 'Password and user selection (or email) are required'
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
      message: 'User account not found'
    });
  }

  const user = rows[0];
  let isMatch = await bcrypt.compare(password, user.password_hash);

  // Fallback for default demo accounts (allows staff123 or admin123 if user has default hash)
  if (!isMatch && (password === 'staff123' || password === 'admin123')) {
    const isDefaultAdmin = await bcrypt.compare('admin123', user.password_hash);
    const isDefaultStaff = await bcrypt.compare('staff123', user.password_hash);
    if (isDefaultAdmin || isDefaultStaff) {
      isMatch = true;
    }
  }

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
    message: `Logged in successfully as ${user.name}`
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
  login,
  me,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
};

