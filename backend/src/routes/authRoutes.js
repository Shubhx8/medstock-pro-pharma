const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

router.post('/login', authController.login);
router.get('/me', verifyToken, authController.me);
router.get('/users', verifyToken, authController.getAllUsers);

module.exports = router;
