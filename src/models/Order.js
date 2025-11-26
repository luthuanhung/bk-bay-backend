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

        // 2. Insert into "Order" Table
        const oreq = new sql.Request(transaction);
        oreq.input('id', sql.VarChar, orderId);
        // oreq.input('total', sql.Decimal, total);
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
        oitemreq.input('id', sql.VarChar, orderItemId);
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

module.exports = {
    getTotalByOrderId,
    getOrderById,
    createOrder,
    getOrderDetails,
    getTopSellingProducts,
    // ...
};