const express = require('express');
const router = express.Router();
const createCrudController = require('../utils/crudFactory');
const { verifyToken, requireRole } = require('../middleware/auth');

const controller = createCrudController(
  'customer',
  'customer_id',
  ['name', 'phone'],
  'name'
);

router.use(verifyToken);
router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', requireRole('admin'), controller.delete);

module.exports = router;
