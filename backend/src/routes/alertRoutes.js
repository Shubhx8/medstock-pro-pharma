const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', alertController.getAlerts);
router.post('/generate', alertController.generateAlerts);
router.patch('/:id/resolve', alertController.resolveAlert);

module.exports = router;
