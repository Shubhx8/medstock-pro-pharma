const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/disposals (Admin only)
const createDisposal = asyncHandler(async (req, res) => {
  const { batch_id, quantity, reason } = req.body;
  const approved_by = req.user.user_id;

  const dispQty = parseInt(quantity, 10);
  if (!batch_id || isNaN(dispQty) || dispQty <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid batch_id and positive quantity are required'
    });
  }

  // Check batch status and quantity
  const [batches] = await pool.query(
    `SELECT b.*, m.name AS medicine_name, mf.name AS manufacturer_name
     FROM batch b
     JOIN medicine m ON b.medicine_id = m.medicine_id
     JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
     WHERE b.batch_id = ?`,
    [batch_id]
  );

  if (batches.length === 0) {
    return res.status(404).json({ success: false, message: 'Batch not found' });
  }

  const batch = batches[0];
  if (batch.status !== 'EXPIRED') {
    return res.status(400).json({
      success: false,
      message: 'Disposal is strictly restricted to EXPIRED batches'
    });
  }

  if (dispQty > batch.quantity) {
    return res.status(400).json({
      success: false,
      message: `Disposal quantity (${dispQty}) cannot exceed batch quantity (${batch.quantity})`
    });
  }

  // Insert into disposal table (Trigger trg_disposal_after_insert deducts stock and sets DISPOSED if qty reaches 0)
  const [result] = await pool.query(
    `INSERT INTO disposal (batch_id, quantity, disposal_date, reason, approved_by)
     VALUES (?, ?, CURDATE(), ?, ?)`,
    [batch_id, dispQty, reason || 'Expired', approved_by]
  );

  const disposalData = {
    disposal_id: result.insertId,
    batch_id: batch.batch_id,
    batch_no: batch.batch_no,
    medicine_name: batch.medicine_name,
    manufacturer_name: batch.manufacturer_name,
    quantity: dispQty,
    disposal_date: new Date().toISOString().slice(0, 10),
    reason: reason || 'Expired',
    approved_by: req.user.name || `User #${approved_by}`
  };

  res.status(201).json({
    success: true,
    data: disposalData,
    message: 'Expired batch disposed successfully'
  });
});

// GET /api/disposals
const getDisposals = asyncHandler(async (req, res) => {
  const sql = `
    SELECT 
      d.disposal_id,
      d.batch_id,
      d.quantity,
      d.disposal_date,
      d.reason,
      b.batch_no,
      m.name AS medicine_name,
      mf.name AS manufacturer_name,
      u.name AS approved_by_name
    FROM disposal d
    JOIN batch b ON d.batch_id = b.batch_id
    JOIN medicine m ON b.medicine_id = m.medicine_id
    JOIN manufacturer mf ON m.manufacturer_id = mf.manufacturer_id
    JOIN users u ON d.approved_by = u.user_id
    ORDER BY d.disposal_id DESC
  `;

  const [rows] = await pool.query(sql);
  res.json({ success: true, data: rows });
});

module.exports = {
  createDisposal,
  getDisposals
};
