const pool = require('../config/db');
const alertService = require('../services/alertService');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/alerts
const getAlerts = asyncHandler(async (req, res) => {
  const { status = 'OPEN', type } = req.query;

  let sql = `
    SELECT 
      a.alert_id,
      a.medicine_id,
      a.batch_id,
      a.alert_type,
      a.message,
      a.alert_date,
      a.status,
      m.name AS medicine_name,
      b.batch_no
    FROM alert a
    JOIN medicine m ON a.medicine_id = m.medicine_id
    LEFT JOIN batch b ON a.batch_id = b.batch_id
    WHERE 1=1
  `;

  const params = [];
  if (status && status !== 'ALL') {
    sql += ` AND a.status = ?`;
    params.push(status);
  }
  if (type) {
    sql += ` AND a.alert_type = ?`;
    params.push(type);
  }

  sql += ` ORDER BY a.alert_id DESC`;

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, data: rows });
});

// POST /api/alerts/generate
const generateAlerts = asyncHandler(async (req, res) => {
  const result = await alertService.generateAlerts();
  res.json({
    success: true,
    data: result,
    message: `Alert generation complete: ${result.created} created, ${result.resolved} resolved, ${result.expired_marked} batches marked expired`
  });
});

// PATCH /api/alerts/:id/resolve
const resolveAlert = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [result] = await pool.query(
    `UPDATE alert SET status = 'RESOLVED' WHERE alert_id = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'Alert not found' });
  }

  const [updated] = await pool.query(
    `SELECT a.*, m.name AS medicine_name, b.batch_no
     FROM alert a
     JOIN medicine m ON a.medicine_id = m.medicine_id
     LEFT JOIN batch b ON a.batch_id = b.batch_id
     WHERE a.alert_id = ?`,
    [id]
  );

  res.json({
    success: true,
    data: updated[0],
    message: 'Alert resolved'
  });
});

module.exports = {
  getAlerts,
  generateAlerts,
  resolveAlert
};
