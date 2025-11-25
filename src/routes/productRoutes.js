const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const {
    getCategories,
    getProductByName,
    getAllProduct,
    getProductByCategory,
    getProductDetails
} = require('../controllers/productController');

// Public routes
router.get('/categories', getCategories);
router.get('/categories', getProductByCategory);

// Search by name: /api/products/search?name=apple
router.get('/search', getProductByName);

// Get all products
router.get('/all', getAllProduct);

// Generic barcode route must come last to avoid capturing other routes
router.get('/:barcode', getProductDetails);

module.exports = router;