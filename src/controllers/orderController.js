const orderModel = require('../models/Order');
const userModel = require('../models/User');
const userUtils = require('../utils/userUtils');

const checkShipperRole = async (userId) => {
    if (!userId) return false;
    const role = await userModel.checkRole(userId);
    return role === 'shipper' || role === 'admin'; // Admin cũng có quyền quản lý
}

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
 * @desc   Update Order (Status/Address)
 * @route  PUT /api/orders/:orderId
 * @access Private (Buyer/Admin)
 */
const updateOrder = async (req, res) => {
    try {
        const buyerId = req.user?.Id;
        const orderId = req.params.orderId;
        const { newStatus, newAddress } = req.body;
        
        // 1. Kiểm tra Authentication
        if (!buyerId) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }
        
        // 2. Kiểm tra Quyền (Chỉ Buyer hoặc Admin mới được thay đổi Order)
        const role = await userModel.checkRole(buyerId);
        if (role !== 'buyer' && role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied: You must be a buyer or an admin.' });
        }

        // 3. Kiểm tra dữ liệu đầu vào
        if (!newStatus && !newAddress) {
            return res.status(400).json({ success: false, message: 'Missing fields: must provide newStatus or newAddress.' });
        }
        
        // 4. Gọi Model để thực hiện UPDATE
        // Hàm Model sẽ kiểm tra: 
        // a) orderId có tồn tại không. 
        // b) buyerId có khớp không.
        const updated = await orderModel.updateOrder({ 
            orderId, 
            newStatus, 
            newAddress, 
            userId: buyerId // Truyền buyerId để Model check quyền sở hữu
        });

        res.status(200).json({ 
            success: true, 
            message: `Order ${orderId} updated successfully.`, 
            data: updated 
        });

    } catch (err) {
        console.error('UPDATE ORDER ERROR:', err);
        // Xử lý các lỗi nghiệp vụ cụ thể từ Model
        if (err.message.includes('Order not found')) {
            return res.status(404).json({ success: false, message: err.message });
        }
        if (err.message.includes('Cannot delete/cancel')) {
             return res.status(400).json({ success: false, message: err.message });
        }
        if (err.message.includes('Transaction failed')) { 
             return res.status(400).json({ success: false, message: 'Update failed due to database constraint or business logic error.' });
        }
        
        res.status(500).json({ success: false, message: 'Failed to update order.', error: err.message });
    }
};

/**
 * @desc   Delete an Order (Cancel)
 * @route  DELETE /api/orders/:orderId
 * @access Private (Buyer/Admin)
 */
const deleteOrder = async (req, res) => {
    try {
        const buyerId = req.user?.Id;
        const orderId = req.params.orderId;

        // 1. Kiểm tra Authentication
        if (!buyerId) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }
        
        // 2. Kiểm tra Quyền
        const role = await userModel.checkRole(buyerId);
        if (role !== 'buyer' && role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied: Only the buyer or admin can delete/cancel an order.' });
        }
        
        // 3. Gọi Model để thực hiện DELETE
        // Model sẽ kiểm tra: order có tồn tại, có thuộc về buyerId, và Status có cho phép xóa/hủy không.
        await orderModel.deleteOrder({ orderId, userId: buyerId });

        // Sử dụng 204 No Content cho hành động DELETE thành công
        res.status(204).send(); 
        
    } catch (err) {
        console.error('DELETE ORDER ERROR:', err);
        
        // Xử lý các lỗi nghiệp vụ cụ thể từ Model
        if (err.message.includes('Order not found')) {
            return res.status(404).json({ success: false, message: err.message });
        }
        if (err.message.includes('Cannot delete/cancel')) {
             return res.status(400).json({ success: false, message: err.message });
        }
        
        res.status(500).json({ success: false, message: 'Failed to delete order.', error: err.message });
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

/**
 * @desc   Shipper Claim Order (Processing -> Dispatched)
 * @route  POST /api/orders/claim/:orderId
 * @access Private (Shipper/Admin)
 */
const claimOrder = async (req, res) => {
    try {
        const shipperId = req.user?.Id;
        const orderId = req.params.orderId;

        if (!(await checkShipperRole(shipperId))) {
            return res.status(403).json({ success: false, message: 'Access denied: Must be a Shipper or Admin.' });
        }
        
        // 1. Tạm thời không cần VehicleID
        const result = await orderModel.claimOrder({ orderId, shipperId });

        res.status(200).json({ 
            success: true, 
            message: `Order ${orderId} claimed and status updated to ${result.newStatus}.`, 
            newStatus: result.newStatus 
        });

    } catch (err) {
        console.error('SHIPPER CLAIM ERROR:', err.message);
        // Bắt lỗi nghiệp vụ từ Model (ví dụ: Order status must be "Processing")
        res.status(400).json({ success: false, message: 'Claim failed: ' + err.message });
    }
};

/**
 * @desc   Shipper Confirms Delivery (Delivering -> Delivered)
 * @route  POST /api/orders/confirm/:orderId
 * @access Private (Shipper/Admin)
 */
const confirmDelivery = async (req, res) => {
    try {
        const shipperId = req.user?.Id;
        const orderId = req.params.orderId;

        if (!(await checkShipperRole(shipperId))) {
            return res.status(403).json({ success: false, message: 'Access denied: Must be a Shipper or Admin.' });
        }
        
        // 1. Gọi Model để cập nhật Finish_time và Status
        const result = await orderModel.confirmDelivery({ orderId, shipperId });

        res.status(200).json({ 
            success: true, 
            message: `Order ${orderId} successfully delivered and set to ${result.newStatus}.`, 
            newStatus: result.newStatus 
        });

    } catch (err) {
        console.error('CONFIRM DELIVERY ERROR:', err.message);
        // Bắt lỗi nghiệp vụ từ Model (ví dụ: Order must be in "Delivering" status)
        res.status(400).json({ success: false, message: 'Confirmation failed: ' + err.message });
    }
};

module.exports = {
    createOrder,
    getOrderDetails,
    getTopSellingProducts,
    updateOrder,
    deleteOrder,
    claimOrder,
    confirmDelivery
};