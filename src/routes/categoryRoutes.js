const express = require('express');
const router = express.Router();

const {
    getCategories,
    assignCategory
} = require('../controllers/productController');

// Get all categories: GET /api/categories
router.get('/', getCategories);

// Assign category to product: POST /api/categories/:barcode
router.post('/:barcode', assignCategory);

module.exports = router;
