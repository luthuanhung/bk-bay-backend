const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const {
    getCategories,
    getProductByName,
    getAllProduct,
    getProductByCategory,
    getProductDetails,
    assignCategory
} = require('../controllers/productController');

// Public routes
router.get('/categories', getCategories);
router.get('/categories', getProductByCategory);

// Search by name: /api/products/search?name=apple
router.get('/search', getProductByName);

// Get all products
router.get('/all', getAllProduct);

// Assign category to product: POST /api/products/:barcode/category
router.post('/:barcode/category', assignCategory);

// Generic barcode route must come last to avoid capturing other routes
router.get('/:barcode', getProductDetails);

module.exports = router;