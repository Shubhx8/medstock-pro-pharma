const pool = require('../config/db');

/**
 * Calculates tightest threshold (90, 60, 30, 7) for a given number of days left
 */
function getThreshold(daysLeft) {
  if (daysLeft <= 7) return 7;
  if (daysLeft <= 30) return 30;
  if (daysLeft <= 60) return 60;
  return 90;
}

/**
 * Executes the full alert generation routine per PRD Section 9.
 * Returns { created, resolved, expired_marked }
 */
async function generateAlerts() {
  let created = 0;
  let resolved = 0;
  let expired_marked = 0;

  // 1. Mark batches ACTIVE -> EXPIRED where expiry_date < CURDATE()
  // One-line comment: Auto-quarantine past-expiry active batches
  const [expireResult] = await pool.query(`
    UPDATE batch
    SET status = 'EXPIRED'
    WHERE status = 'ACTIVE' AND expiry_date < CURDATE()
  `);
  expired_marked = expireResult.affectedRows;

  // 2. Batches expiring within 90 days (EXPIRING_SOON)
  // One-line comment: Scan active non-empty batches expiring within 90 days
  const [expiringBatches] = await pool.query(`
    SELECT 
      b.batch_id,
      b.batch_no,
      b.medicine_id,
      b.expiry_date,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
      m.name AS medicine_name
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    WHERE b.status = 'ACTIVE'
      AND b.quantity > 0
      AND b.expiry_date >= CURDATE()
      AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
  `);

  for (const b of expiringBatches) {
    const t = getThreshold(b.days_left);
    const message = `${b.medicine_name} batch ${b.batch_no} expires in ${b.days_left} days (<=${t} day threshold)`;

    // Check if open alert already exists
    const [existing] = await pool.query(`
      SELECT alert_id, message FROM alert 
      WHERE batch_id = ? AND alert_type = 'EXPIRING_SOON' AND status = 'OPEN'
    `, [b.batch_id]);

    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO alert (medicine_id, batch_id, alert_type, message, alert_date, status)
        VALUES (?, ?, 'EXPIRING_SOON', ?, CURDATE(), 'OPEN')
      `, [b.medicine_id, b.batch_id, message]);
      created++;
    } else if (existing[0].message !== message) {
      // Update message if threshold tightened
      await pool.query('UPDATE alert SET message = ?, alert_date = CURDATE() WHERE alert_id = ?', [message, existing[0].alert_id]);
    }
  }

  // 3. Batches with status EXPIRED and quantity > 0 (EXPIRED alert)
  // One-line comment: Scan quarantined expired batches with remaining stock
  const [expiredBatches] = await pool.query(`
    SELECT b.batch_id, b.batch_no, b.medicine_id, m.name AS medicine_name
    FROM batch b
    JOIN medicine m ON b.medicine_id = m.medicine_id
    WHERE b.status = 'EXPIRED' AND b.quantity > 0
  `);

  for (const b of expiredBatches) {
    const message = `${b.medicine_name} batch ${b.batch_no} has expired and is quarantined`;
    const [existing] = await pool.query(`
      SELECT alert_id FROM alert
      WHERE batch_id = ? AND alert_type = 'EXPIRED' AND status = 'OPEN'
    `, [b.batch_id]);

    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO alert (medicine_id, batch_id, alert_type, message, alert_date, status)
        VALUES (?, ?, 'EXPIRED', ?, CURDATE(), 'OPEN')
      `, [b.medicine_id, b.batch_id, message]);
      created++;
    }
  }

  // 4. Medicine-level stock alerts using v_medicine_stock
  // One-line comment: Inspect aggregate sellable stock per medicine against reorder levels
  const [stockRows] = await pool.query(`
    SELECT s.medicine_id, s.name, s.reorder_level, s.total_stock
    FROM v_medicine_stock s
  `);

  for (const s of stockRows) {
    const stock = Number(s.total_stock);
    const reorder = Number(s.reorder_level);

    if (stock === 0) {
      // OUT_OF_STOCK
      const message = `${s.name} is out of stock`;
      const [existing] = await pool.query(`
        SELECT alert_id FROM alert
        WHERE medicine_id = ? AND alert_type = 'OUT_OF_STOCK' AND status = 'OPEN'
      `, [s.medicine_id]);

      if (existing.length === 0) {
        await pool.query(`
          INSERT INTO alert (medicine_id, batch_id, alert_type, message, alert_date, status)
          VALUES (?, NULL, 'OUT_OF_STOCK', ?, CURDATE(), 'OPEN')
        `, [s.medicine_id, message]);
        created++;
      }
    } else if (stock <= reorder) {
      // LOW_STOCK
      const message = `${s.name} low stock: ${stock} remaining (reorder level: ${reorder})`;
      const [existing] = await pool.query(`
        SELECT alert_id FROM alert
        WHERE medicine_id = ? AND alert_type = 'LOW_STOCK' AND status = 'OPEN'
      `, [s.medicine_id]);

      if (existing.length === 0) {
        await pool.query(`
          INSERT INTO alert (medicine_id, batch_id, alert_type, message, alert_date, status)
          VALUES (?, NULL, 'LOW_STOCK', ?, CURDATE(), 'OPEN')
        `, [s.medicine_id, message]);
        created++;
      }
    }
  }

  // 5. Auto-resolve cleared alerts
  // One-line comment: Auto-resolve batch alerts if batch is sold out or disposed
  const [resolvedBatches] = await pool.query(`
    UPDATE alert a
    JOIN batch b ON a.batch_id = b.batch_id
    SET a.status = 'RESOLVED'
    WHERE a.status = 'OPEN'
      AND a.alert_type IN ('EXPIRING_SOON', 'EXPIRED')
      AND (b.quantity = 0 OR b.status = 'DISPOSED')
  `);
  resolved += resolvedBatches.affectedRows;

  // One-line comment: Auto-resolve LOW_STOCK if stock recovered or dropped to 0
  const [resolvedLowStock] = await pool.query(`
    UPDATE alert a
    JOIN v_medicine_stock s ON a.medicine_id = s.medicine_id
    SET a.status = 'RESOLVED'
    WHERE a.status = 'OPEN'
      AND a.alert_type = 'LOW_STOCK'
      AND (s.total_stock > s.reorder_level OR s.total_stock = 0)
  `);
  resolved += resolvedLowStock.affectedRows;

  // One-line comment: Auto-resolve OUT_OF_STOCK if stock restocked
  const [resolvedOutOfStock] = await pool.query(`
    UPDATE alert a
    JOIN v_medicine_stock s ON a.medicine_id = s.medicine_id
    SET a.status = 'RESOLVED'
    WHERE a.status = 'OPEN'
      AND a.alert_type = 'OUT_OF_STOCK'
      AND s.total_stock > 0
  `);
  resolved += resolvedOutOfStock.affectedRows;

  return {
    created,
    resolved,
    expired_marked
  };
}

module.exports = {
  generateAlerts
};
