const express = require('express');
const router = express.Router();
const batchController = require('../controllers/batchController');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', batchController.getBatches);
router.get('/expired', batchController.getExpiredBatches);
router.get('/:id', batchController.getBatchById);
router.post('/', batchController.createBatch);

module.exports = router;
