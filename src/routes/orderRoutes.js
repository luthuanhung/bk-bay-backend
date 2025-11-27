const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const { 
    createOrder, 
    getOrderDetails, 
    getTopSellingProducts,
    updateOrder,
    deleteOrder,
    claimOrder,
    confirmDelivery
} = require('../controllers/orderController');

// Public routes
router.post('/', verifyToken, createOrder);
router.put('/:orderId', verifyToken, updateOrder);
router.delete('/:orderId', verifyToken, deleteOrder);
router.get('/details', verifyToken, getOrderDetails);
router.get('/reports/top-selling', verifyToken, getTopSellingProducts);
router.post('/claim/:orderId', verifyToken, claimOrder);
router.post('/confirm/:orderId', verifyToken, confirmDelivery);

module.exports = router;