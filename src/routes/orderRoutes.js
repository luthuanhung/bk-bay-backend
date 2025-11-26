const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const { 
    createOrder, 
    getOrderDetails, 
    getTopSellingProducts 
} = require('../controllers/orderController');

// Public routes
router.post('/', verifyToken, createOrder);
router.get('/details', verifyToken, getOrderDetails);
router.get('/reports/top-selling', verifyToken, getTopSellingProducts);

module.exports = router;