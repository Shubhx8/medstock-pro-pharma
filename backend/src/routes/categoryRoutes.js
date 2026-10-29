const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const createCrudController = require('../utils/crudFactory');
const { verifyToken, requireRole } = require('../middleware/auth');

const controller = createCrudController(
  'category',
  'category_id',
  ['name'],
  'name'
);

const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [catRows] = await pool.query('SELECT * FROM category WHERE category_id = ?', [id]);
  if (catRows.length === 0) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  const cat = catRows[0];

  const [medCheck] = await pool.query('SELECT COUNT(*) AS cnt FROM medicine WHERE category_id = ?', [id]);
  if (medCheck[0].cnt > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete category "${cat.name}": Linked to ${medCheck[0].cnt} medicine(s) in catalog.`
    });
  }

  await pool.query('DELETE FROM category WHERE category_id = ?', [id]);
  res.json({ success: true, message: `Category "${cat.name}" deleted successfully` });
});

router.use(verifyToken);
router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', requireRole('admin', 'pharmacist'), deleteCategory);

module.exports = router;

