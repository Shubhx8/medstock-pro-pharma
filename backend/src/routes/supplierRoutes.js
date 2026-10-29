const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const createCrudController = require('../utils/crudFactory');
const { verifyToken, requireRole } = require('../middleware/auth');

const controller = createCrudController(
  'supplier',
  'supplier_id',
  ['name', 'phone', 'street', 'city', 'pin'],
  'name'
);

const deleteSupplier = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1. Check if supplier exists
  const [supRows] = await pool.query('SELECT * FROM supplier WHERE supplier_id = ?', [id]);
  if (supRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  const sup = supRows[0];

  // 2. Check if any batches from this supplier have completed sales
  const [salesCheck] = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM sold_in si
    JOIN batch b ON si.batch_id = b.batch_id
    WHERE b.supplier_id = ?
  `, [id]);

  if (salesCheck[0].cnt > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete supplier "${sup.name}": Linked to ${salesCheck[0].cnt} completed sale record(s) in sales history.`
    });
  }

  // 3. Delete any linked disposals for batches of this supplier
  await pool.query(`
    DELETE d FROM disposal d
    JOIN batch b ON d.batch_id = b.batch_id
    WHERE b.supplier_id = ?
  `, [id]);

  // 4. Delete linked batches (linked alerts cascade delete)
  await pool.query('DELETE FROM batch WHERE supplier_id = ?', [id]);

  // 5. Delete supplier
  await pool.query('DELETE FROM supplier WHERE supplier_id = ?', [id]);

  res.json({
    success: true,
    message: `Supplier "${sup.name}" and associated un-sold batches deleted successfully`
  });
});

router.use(verifyToken);
router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', requireRole('admin', 'pharmacist'), deleteSupplier);

module.exports = router;

