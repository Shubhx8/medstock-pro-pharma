const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const createCrudController = require('../utils/crudFactory');
const { verifyToken, requireRole } = require('../middleware/auth');

const controller = createCrudController(
  'customer',
  'customer_id',
  ['name', 'phone', 'email'],
  'name'
);

const deleteCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [custRows] = await pool.query('SELECT * FROM customer WHERE customer_id = ?', [id]);
  if (custRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  const cust = custRows[0];

  const [salesCheck] = await pool.query('SELECT COUNT(*) AS cnt FROM sale WHERE customer_id = ?', [id]);
  if (salesCheck[0].cnt > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete customer "${cust.name}": Associated with ${salesCheck[0].cnt} completed transaction(s) in Sales Log.`
    });
  }

  await pool.query('DELETE FROM customer WHERE customer_id = ?', [id]);
  res.json({ success: true, message: `Customer "${cust.name}" deleted successfully` });
});

router.use(verifyToken);
router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', requireRole('admin', 'pharmacist'), deleteCustomer);

module.exports = router;

