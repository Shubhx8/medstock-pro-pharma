const pool = require('../config/db');
const saleService = require('../services/saleService');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/sales
const createSale = asyncHandler(async (req, res) => {
  const { customer_id, items } = req.body;
  const created_by = req.user.user_id;

  const sale = await saleService.createSale({
    customer_id,
    items,
    created_by
  });

  res.status(201).json({
    success: true,
    data: sale,
    message: 'Sale completed successfully'
  });
});

// GET /api/sales
const getSales = asyncHandler(async (req, res) => {
  const { details } = req.query;

  // If detailed line-items requested (e.g. for frontend sales log)
  if (details === 'true' || details === '1') {
    const sql = `
      SELECT 
        si.sold_in_id,
        s.sale_id,
        s.sale_date,
        s.customer_id,
        COALESCE(c.name, 'Walk-in Customer') AS customer_name,
        m.medicine_id,
        m.name AS medicine_name,
        b.batch_no,
        si.qty AS qty_sold,
        si.price,
        (si.qty * si.price) AS amount,
        u.name AS dispensed_by
      FROM sold_in si
      JOIN sale s ON si.sale_id = s.sale_id
      JOIN batch b ON si.batch_id = b.batch_id
      JOIN medicine m ON b.medicine_id = m.medicine_id
      LEFT JOIN customer c ON s.customer_id = c.customer_id
      JOIN users u ON s.created_by = u.user_id
      ORDER BY s.sale_id DESC, si.sold_in_id ASC
    `;
    const [rows] = await pool.query(sql);
    return res.json({ success: true, data: rows });
  }

  // Standard API spec summary list
  const sql = `
    SELECT 
      s.sale_id,
      s.sale_date,
      s.total_amount,
      s.created_by,
      s.customer_id,
      COALESCE(c.name, 'Walk-in Customer') AS customer_name,
      u.name AS dispensed_by,
      COUNT(si.sold_in_id) AS item_count
    FROM sale s
    LEFT JOIN customer c ON s.customer_id = c.customer_id
    JOIN users u ON s.created_by = u.user_id
    LEFT JOIN sold_in si ON s.sale_id = si.sale_id
    GROUP BY s.sale_id, s.sale_date, s.total_amount, s.created_by, s.customer_id, c.name, u.name
    ORDER BY s.sale_id DESC
  `;

  const [rows] = await pool.query(sql);
  res.json({ success: true, data: rows });
});

// GET /api/sales/:id
const getSaleById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [headerRows] = await pool.query(`
    SELECT 
      s.sale_id,
      s.sale_date,
      s.total_amount,
      s.created_by,
      s.customer_id,
      COALESCE(c.name, 'Walk-in Customer') AS customer_name,
      u.name AS dispensed_by
    FROM sale s
    LEFT JOIN customer c ON s.customer_id = c.customer_id
    JOIN users u ON s.created_by = u.user_id
    WHERE s.sale_id = ?
  `, [id]);

  if (headerRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }

  const [items] = await pool.query(`
    SELECT 
      si.sold_in_id,
      si.qty,
      si.price,
      (si.qty * si.price) AS subtotal,
      b.batch_id,
      b.batch_no,
      b.expiry_date,
      m.medicine_id,
      m.name AS medicine_name
    FROM sold_in si
    JOIN batch b ON si.batch_id = b.batch_id
    JOIN medicine m ON b.medicine_id = m.medicine_id
    WHERE si.sale_id = ?
    ORDER BY si.sold_in_id ASC
  `, [id]);

  const sale = {
    ...headerRows[0],
    items
  };

  res.json({ success: true, data: sale });
});

module.exports = {
  createSale,
  getSales,
  getSaleById
};
