const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const {
  getReviews,
  createReview,
  markHelpful,
  upsertReaction,
  getPurchasedItems,
  getProductList,
  replyToReview
} = require('../controllers/reviewController');

// --- 1. CÁC ROUTE CỤ THỂ (STATIC ROUTES) - PHẢI ĐỂ TRÊN CÙNG ---

// Lấy danh sách sản phẩm cho Dropdown
router.get('/products', getProductList);

// [QUAN TRỌNG] Route này phải nằm TRÊN route /:id
// Lấy danh sách hàng đã mua chờ đánh giá
router.get('/purchased', verifyToken, getPurchasedItems);


// --- 2. CÁC ROUTE ĐỘNG (DYNAMIC ROUTES) - ĐỂ DƯỚI CÙNG ---
router.post('/:id/reply', verifyToken, replyToReview);
// Lấy review theo ID sản phẩm (VD: /api/reviews/BOOK-005)
// Nếu để dòng này lên trên, nó sẽ "ăn" mất chữ "purchased"
router.get('/:id', getReviews); 

// Fallback (Query param)
router.get('/', getReviews);


// --- 3. CÁC ROUTE POST (KHÔNG ẢNH HƯỞNG THỨ TỰ DO KHÁC METHOD) ---
router.post('/', verifyToken, createReview);

router.post('/:id/helpful', verifyToken, markHelpful);
router.post('/:id/reactions', verifyToken, upsertReaction);

module.exports = router;