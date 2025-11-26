const orderModel = require('../models/Order');
const userModel = require('../models/User');
const userUtils = require('../utils/userUtils');

//@desc   Create a new order
//@route  POST /api/orders
//@access Private
const createOrder = async (req, res) => {
  try {
    const buyerId = req.user?.Id;
    if (!buyerId) { 
        return res.status(401).json({ success: false, message: 'Authentication required: Buyer ID not available' });
    }
    const role = await userModel.checkRole(buyerId);
    if (role !== 'buyer' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // For current DB schema we require orderId and orderItemId to link the review via Write_review
    const {
        address,
        status,
        quantity,
        price,
        barcode,
        variationname
    } = req.body;
    if (!address || !quantity || !price || !barcode || !variationname) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required fields: address, quantity, price, barcode, and variationname.' 
        });
    }

    const created = await orderModel.createOrder({
        buyerId,
        address,
        status: status || 'Pending', // Giá trị mặc định nếu không có status
        quantity: parseInt(quantity, 10),
        price: Number(price),
        barcode,
        variationname
    });

    res.status(201).json({ success: true, message: 'Order created', order: created });
  } catch (err) {
    console.error('CREATE ORDER ERROR:', err);
    if (err.message && (err.message.includes('required') || err.message.includes('Cannot insert the value NULL'))) {
        return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Failed to create order', error: err.message });
  }
};

/**
 * @desc Lấy danh sách Order chi tiết có lọc
 * @route GET /api/orders/details
 * @access Private (Dành cho Admin/Quản lý)
 */
const getOrderDetails = async (req, res) => {
    try {
        // 1. Kiểm tra Quyền truy cập (Authorization)
        // 2. Lấy tham số lọc từ Query Parameters
        const statusFilter = req.query.status || null; // statusFilter có thể là 'Pending', 'Delivered', v.v.
        const minItems = parseInt(req.query.minItems) || 0; 

        const orders = await orderModel.getOrderDetails(statusFilter, minItems);

        res.status(200).json({
            success: true,
            count: orders.length,
            data: orders
        });
    } catch (err) {
        console.error('GET ORDER DETAILS ERROR:', err.message);
        
        // Xử lý lỗi hệ thống hoặc lỗi từ SP (ví dụ: lỗi TRY...CATCH trong SP)
        if (err.message.includes('Database Error')) { 
             return res.status(503).json({ success: false, message: 'Database query failed.', error: err.message });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve order details.', 
            error: err.message 
        });
    }
};

/**
 * @desc Lấy báo cáo sản phẩm bán chạy nhất, có lọc theo số lượng và Seller.
 * @route GET /api/orders/reports/top-selling
 * @access Private (Thường dành cho Seller/Admin)
 */
const getTopSellingProducts = async (req, res) => {
    try {
        // Kiểm tra Quyền truy cập (Authorization)
        const requestorId = req.user?.Id;
        // (Nếu req.user là Seller, chỉ được xem sản phẩm của mình)
        // (Nếu req.user là Admin, có thể xem sản phẩm của Seller khác bằng cách dùng req.query.sellerId)

        const minQuantity = parseInt(req.query.minQuantity) || 0; 
        
        // Nếu là Seller, SellerId phải là ID của chính họ. Nếu là Admin, có thể lọc theo Seller khác.
        // Giả định: Controller này chỉ dành cho Seller/Admin.
        const sellerIdFilter = req.query.sellerId || requestorId || null; 
        const products = await orderModel.getTopSellingProducts(minQuantity, sellerIdFilter);

        res.status(200).json({
            success: true,
            count: products.length,
            data: products
        });

    } catch (err) {
        console.error('GET TOP SELLING PRODUCTS ERROR:', err.message);
        
        if (err.message.includes('Database Error')) { 
             return res.status(503).json({ success: false, message: 'Database query failed.', error: err.message });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve top selling products report.', 
            error: err.message 
        });
    }
};

module.exports = {
    createOrder,
    getOrderDetails,
    getTopSellingProducts
};