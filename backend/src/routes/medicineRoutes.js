const express = require('express');
const router = express.Router();
const medicineController = require('../controllers/medicineController');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', medicineController.getMedicines);
router.get('/:id', medicineController.getMedicineById);
router.post('/', medicineController.createMedicine);
router.put('/:id', medicineController.updateMedicine);
router.delete('/:id', requireRole('admin', 'pharmacist'), medicineController.deleteMedicine);

module.exports = router;
