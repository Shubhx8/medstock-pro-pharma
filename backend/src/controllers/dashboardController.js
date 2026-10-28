const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/dashboard/summary
const getDashboardSummary = asyncHandler(async (req, res) => {
  // Aggregate queries for dashboard statistics
  const [medCount] = await pool.query('SELECT COUNT(*) AS count FROM medicine');
  const [batchCount] = await pool.query('SELECT COUNT(*) AS count FROM batch WHERE status = "ACTIVE"');
  
  // Expiring soon batches within 90 days with quantity > 0
  const [expiringSoon] = await pool.query(`
    SELECT COUNT(*) AS count FROM batch
    WHERE status = 'ACTIVE' 
      AND quantity > 0
      AND expiry_date >= CURDATE()
      AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
  `);

  // Expired batches in quarantine (quantity > 0)
  const [expired] = await pool.query(`
    SELECT COUNT(*) AS count FROM batch
    WHERE status = 'EXPIRED' AND quantity > 0
  `);

  // Stock status from v_medicine_stock view
  const [stockStatus] = await pool.query(`
    SELECT 
      SUM(CASE WHEN total_stock = 0 THEN 1 ELSE 0 END) AS out_of_stock,
      SUM(CASE WHEN total_stock > 0 AND total_stock <= reorder_level THEN 1 ELSE 0 END) AS low_stock
    FROM v_medicine_stock
  `);

  // Open alerts
  const [alertsCount] = await pool.query(`
    SELECT COUNT(*) AS count FROM alert WHERE status = 'OPEN'
  `);

  // Sales and revenue today
  const [salesToday] = await pool.query(`
    SELECT 
      COUNT(*) AS sales_today,
      COALESCE(SUM(total_amount), 0) AS revenue_today
    FROM sale
    WHERE sale_date = CURDATE()
  `);

  const summary = {
    total_medicines: medCount[0].count,
    total_batches: batchCount[0].count,
    expiring_soon: expiringSoon[0].count,
    expired: expired[0].count,
    low_stock: Number(stockStatus[0].low_stock) || 0,
    out_of_stock: Number(stockStatus[0].out_of_stock) || 0,
    open_alerts: alertsCount[0].count,
    sales_today: salesToday[0].sales_today,
    revenue_today: Number(salesToday[0].revenue_today)
  };

  res.json({
    success: true,
    data: summary
  });
});

module.exports = {
  getDashboardSummary
};
