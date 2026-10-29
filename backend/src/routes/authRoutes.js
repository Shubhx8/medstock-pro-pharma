const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, requireRole } = require('../middleware/auth');

router.post('/login', authController.login);
router.get('/me', verifyToken, authController.me);
router.get('/users', verifyToken, authController.getAllUsers);
router.post('/users', verifyToken, requireRole('admin'), authController.createUser);
router.put('/users/:id', verifyToken, requireRole('admin'), authController.updateUser);
router.delete('/users/:id', verifyToken, requireRole('admin'), authController.deleteUser);

module.exports = router;

