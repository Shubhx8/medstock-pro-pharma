const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/batches
const getBatches = asyncHandler(async (req, res) => {
  const { medicine_id, status, expiring_within } = req.query;

  // Join medicine and supplier details, calculate days_left
  let sql = `
    SELECT 
      b.*,
      m.name AS medicine_name,
      s.name AS supplier_name,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    JOIN supplier s ON b.supplier_id = s.supplier_id
    WHERE 1=1
  `;

  const params = [];
  if (medicine_id) {
    sql += ` AND b.medicine_id = ?`;
    params.push(medicine_id);
  }
  if (status) {
    sql += ` AND b.status = ?`;
    params.push(status);
  }
  if (expiring_within) {
    sql += ` AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) AND b.expiry_date >= CURDATE() AND b.status = 'ACTIVE'`;
    params.push(expiring_within);
  }

  sql += ` ORDER BY b.expiry_date ASC`;

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, data: rows });
});

// GET /api/batches/expired (Quarantine list: status = 'EXPIRED' and quantity > 0)
const getExpiredBatches = asyncHandler(async (req, res) => {
  const sql = `
    SELECT 
      b.*,
      m.name AS medicine_name,
      s.name AS supplier_name,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    JOIN supplier s ON b.supplier_id = s.supplier_id
    WHERE b.status = 'EXPIRED' AND b.quantity > 0
    ORDER BY b.expiry_date ASC
  `;

  const [rows] = await pool.query(sql);
  res.json({ success: true, data: rows });
});

// GET /api/batches/:id
const getBatchById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT 
      b.*,
      m.name AS medicine_name,
      s.name AS supplier_name,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    JOIN supplier s ON b.supplier_id = s.supplier_id
    WHERE b.batch_id = ?
  `;

  const [rows] = await pool.query(sql, [id]);
  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Batch not found' });
  }

  res.json({ success: true, data: rows[0] });
});

// POST /api/batches
const createBatch = asyncHandler(async (req, res) => {
  const {
    medicine_id,
    supplier_id,
    batch_no,
    mfg_date,
    expiry_date,
    purchase_price,
    mrp,
    quantity,
    purchase_date
  } = req.body;

  // Validation
  if (!medicine_id || !supplier_id || !batch_no || !mfg_date || !expiry_date || purchase_price === undefined || mrp === undefined || quantity === undefined) {
    return res.status(400).json({
      success: false,
      message: 'All batch fields (medicine_id, supplier_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, quantity) are required'
    });
  }

  // Trigger trg_batch_before_insert will reject if expiry_date < CURDATE() + 30 days
  const sql = `
    INSERT INTO batch 
      (medicine_id, supplier_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, quantity, purchase_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()))
  `;

  const [result] = await pool.query(sql, [
    medicine_id,
    supplier_id,
    batch_no.trim(),
    mfg_date,
    expiry_date,
    purchase_price,
    mrp,
    quantity,
    purchase_date || null
  ]);

  const [created] = await pool.query(`
    SELECT 
      b.*,
      m.name AS medicine_name,
      s.name AS supplier_name,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    JOIN supplier s ON b.supplier_id = s.supplier_id
    WHERE b.batch_id = ?
  `, [result.insertId]);

  res.status(201).json({
    success: true,
    data: created[0],
    message: 'Batch created successfully'
  });
});

module.exports = {
  getBatches,
  getExpiredBatches,
  getBatchById,
  createBatch
};
