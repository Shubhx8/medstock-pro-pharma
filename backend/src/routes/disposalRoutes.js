const express = require('express');
const router = express.Router();
const disposalController = require('../controllers/disposalController');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);
router.post('/', requireRole('admin', 'pharmacist'), disposalController.createDisposal);
router.get('/', disposalController.getDisposals);

module.exports = router;
