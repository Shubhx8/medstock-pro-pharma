const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const createCrudController = require('../utils/crudFactory');
const { verifyToken, requireRole } = require('../middleware/auth');

const controller = createCrudController(
  'manufacturer',
  'manufacturer_id',
  ['name', 'address'],
  'name'
);

const deleteManufacturer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [mfRows] = await pool.query('SELECT * FROM manufacturer WHERE manufacturer_id = ?', [id]);
  if (mfRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Manufacturer not found' });
  }
  const mf = mfRows[0];

  const [medCheck] = await pool.query('SELECT COUNT(*) AS cnt FROM medicine WHERE manufacturer_id = ?', [id]);
  if (medCheck[0].cnt > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete manufacturer "${mf.name}": Linked to ${medCheck[0].cnt} medicine(s) in catalog.`
    });
  }

  await pool.query('DELETE FROM manufacturer WHERE manufacturer_id = ?', [id]);
  res.json({ success: true, message: `Manufacturer "${mf.name}" deleted successfully` });
});

router.use(verifyToken);
router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', requireRole('admin', 'pharmacist'), deleteManufacturer);

module.exports = router;

