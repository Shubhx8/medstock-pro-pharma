const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/medicines
const getMedicines = asyncHandler(async (req, res) => {
  const { search } = req.query;

  // Join category, manufacturer and v_medicine_stock for real-time stock
  let sql = `
    SELECT 
      m.medicine_id,
      m.name,
      m.name AS medicine_name,
      m.generic_name,
      m.strength,
      m.unit,
      m.category_id,
      c.name AS category_name,
      m.manufacturer_id,
      mf.name AS manufacturer_name,
      m.reorder_level,
      m.reorder_level AS min_stock_level,
      COALESCE(s.total_stock, 0) AS total_stock
    FROM medicine m
    JOIN category c ON m.category_id = c.category_id
    JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
    LEFT JOIN v_medicine_stock s ON m.medicine_id = s.medicine_id
  `;

  const params = [];
  if (search && search.trim() !== '') {
    sql += ` WHERE m.name LIKE ? OR m.generic_name LIKE ?`;
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  sql += ` ORDER BY m.medicine_id ASC`;

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, data: rows });
});

// GET /api/medicines/:id
const getMedicineById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Single medicine header
  const [medRows] = await pool.query(`
    SELECT 
      m.medicine_id,
      m.name,
      m.name AS medicine_name,
      m.generic_name,
      m.strength,
      m.unit,
      m.category_id,
      c.name AS category_name,
      m.manufacturer_id,
      mf.name AS manufacturer_name,
      m.reorder_level,
      m.reorder_level AS min_stock_level,
      COALESCE(s.total_stock, 0) AS total_stock
    FROM medicine m
    JOIN category c ON m.category_id = c.category_id
    JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
    LEFT JOIN v_medicine_stock s ON m.medicine_id = s.medicine_id
    WHERE m.medicine_id = ?
  `, [id]);

  if (medRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Medicine not found' });
  }

  // Related batches with days_left
  const [batches] = await pool.query(`
    SELECT 
      b.*,
      s.name AS supplier_name,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left
    FROM batch b
    JOIN supplier s ON b.supplier_id = s.supplier_id
    WHERE b.medicine_id = ?
    ORDER BY b.expiry_date ASC
  `, [id]);

  const medicine = {
    ...medRows[0],
    batches
  };

  res.json({ success: true, data: medicine });
});

// POST /api/medicines
const createMedicine = asyncHandler(async (req, res) => {
  let { name, medicine_name, generic_name, strength, unit, category_id, manufacturer_id, reorder_level, min_stock_level } = req.body;

  const actualName = name || medicine_name;
  const actualReorder = reorder_level !== undefined ? reorder_level : (min_stock_level !== undefined ? min_stock_level : 50);

  if (!actualName || !category_id || !manufacturer_id) {
    return res.status(400).json({
      success: false,
      message: 'Name, category_id, and manufacturer_id are required'
    });
  }

  // Insert into medicine table
  const [result] = await pool.query(
    `INSERT INTO medicine (name, generic_name, strength, unit, category_id, manufacturer_id, reorder_level)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [actualName.trim(), generic_name || null, strength || null, unit || 'tablet', category_id, manufacturer_id, actualReorder]
  );

  const [created] = await pool.query(`
    SELECT m.*, m.name AS medicine_name, m.reorder_level AS min_stock_level,
           c.name AS category_name, mf.name AS manufacturer_name, 0 AS total_stock
    FROM medicine m
    JOIN category c ON m.category_id = c.category_id
    JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
    WHERE m.medicine_id = ?
  `, [result.insertId]);

  res.status(201).json({
    success: true,
    data: created[0],
    message: 'Medicine created successfully'
  });
});

// PUT /api/medicines/:id
const updateMedicine = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let { name, medicine_name, generic_name, strength, unit, category_id, manufacturer_id, reorder_level, min_stock_level } = req.body;

  const actualName = name || medicine_name;
  const actualReorder = reorder_level !== undefined ? reorder_level : min_stock_level;

  const [existing] = await pool.query('SELECT * FROM medicine WHERE medicine_id = ?', [id]);
  if (existing.length === 0) {
    return res.status(404).json({ success: false, message: 'Medicine not found' });
  }

  const setClauses = [];
  const vals = [];

  if (actualName !== undefined) { setClauses.push('name = ?'); vals.push(actualName.trim()); }
  if (generic_name !== undefined) { setClauses.push('generic_name = ?'); vals.push(generic_name); }
  if (strength !== undefined) { setClauses.push('strength = ?'); vals.push(strength); }
  if (unit !== undefined) { setClauses.push('unit = ?'); vals.push(unit); }
  if (category_id !== undefined) { setClauses.push('category_id = ?'); vals.push(category_id); }
  if (manufacturer_id !== undefined) { setClauses.push('manufacturer_id = ?'); vals.push(manufacturer_id); }
  if (actualReorder !== undefined) { setClauses.push('reorder_level = ?'); vals.push(actualReorder); }

  if (setClauses.length > 0) {
    vals.push(id);
    await pool.query(`UPDATE medicine SET ${setClauses.join(', ')} WHERE medicine_id = ?`, vals);
  }

  const [updated] = await pool.query(`
    SELECT m.*, m.name AS medicine_name, m.reorder_level AS min_stock_level,
           c.name AS category_name, mf.name AS manufacturer_name,
           COALESCE(s.total_stock, 0) AS total_stock
    FROM medicine m
    JOIN category c ON m.category_id = c.category_id
    JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
    LEFT JOIN v_medicine_stock s ON m.medicine_id = s.medicine_id
    WHERE m.medicine_id = ?
  `, [id]);

  res.json({
    success: true,
    data: updated[0],
    message: 'Medicine updated successfully'
  });
});

// DELETE /api/medicines/:id
const deleteMedicine = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [result] = await pool.query('DELETE FROM medicine WHERE medicine_id = ?', [id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'Medicine not found' });
  }
  res.json({ success: true, message: 'Medicine deleted successfully' });
});

module.exports = {
  getMedicines,
  getMedicineById,
  createMedicine,
  updateMedicine,
  deleteMedicine
};
