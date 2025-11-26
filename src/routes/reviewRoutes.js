const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth'); // Import middleware như User module

// Import controller
const {
  getReviews,
  createReview,
  markHelpful,
  upsertReaction,
  getPurchasedItems,
  getProductList
} = require('../controllers/reviewController');

// --- PUBLIC ROUTES (Giống User login/register) ---

// 1. Lấy danh sách sản phẩm cho Dropdown (Đặt lên đầu để tránh bị nhầm với ID)
router.get('/products', getProductList);

// 2. Lấy review theo ID sản phẩm trên URL (Chuẩn RESTful như User module)
// VD: GET /api/reviews/KNIFE-002
router.get('/:id', getReviews); 

// 3. Lấy review theo Query Param (Fallback cho cách cũ)
// VD: GET /api/reviews?productId=KNIFE-002
router.get('/', getReviews);


// --- PROTECTED ROUTES (Cần đăng nhập như User /me) ---

// 4. Viết review mới
router.post('/', verifyToken, createReview);

// 5. Thả tim/Reaction
router.post('/:id/reactions', verifyToken, upsertReaction);

// 6. Lấy danh sách hàng đã mua chờ đánh giá
router.get('/purchased', verifyToken, getPurchasedItems);

// (Optional) Mark Helpful - Giữ lại nếu cần
router.post('/:id/helpful', verifyToken, markHelpful);

module.exports = router;