const pool = require('../config/db');
const asyncHandler = require('./asyncHandler');

/**
 * Creates generic CRUD controller handlers for standard master tables
 * @param {string} table - Table name (e.g. 'manufacturer')
 * @param {string} idCol - Primary key column (e.g. 'manufacturer_id')
 * @param {string[]} allowedCols - Allowed columns for INSERT / UPDATE
 * @param {string} requiredCol - Mandatory column (e.g. 'name')
 */
function createCrudController(table, idCol, allowedCols, requiredCol = 'name') {
  return {
    // GET /api/<resource>
    getAll: asyncHandler(async (req, res) => {
      const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY ${idCol} ASC`);
      // Add frontend-friendly aliases
      const data = rows.map(r => {
        const item = { ...r };
        if (table === 'category') {
          item.category_name = item.category_name || item.name;
        } else if (table === 'supplier') {
          item.supplier_name = item.supplier_name || item.name;
          item.address = item.address || [item.street, item.city, item.pin].filter(Boolean).join(', ');
        } else if (table === 'customer') {
          item.customer_name = item.customer_name || item.name;
        }
        return item;
      });
      res.json({ success: true, data });
    }),

    // GET /api/<resource>/:id
    getOne: asyncHandler(async (req, res) => {
      const { id } = req.params;
      const [rows] = await pool.query(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: `${table} not found` });
      }
      const item = { ...rows[0] };
      if (table === 'category') item.category_name = item.name;
      if (table === 'supplier') item.supplier_name = item.name;
      if (table === 'customer') item.customer_name = item.name;
      res.json({ success: true, data: item });
    }),

    // POST /api/<resource>
    create: asyncHandler(async (req, res) => {
      const body = { ...req.body };

      // Map frontend field aliases to DB column names
      if (table === 'category' && body.category_name && !body.name) body.name = body.category_name;
      if (table === 'supplier') {
        if (body.supplier_name && !body.name) body.name = body.supplier_name;
        if (body.address && !body.street) {
          const parts = body.address.split(',').map(s => s.trim());
          body.street = parts[0] || '';
          body.city = parts[1] || '';
          body.pin = parts[2] || '';
        }
      }
      if (table === 'customer' && body.customer_name && !body.name) body.name = body.customer_name;

      if (!body[requiredCol] || String(body[requiredCol]).trim() === '') {
        return res.status(400).json({ success: false, message: `${requiredCol} is required` });
      }

      const cols = [];
      const vals = [];
      const placeholders = [];

      for (const col of allowedCols) {
        if (body[col] !== undefined) {
          cols.push(col);
          vals.push(body[col]);
          placeholders.push('?');
        }
      }

      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
      const [result] = await pool.query(sql, vals);

      const [created] = await pool.query(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [result.insertId]);
      const createdItem = { ...created[0] };
      if (table === 'category') createdItem.category_name = createdItem.name;
      if (table === 'supplier') createdItem.supplier_name = createdItem.name;
      if (table === 'customer') createdItem.customer_name = createdItem.name;

      res.status(201).json({
        success: true,
        data: createdItem,
        message: `${table} created successfully`
      });
    }),

    // PUT /api/<resource>/:id
    update: asyncHandler(async (req, res) => {
      const { id } = req.params;
      const body = { ...req.body };

      // Map frontend field aliases to DB column names
      if (table === 'category' && body.category_name && !body.name) body.name = body.category_name;
      if (table === 'supplier') {
        if (body.supplier_name && !body.name) body.name = body.supplier_name;
        if (body.address && !body.street) {
          const parts = body.address.split(',').map(s => s.trim());
          body.street = parts[0] || '';
          body.city = parts[1] || '';
          body.pin = parts[2] || '';
        }
      }
      if (table === 'customer' && body.customer_name && !body.name) body.name = body.customer_name;

      // Check existence
      const [existing] = await pool.query(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [id]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: `${table} not found` });
      }

      const setClauses = [];
      const vals = [];

      for (const col of allowedCols) {
        if (body[col] !== undefined) {
          setClauses.push(`${col} = ?`);
          vals.push(body[col]);
        }
      }

      if (setClauses.length > 0) {
        vals.push(id);
        const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${idCol} = ?`;
        await pool.query(sql, vals);
      }

      const [updated] = await pool.query(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [id]);
      const updatedItem = { ...updated[0] };
      if (table === 'category') updatedItem.category_name = updatedItem.name;
      if (table === 'supplier') updatedItem.supplier_name = updatedItem.name;
      if (table === 'customer') updatedItem.customer_name = updatedItem.name;

      res.json({
        success: true,
        data: updatedItem,
        message: `${table} updated successfully`
      });
    }),

    // DELETE /api/<resource>/:id
    delete: asyncHandler(async (req, res) => {
      const { id } = req.params;
      const [result] = await pool.query(`DELETE FROM ${table} WHERE ${idCol} = ?`, [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `${table} not found` });
      }
      res.json({ success: true, message: `${table} deleted successfully` });
    })
  };
}

module.exports = createCrudController;
