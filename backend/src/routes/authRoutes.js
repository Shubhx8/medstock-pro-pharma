const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

router.post('/login', authController.login);
router.get('/me', verifyToken, authController.me);
router.get('/users', verifyToken, authController.getAllUsers);
router.post('/users', verifyToken, authController.createUser);
router.put('/users/:id', verifyToken, authController.updateUser);
router.delete('/users/:id', verifyToken, authController.deleteUser);

module.exports = router;

