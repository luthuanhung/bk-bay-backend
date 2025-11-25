const productModel = require('../models/Product');

/**
 * GET /api/products/categories
 */
const getCategories = async (req, res) => {
    try {
        const categories = await productModel.getCategories();
        res.status(200).json({
            success: true,
            categories
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch categories',
            error: err.message
        });
    }
};

/**
 * GET /api/products/seller/:sellerId
 */
const getProductBySeller = async (req, res) => {
    try {
        const { sellerId } = req.params;
        if (!sellerId) {
            return res.status(400).json({
                success: false,
                message: 'sellerId is required'
            });
        }

        const products = await productModel.getProductBySeller(sellerId);

        res.status(200).json({
            success: true,
            products
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products for seller',
            error: err.message
        });
    }
};

/**
 * GET /api/products/search?name=...
 *
 * Returns products whose name contains the given substring.
 */
const getProductByName = async (req, res) => {
    try {
        const name = req.query.name;
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'query parameter "name" is required'
            });
        }

        const products = await productModel.getProductByName(name);

        res.status(200).json({
            success: true,
            products
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to search products by name',
            error: err.message
        });
    }
};

/**
 * GET /api/products/all
 *
 * Returns all products in the database.
 */
const getAllProduct = async (req, res) => {
    try {
        const products = await productModel.getAllProduct();
        res.status(200).json({
            success: true,
            products
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch all products',
            error: err.message
        });
    }
};

/**
 * GET /api/products/:barcode

 *  - recordsets[0] => product row(s)
 *  - recordsets[1] => images
 *  - recordsets[2] => variations
 *  - recordsets[3] => categories
 */
const getProductDetails = async (req, res) => {
    try {
        const { barcode } = req.params;
        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: 'barcode is required'
            });
        }

        const result = await productModel.getProductDetails(barcode);

        // result may be an array of recordsets or a single recordset depending on the stored proc
        if (Array.isArray(result)) {
            const product = (result[0] && result[0][0]) || null;
            const images = result[1] || [];
            const variations = result[2] || [];

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            return res.status(200).json({
                success: true,
                product,
                images,
                variations
            });
        } else {
            // fallback: single recordset / object
            return res.status(200).json({
                success: true,
                data: result
            });
        }
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product details',
            error: err.message
        });
    }
};

const getProductByCategory = async (req, res) => {
    try {
        // accept category from either route param or query string
        const category = req.params.category || req.query.category;
        if (!category) {
            return res.status(400).json({
                success: false,
                message: 'category is required (use /category/:category or ?category=...)'
            });
        }

        const products = await productModel.getProductByCategory(category);

        res.status(200).json({
            success: true,
            products
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products for category',
            error: err.message
        });
    }
};

module.exports = {
    getCategories,
    getProductByCategory,
    getProductByName,
    getAllProduct,
    getProductDetails,
};