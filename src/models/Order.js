// src/models/Order.js
const pool = require('../config/database');
const sql = require('mssql');
const { generateId } = require('../utils/userUtils');

async function getTotalByOrderId(orderId) {
    const request = pool.request();
    request.input('orderId', sql.VarChar, orderId);
    
    // Truy vấn cột Total đã được cập nhật
    const result = await request.query('SELECT Total FROM [Order] WHERE ID = @orderId'); 
    
    // Trả về giá trị Total (hoặc 0 nếu lỗi)
    return result.recordset[0]?.Total || 0;
}

async function getOrderById(orderId, buyerId) {
    const request = pool.request();
    request.input('orderId', sql.VarChar, orderId);
    request.input('buyerId', sql.VarChar, buyerId);
    const result = await request.query('SELECT ID, Total, [Address], buyerID, [Time], [Status] FROM [Order] WHERE ID = @orderId AND buyerID = @buyerId');
    const order = result.recordset[0];
    if (!order) return null;

    try {
        const oiReq = pool.request();
        oiReq.input('orderId', sql.VarChar, orderId);
        const oiRes = await oiReq.query(`
            SELECT ID AS orderItemID, Quantity, Price, BarCode, Variation_Name FROM Order_Item WHERE orderID = @orderId
        `);
        order.orderItems = oiRes.recordset || [];
    } catch (e) {
        order.orderItems = [];
    }
    return order;
}

const createOrder = async ({ Id, orderItemId, buyerId, address, status, quantity, price, barcode, variationname }) => {
    // 1. Create a transaction using the existing pool
    const transaction = new sql.Transaction(pool);

    try {
        // Start Transaction
        await transaction.begin();

        // Use the provided id (from controller) when available so tokens match DB id.
        // If no id provided, generate one.
        const orderId = Id || generateId();
        const itemIdentifier = orderItemId || generateId();

        // 2. Insert into "Order" Table
        const oreq = new sql.Request(transaction);
        oreq.input('id', sql.VarChar, orderId);
        oreq.input('address', sql.VarChar, address);
        oreq.input('status', sql.VarChar, status);
        oreq.input('buyerId', sql.VarChar, buyerId);
        await oreq.query(`
            INSERT INTO [Order] (ID, [Address], buyerID, [Time], [Status])
            VALUES (@id, @address, @buyerId, GETDATE(), @status)
        `);

        if (!barcode || !variationname) {
            await transaction.rollback();
            throw new Error('barcode and variationname are required to link (Order_item)');
        }

        const oitemreq = new sql.Request(transaction);
        oitemreq.input('price', sql.Decimal, price);
        oitemreq.input('barcode', sql.VarChar, barcode);
        oitemreq.input('variation_name', sql.VarChar, variationname);
        oitemreq.input('quantity', sql.Int, quantity);
        oitemreq.input('id', sql.VarChar, itemIdentifier);
        oitemreq.input('orderId', sql.VarChar, orderId);
        await oitemreq.query(`
            INSERT INTO Order_Item (Price, BarCode, Variation_Name, Quantity, ID, OrderID) 
            VALUES (@price, @barcode, @variation_name, @quantity, @id, @orderId)
        `);

        // 5. Commit Transaction (Save everything)
        await transaction.commit();

        const finalTotal = await getTotalByOrderId(orderId);

        return { 
            id: orderId, 
            total: finalTotal, 
            address: address, 
            status: status,
            buyerId: buyerId,
            orderItemId: orderItemId,
            quantity: quantity,
            price: price,
            barcode: barcode,
            variationname: variationname,
        };

    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};

async function updateOrder({ orderId, newStatus, newAddress }) {
    const transaction = new sql.Transaction(pool); 
    
    try {
        await transaction.begin();
        
        const request = new sql.Request(transaction);
        
        request.input('p_OrderID', sql.VarChar, orderId);
        request.input('p_NewStatus', sql.VarChar, newStatus || null);
        request.input('p_NewAddress', sql.VarChar, newAddress || null);

        await request.query(`
            UPDATE [Order] 
            SET 
                [Status] = COALESCE(@p_NewStatus, [Status]),
                Address = COALESCE(@p_NewAddress, Address)
            WHERE ID = @p_OrderID;
        `);

        await transaction.commit();

        return { success: true, orderId, updatedStatus: newStatus, updatedAddress: newAddress };
        
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}

async function deleteOrder({ orderId, userId }) {
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // 1. Kiểm tra Status và Quyền (SELECT DỮ LIỆU TRƯỚC KHI XÓA)
        const checkReq = new sql.Request(transaction);
        checkReq.input('p_OrderID', sql.VarChar, orderId);
        checkReq.input('p_UserID', sql.VarChar, userId);
        const checkResult = await checkReq.query(`
            SELECT [Status], buyerID FROM [Order] WHERE ID = @p_OrderID;
        `);
        
        const order = checkResult.recordset[0];
        if (!order) {
            await transaction.rollback();
            throw new Error('Order not found.');
        }

        if (order.Status !== 'Pending' && order.Status !== 'Processing') {
            await transaction.rollback();
            throw new Error('Cannot delete/cancel an order that is in transit or delivered.');
        }
        
        // 2. Thực hiện xóa DML SQL thuần
        const deleteReq = new sql.Request(transaction);
        deleteReq.input('p_OrderID', sql.VarChar, orderId);
        await deleteReq.query(`DELETE FROM [Order] WHERE ID = @p_OrderID AND buyerID = @p_UserID;`);
        
        // 3. Commit Transaction
        await transaction.commit();
        
        return { orderId, deleted: true };
        
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}

// 1. Hàm gọi usp_GetOrderDetails (Mục 2.3 - Query 1)
// src/models/Order.js (Hàm getOrderDetails đã cải tiến)

async function getOrderDetails(statusFilter, minItems) {    
    // 1. Ưu tiên 1: Gọi Stored Procedure (Tối ưu nhất cho Req 2.3)
    try {
        const request = pool.request();
        request.input('p_StatusFilter', sql.VarChar, statusFilter);
        request.input('p_MinItems', sql.Int, parseInt(minItems, 10) || 0);

        // Chạy SP
        result = await request.execute('usp_GetOrderDetails');
        
        return result.recordset;

    } catch (e) {
        // Dự phòng kích hoạt nếu SP không tồn tại hoặc lỗi
        console.warn(`WARN: Failed to execute usp_GetOrderDetails. Falling back to SQL query. Error: ${e.message}`);
        
        // 2. Dự phòng (Fallback): SQL thuần đơn giản
        // Lưu ý: Cần đảm bảo các bảng liên quan tồn tại (Order, User)
        try {
            const fallbackReq = pool.request();
            fallbackReq.input('p_StatusFilter', sql.VarChar, statusFilter);

            const fallbackQuery = `
                SELECT 
                    O.ID, O.[Status], O.Total, U.FullName AS Buyer 
                FROM [Order] O 
                INNER JOIN [User] U ON O.buyerID = U.ID
                WHERE (@p_StatusFilter IS NULL OR O.[Status] = @p_StatusFilter)
                ORDER BY O.[Time] DESC;
            `;
            
            const fallbackRes = await fallbackReq.query(fallbackQuery);
            return fallbackRes.recordset;

        } catch (fallbackError) {
            // Nếu cả cơ chế dự phòng cũng thất bại (Ví dụ: lỗi kết nối)
            console.error('FATAL FALLBACK ERROR:', fallbackError.message);
            throw fallbackError;
        }
    }
}

// 2. Hàm gọi usp_GetTopSellingProducts (Mục 2.3 - Query 2)
async function getTopSellingProducts(minQuantity, sellerId) {
    try {
        const request = pool.request();
        request.input('p_MinQuantitySold', sql.Int, parseInt(minQuantity, 10) || 0);
        request.input('p_SellerID', sql.VarChar, sellerId || null); 

        const result = await request.execute('usp_GetTopSellingProducts');
        
        // 3. Trả về tập kết quả
        return result.recordset || [];

    } catch (e) {
        console.warn(`WARN: Failed to execute usp_GetTopSellingProducts. Falling back to simple SQL query. Error: ${e.message}`);
        
        try {
            const fallbackReq = pool.request();
            fallbackReq.input('p_SellerID', sql.VarChar, sellerId || null);
            const fallbackQuery = `
                SELECT 
                    PS.Bar_code,
                    PS.[Name],
                    SUM(OI.Quantity) AS TotalQuantitySold
                FROM Order_Item OI
                INNER JOIN [Order] O ON OI.OrderID = O.ID
                INNER JOIN Product_SKU PS ON OI.BarCode = PS.Bar_code
                WHERE
                    O.[Status] IN ('Delivered', 'Completed')
                    AND (@p_SellerID IS NULL OR PS.sellerID = @p_SellerID) 
                GROUP BY
                    PS.Bar_code, PS.[Name]
                ORDER BY
                    TotalQuantitySold DESC;
            `;
            
            const fallbackRes = await fallbackReq.query(fallbackQuery);
            
            return fallbackRes.recordset || [];

        } catch (fallbackError) {
            console.error('FATAL FALLBACK ERROR IN GET TOP PRODUCTS:', fallbackError.message);
            throw fallbackError;
        }
    }
}

async function claimOrder({ orderId, shipperId }) {
    const transaction = new sql.Transaction(pool);
    
    try {
        await transaction.begin(); 
        
        const request = new sql.Request(transaction); 
        
        request.input('p_OrderID', sql.VarChar, orderId);
        request.input('p_ShipperID', sql.VarChar, shipperId);
        
        // T-SQL TRANSACTION DML: Claim Order
        const claimQuery = `
            DECLARE @v_CurrentStatus VARCHAR(100);
            
            -- 1. Kiểm tra trạng thái hiện tại (Validation: Phải ở Processing)
            SELECT @v_CurrentStatus = [Status] FROM [Order] WHERE ID = @p_OrderID;

            IF @v_CurrentStatus IS NULL
            BEGIN
                THROW 50005, 'Order not found.', 1;
                RETURN;
            END

            IF @v_CurrentStatus <> 'Processing'
            BEGIN
                THROW 50006, 'Order status must be "Processing" to be claimed.', 1;
                RETURN;
            END

            -- 2. INSERT vào bảng Deliver (Claim the Order)
            INSERT INTO Deliver (ShipperID, OrderID, Departure_time, Finish_time, ShippingFee)
            VALUES (@p_ShipperID, @p_OrderID, NULL, NULL, NULL); 

            -- 3. UPDATE trạng thái Order: Processing -> Dispatched
            UPDATE [Order] 
            SET [Status] = 'Dispatched' 
            WHERE ID = @p_OrderID;
            
            -- Trả về trạng thái mới
            SELECT 'Dispatched' AS NewStatus;
        `;

        const result = await request.query(claimQuery);

        await transaction.commit(); 
        
        return { 
            success: true, 
            newStatus: result.recordset[0]?.NewStatus || 'Dispatched',
            orderId: orderId
        };
        
    } catch (e) {
        await transaction.rollback(); 
        throw e;
    }
}

// src/models/Order.js (confirmDelivery)

async function confirmDelivery({ orderId, shipperId }) {
    const transaction = new sql.Transaction(pool);
    
    try {
        await transaction.begin(); 
        
        const request = new sql.Request(transaction);
        request.input('p_OrderID', sql.VarChar, orderId);
        request.input('p_ShipperID', sql.VarChar, shipperId);

        // T-SQL TRANSACTION DML: Confirm Delivery
        const confirmQuery = `
            DECLARE @v_CurrentStatus VARCHAR(100);
            
            -- 1. Kiểm tra trạng thái hiện tại (Validation: Phải ở Delivering)
            SELECT @v_CurrentStatus = [Status] FROM [Order] WHERE ID = @p_OrderID;

            IF @v_CurrentStatus <> 'Delivering'
            BEGIN
                THROW 50007, 'Order must be in "Delivering" status to be confirmed as delivered.', 1;
                RETURN;
            END
            
            -- 2. UPDATE bảng Deliver: Ghi nhận Finish_time
            UPDATE Deliver
            SET Finish_time = GETDATE()
            WHERE OrderID = @p_OrderID AND ShipperID = @p_ShipperID;

            -- 3. UPDATE trạng thái Order: Delivering -> Delivered
            UPDATE [Order] 
            SET [Status] = 'Delivered' 
            WHERE ID = @p_OrderID;
            
            -- Trả về trạng thái mới
            SELECT 'Delivered' AS NewStatus;
        `;

        const result = await request.query(confirmQuery);

        await transaction.commit();
        
        return { 
            success: true, 
            newStatus: result.recordset[0]?.NewStatus || 'Delivered',
            orderId: orderId
        };
        
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}

module.exports = {
    getTotalByOrderId,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    getOrderDetails,
    getTopSellingProducts,
    claimOrder,
    confirmDelivery
};