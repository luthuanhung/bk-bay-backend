const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const controller = require('../controllers/sellerProductsController');

// All routes require authentication (seller)
router.get('/products', verifyToken, controller.listProducts);
router.get('/products/:id', verifyToken, controller.getProduct);
router.post('/products', verifyToken, controller.createProduct);
router.post('/products/:id/variations', verifyToken, controller.insertVariations);
router.put('/products/:id', verifyToken, controller.updateProduct);
router.patch('/products/:id', verifyToken, controller.patchProduct);
router.delete('/products/:id', verifyToken, controller.deleteProduct);



module.exports = router;
