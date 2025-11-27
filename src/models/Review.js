const pool = require('../config/database');
const sql = require('mssql');
const userModel = require('./User');
const { generateId } = require('../utils/userUtils');

// Try to get product reviews via stored proc usp_GetProductReviews.
// If proc missing, fallback to manual JOIN query.
async function getReviewsByProductId(barcode, filterRating = null, sortBy = 'DESC') {
    const req = pool.request();
    req.input('Barcode', sql.VarChar, barcode);
    req.input('FilterRating', sql.Int, filterRating);
    req.input('SortByDate', sql.VarChar, sortBy);

    // Prefer stored proc
    try {
        const result = await req.execute('usp_GetProductReviews');
        const rows = result.recordset || [];
        // Map rows into frontend-friendly shape
        return rows.map(r => ({
            id: r.ReviewID,
            rating: r.Rating,
            content: r.Content, // <-- Added this based on the SP change (r.Description as Content)
            username: r.AuthorName,
            variationName: r.VariationName,
            totalReactions: r.TotalReactions || 0,
            createdAt: r.ReviewDate ? new Date(r.ReviewDate).toISOString() : undefined
        }));
    } catch (err) {
        // Fallback to manual query if proc not present
        const fallbackReq = pool.request();
        fallbackReq.input('barcode', sql.VarChar, barcode);
        // Modified query to fetch Description from Review table directly
        const q = `
            SELECT 
                R.ID as ReviewID, 
                R.Rating, 
                R.Description as Content, -- <-- Fetch Description and alias as Content
                R.[Time] as CreatedAt, 
                WR.UserID
            FROM Review R
            INNER JOIN Write_review WR ON R.ID = WR.ReviewID
            INNER JOIN Order_Item OI ON WR.Order_itemID = OI.ID AND WR.OrderID = OI.orderID
            WHERE OI.BarCode = @barcode
            ORDER BY R.[Time] ${sortBy === 'ASC' ? 'ASC' : 'DESC'}
        `;
        const res = await fallbackReq.query(q);
        const rows = res.recordset || [];

        const reviews = await Promise.all(rows.map(async (r) => {
            const reviewId = r.ReviewID;
            const userId = r.UserID;

            // username
            let username;
            try {
                const u = userId ? await userModel.getUserById(userId) : null;
                username = u ? (u.Username || u.username || u.Full_Name || u.Name) : undefined;
            } catch (e) {
                username = undefined;
            }

            // content is now directly available from the main query as r.Content
            const content = r.Content;

            // helpfulCount
            let helpfulCount = 0;
            try {
                const hreq = pool.request();
                hreq.input('reviewId', sql.VarChar, reviewId);
                const hres = await hreq.query(`SELECT COUNT(*) AS c FROM Reactions WHERE ReviewID = @reviewId AND [Type] = 'helpful'`);
                helpfulCount = (hres.recordset && hres.recordset[0]) ? Number(hres.recordset[0].c) : 0;
            } catch (e) {
                helpfulCount = 0;
            }

            return {
                id: reviewId,
                rating: r.Rating,
                userId,
                username,
                content, // <-- Use content from query
                helpfulCount,
                createdAt: r.CreatedAt ? new Date(r.CreatedAt).toISOString() : undefined
            };
        }));

        return reviews;
    }
}

async function getReviewById(reviewId) {
    const req = pool.request();
    req.input('id', sql.VarChar, reviewId);
    const res = await req.query(`
        SELECT R.ID as ReviewID, R.Rating, R.[Time] as CreatedAt, WR.UserID
        FROM Review R
        LEFT JOIN Write_review WR ON R.ID = WR.ReviewID
        WHERE R.ID = @id
    `);
    const row = res.recordset && res.recordset[0];
    if (!row) return null;

    // Populate content and helpful count
    const reviews = await getReviewsByProductIdForReviewId(row.ReviewID, row.UserID, row.Rating, row.CreatedAt);
    return reviews[0] || null;
}

// helper for getReviewById
async function getReviewsByProductIdForReviewId(reviewId, userId, rating, createdAt) {
    let content;
    try {
        const creq = pool.request();
        creq.input('reviewId', sql.VarChar, reviewId);
        creq.input('author', sql.VarChar, userId);
        const cres = await creq.query(`SELECT TOP 1 Content FROM Replies WHERE ReviewID = @reviewId AND Author = @author ORDER BY [Time] ASC`);
        if (cres.recordset && cres.recordset[0]) content = cres.recordset[0].Content;
    } catch (e) {
        content = undefined;
    }

    let helpfulCount = 0;
    try {
        const hreq = pool.request();
        hreq.input('reviewId', sql.VarChar, reviewId);
        const hres = await hreq.query(`SELECT COUNT(*) AS c FROM Reactions WHERE ReviewID = @reviewId AND [Type] = 'helpful'`);
        helpfulCount = (hres.recordset && hres.recordset[0]) ? Number(hres.recordset[0].c) : 0;
    } catch (e) {
        helpfulCount = 0;
    }

    let username;
    try {
        const u = userId ? await userModel.getUserById(userId) : null;
        username = u ? (u.Username || u.username || u.Full_Name || u.Name) : undefined;
    } catch (e) {
        username = undefined;
    }

    return [{
        id: reviewId,
        rating,
        userId,
        username,
        content,
        helpfulCount,
        createdAt: createdAt ? new Date(createdAt).toISOString() : undefined
    }];
}

const createReview = async ({ id, orderId, orderItemId, userId, rating, content }) => {
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        const reviewId = id || generateId();

        // Insert into Review table, now including the review content in the 'Description' column
        const rreq = new sql.Request(transaction);
        rreq.input('id', sql.VarChar, reviewId);
        rreq.input('rating', sql.Int, parseInt(rating, 10) || 0);
        // Per user, the column for review text in the Review table is 'Description'.
        rreq.input('description', sql.NVarChar, content ? content.trim() : null);

        await rreq.query(`INSERT INTO Review (ID, Rating, Description, [Time]) VALUES (@id, @rating, @description, GETDATE())`);

        // Validate linkage params and insert into Write_review
        if (!orderId || !orderItemId || !userId) {
            await transaction.rollback();
            throw new Error('orderId, orderItemId and userId are required to link review (Write_review)');
        }
        const wreq = new sql.Request(transaction);
        wreq.input('reviewId', sql.VarChar, reviewId);
        wreq.input('userId', sql.VarChar, userId);
        wreq.input('orderItemId', sql.VarChar, orderItemId);
        wreq.input('orderId', sql.VarChar, orderId);
        await wreq.query(`INSERT INTO Write_review (ReviewID, UserID, Order_itemID, OrderID) VALUES (@reviewId, @userId, @orderItemId, @orderId)`);

        // The logic to insert content into the 'Replies' table has been removed as the content is now correctly in 'Review.Description'.

        await transaction.commit();

        const user = userId ? await userModel.getUserById(userId) : null;
        return {
            id: reviewId,
            rating: parseInt(rating, 10) || 0,
            userId,
            username: user ? (user.Username || user.username || user.Full_Name || user.Name) : undefined,
            description: content || undefined,
            helpfulCount: 0,
            createdAt: new Date().toISOString()
        };
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};

// Upsert reaction using stored proc usp_Reactions_Upsert (preferred).
// Proc signature (latest): @ReviewID, @Type, @Author
// Fallback to MERGE if proc not present.
const upsertReaction = async ({ reviewId, authorId, reactionType }) => {
    try {
        const req = pool.request();
        req.input('ReviewID', sql.VarChar, reviewId);
        req.input('Type', sql.VarChar, reactionType);
        req.input('Author', sql.VarChar, authorId);

        try {
            await req.execute('usp_Reactions_Upsert');
        } catch (e) {
            // fallback MERGE
            const mreq = pool.request();
            mreq.input('ReviewID', sql.VarChar, reviewId);
            mreq.input('Author', sql.VarChar, authorId);
            mreq.input('Type', sql.VarChar, reactionType);
            await mreq.query(`
                MERGE INTO Reactions AS target
                USING (SELECT @ReviewID AS ReviewID, @Author AS Author) AS source
                ON (target.ReviewID = source.ReviewID AND target.Author = source.Author)
                WHEN MATCHED THEN
                    UPDATE SET [Type] = @Type
                WHEN NOT MATCHED THEN
                    INSERT (ReviewID, [Type], Author) VALUES (@ReviewID, @Type, @Author);
            `);
        }

        // Compute helpful count (Type = 'helpful')
        const hreq = pool.request();
        hreq.input('reviewId', sql.VarChar, reviewId);
        const hres = await hreq.query(`SELECT COUNT(*) AS c FROM Reactions WHERE ReviewID = @reviewId AND [Type] = 'helpful'`);
        const helpfulCount = (hres.recordset && hres.recordset[0]) ? Number(hres.recordset[0].c) : 0;

        // Return minimal review info including helpfulCount
        const sel = pool.request();
        sel.input('id', sql.VarChar, reviewId);
        const rres = await sel.query(`SELECT ID as ReviewID, Rating, [Time] as CreatedAt FROM Review WHERE ID = @id`);
        const rrow = rres.recordset && rres.recordset[0];
        return {
            id: reviewId,
            rating: rrow ? rrow.Rating : undefined,
            helpfulCount,
            createdAt: rrow && rrow.CreatedAt ? new Date(rrow.CreatedAt).toISOString() : undefined
        };
    } catch (err) {
        throw err;
    }
};

async function getPurchasedItemsForReview(userId) {
    const mapRecord = (item) => ({
        orderId: item.OrderID,
        orderItemId: item.Order_ItemID,
        // [FIX] Thêm dòng này để map ProductID trả về cho Frontend
        productId: item.BarCode || item.ProductID, 
        productName: item.ProductName,
        variationName: item.VariationName,
        price: item.Price,
        purchaseDate: item.PurchaseDate,
        productImage: item.ProductImage,
    });

    try {
        const req = pool.request();
        req.input('UserID', sql.VarChar, userId);
        const result = await req.execute('usp_GetPurchasedItemsForReview');
        return (result.recordset || []).map(mapRecord);
    } catch (err) {
        if (err.message.includes('Could not find stored procedure')) {
            console.warn('[Review.model] Using fallback query.');
            const fallbackReq = pool.request();
            fallbackReq.input('UserID', sql.VarChar, userId);
            
            // [FIX] Đã thêm p.Bar_code vào câu SELECT bên dưới
            const query = `
                SELECT 
                    o.ID AS OrderID,
                    oi.ID AS Order_ItemID,
                    p.Bar_code AS BarCode, -- <--- QUAN TRỌNG: Phải lấy cột này!
                    p.Name AS ProductName,
                    v.NAME AS VariationName,
                    oi.Price,
                    o.Time AS PurchaseDate,
                    (SELECT TOP 1 IMAGE_URL FROM IMAGES img WHERE img.Bar_code = p.Bar_code) AS ProductImage
                FROM [Order] o
                JOIN Order_Item oi ON o.ID = oi.orderID
                JOIN Product_SKU p ON oi.BarCode = p.Bar_code
                LEFT JOIN VARIATIONS v ON oi.BarCode = v.Bar_code AND oi.Variation_Name = v.NAME
                LEFT JOIN Write_review wr ON o.ID = wr.OrderID AND oi.ID = wr.Order_itemID
                WHERE o.buyerID = @UserID
                  AND o.Status IN ('Completed', 'Delivered')
                  AND wr.ReviewID IS NULL
                ORDER BY o.Time DESC;
            `;
            const result = await fallbackReq.query(query);
            return (result.recordset || []).map(mapRecord);
        }
        throw err;
    }
}
/**
 * Get a simplified list of all products for UI selectors.
 * Executes stored procedure `usp_GetAllProductsSimple`.
 * @returns {Promise<Array>}
 */
async function getProductListSimple() {
    try {
        console.log('[Review.model.getProductListSimple] Executing usp_GetAllProductsSimple');
        const result = await pool.request().execute('usp_GetAllProductsSimple');
        return result.recordset || [];
    } catch (error) {
        console.error('[Review.model.getProductListSimple] ERROR:', error);
        // If SP fails, we could have a fallback query here if needed.
        // For now, just re-throw the error.
        throw error;
    }
}

module.exports = {
    getReviewsByProductId,
    getReviewById,
    createReview,
    upsertReaction,
    getPurchasedItemsForReview,
    getProductListSimple
};