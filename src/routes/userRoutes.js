const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const {
    registerUser, 
    loginUser,
    getCurrentUser
} = require('../controllers/userController');

// Public routes
router.post('/register', registerUser);
router.get('/me', verifyToken, getCurrentUser);
router.post('/login', loginUser);

module.exports = router;