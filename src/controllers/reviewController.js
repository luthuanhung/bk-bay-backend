const reviewModel = require('../models/Review');
const userModel = require('../models/User');
const userUtils = require('../utils/userUtils');

console.log('[reviewController] loaded');


// Hàm lấy danh sách Review (Đã nâng cấp)
const getReviews = async (req, res) => {
    // Log để debug (Giống style User Controller)
    console.log('[reviewController.getReviews] entry', { params: req.params, query: req.query });

    try {
        // [LOGIC THÔNG MINH] Ưu tiên lấy ID từ URL (:id), nếu không có thì lấy từ Query (?productId)
        // Đây là chìa khóa để fix lỗi "Endpoint not found"
        const barcode = req.params.id || req.query.productId;
        
        // Lấy các tham số lọc phụ
        const filterRating = req.query.rating && req.query.rating !== 'all' ? parseInt(req.query.rating) : null;
        const sortByDate = req.query.sort || 'DESC';

        // Validate đầu vào (Giống User Controller check missing params)
        if (!barcode) {
            console.log('[reviewController.getReviews] Missing Product ID');
            return res.status(400).json({ success: false, message: 'Product ID is required' });
        }

        // Gọi Model (Clean Architecture giống User module)
        console.log('[reviewController.getReviews] Calling model', { barcode });
        const reviews = await reviewModel.getReviewsByProductId(barcode, filterRating, sortByDate);

        // Trả về kết quả chuẩn format
        res.status(200).json({
            success: true,
            data: reviews
        });

    } catch (error) {
        console.error('[reviewController.getReviews] ERROR:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc  Create a review
// @route POST /api/reviews
// @access Private (expects verifyToken to set req.user)
// body must include: { orderId, orderItemId, rating, content }
const createReview = async (req, res) => {
  console.log('[reviewController.createReview] entry', { body: req.body, user: req.user && req.user.Id });
  try {
    const user = req.user;
    if (!user) {
      console.log('[reviewController.createReview] no user in req');
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // For current DB schema we require orderId and orderItemId to link the review via Write_review
    const { orderId, orderItemId, rating = 5, content } = req.body;
    if (!orderId || !orderItemId || !content || !content.trim()) {
      console.log('[reviewController.createReview] missing params', { orderId, orderItemId, contentPresent: !!content });
      return res.status(400).json({ success: false, message: 'orderId, orderItemId and content are required' });
    }

    console.log('[reviewController.createReview] calling model.createReview', { orderId, orderItemId, rating });
    const created = await reviewModel.createReview({
      orderId,
      orderItemId,
      userId: user.Id,
      rating: Number(rating) || 0,
      content: content.trim()
    });
    console.log('[reviewController.createReview] model returned', { createdId: created && created.id });

    res.status(201).json({ success: true, message: 'Review created', review: created });
  } catch (err) {
    console.error('[reviewController.createReview] ERROR:', err);
    // If DB trigger raised error (e.g., eligibility), propagate message
    res.status(500).json({ success: false, message: 'Failed to create review', error: err.message });
  }
};

// @desc  Mark a review as helpful
// @route POST /api/reviews/:id/helpful
// @access Private
const markHelpful = async (req, res) => {
  console.log('[reviewController.markHelpful] entry', { params: req.params, user: req.user && req.user.Id });
  try {
    const { id } = req.params;
    if (!id) {
      console.log('[reviewController.markHelpful] missing id');
      return res.status(400).json({ success: false, message: 'Review id is required' });
    }
    const user = req.user;
    if (!user) {
      console.log('[reviewController.markHelpful] no user in req');
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Use upsertReaction to insert/update a 'helpful' reaction
    console.log('[reviewController.markHelpful] calling model.upsertReaction', { id, authorId: user.Id, reactionType: 'helpful' });
    const updated = await reviewModel.upsertReaction({ reviewId: id, authorId: user.Id, reactionType: 'helpful' });
    console.log('[reviewController.markHelpful] model returned', { updated });

    if (!updated) return res.status(404).json({ success: false, message: 'Review not found' });

    res.status(200).json({ success: true, message: 'Marked helpful', review: updated });
  } catch (err) {
    console.error('[reviewController.markHelpful] ERROR:', err);
    res.status(500).json({ success: false, message: 'Failed to mark helpful', error: err.message });
  }
};

// Upsert a reaction (generic)
// POST /api/reviews/:id/reactions { type: 'Like' }
const upsertReaction = async (req, res) => {
  console.log('[reviewController.upsertReaction] entry', { params: req.params, body: req.body, user: req.user && req.user.Id });
  try {
    const user = req.user;
    if (!user) {
      console.log('[reviewController.upsertReaction] no user in req');
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { id } = req.params; // review id
    const { type } = req.body; // e.g. 'Like', 'helpful'
    if (!type) {
      console.log('[reviewController.upsertReaction] missing type');
      return res.status(400).json({ success: false, message: 'Reaction type required' });
    }

    console.log('[reviewController.upsertReaction] calling model.upsertReaction', { id, authorId: user.Id, type });
    const updated = await reviewModel.upsertReaction({ reviewId: id, authorId: user.Id, reactionType: type });
    console.log('[reviewController.upsertReaction] model returned', { updated });

    res.status(200).json({ success: true, message: 'Reaction recorded', review: updated });
  } catch (err) {
    console.error('[reviewController.upsertReaction] ERROR:', err);
    res.status(500).json({ success: false, message: 'Failed to record reaction', error: err.message });
  }
};

// GET /api/reviews/purchased - list purchased items that can be reviewed
const getPurchasedItems = async (req, res) => {
  console.log('[reviewController.getPurchasedItems] entry', { user: req.user && req.user.Id });
  try {
    const user = req.user;
    if (!user) {
      console.log('[reviewController.getPurchasedItems] no user in req');
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    console.log('[reviewController.getPurchasedItems] calling model.getPurchasedItemsForReview', { userId: user.Id });
    const items = await reviewModel.getPurchasedItemsForReview(user.Id);
    console.log('[reviewController.getPurchasedItems] model returned count', { count: Array.isArray(items) ? items.length : 0 });

    res.status(200).json({ success: true, items });
  } catch (err) {
    console.error('[reviewController.getPurchasedItems] ERROR:', err);
    res.status(500).json({ success: false, message: 'Failed to load purchased items', error: err.message });
  }
};

// @desc  Get simple product list for UI selectors
// @route GET /api/reviews/simple-list
// @access Public
const getProductList = async (req, res) => {
    console.log('[reviewController.getProductList] entry');
    try {
        const data = await reviewModel.getProductListSimple();
        console.log('[reviewController.getProductList] model returned', { count: Array.isArray(data) ? data.length : 0 });
        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('[reviewController.getProductList] ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
  getReviews,
  createReview,
  markHelpful,
  upsertReaction,
  getPurchasedItems,
  getProductList
};