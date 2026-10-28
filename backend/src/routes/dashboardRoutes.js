const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/summary', dashboardController.getDashboardSummary);

module.exports = router;
