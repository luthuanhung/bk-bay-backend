# Review Module — Backend API & Database Specification
**Status:** APPROVED (Final Version)

Tài liệu này là source-of-truth cho Backend để hiện thực controller và gọi Stored Procedures chính xác.

## 1. Endpoints Contract
Base path: `/api/reviews`

### A. Lấy danh sách review (Public)
- **Endpoint:** `GET /api/reviews/:barcode`
- **Database Call:** `usp_GetProductReviews`
- **Params:**
  - `@Barcode`: Lấy từ URL param.
  - `@FilterRating`: Lấy từ query `rating` (Parse: nếu không có thì truyền NULL).
  - `@SortByDate`: Lấy từ query `sort` (Default 'DESC').
- **Response:**
```json
{
  "success": true,
  "data": [
    {
      "reviewID": "REV-001",
      "authorName": "Nguyen Van A",
      "rating": 5,
      "content": "Sản phẩm tốt...",
      "reviewDate": "2023-11-25...",
      "variationName": "Màu Đen",
      "totalReactions": 15
    }
  ]
}
B. Viết review mới (Protected)
Endpoint: POST /api/reviews

Auth: Bearer Token (Lấy userID từ token).

Body: { "orderId": "...", "orderItemId": "...", "rating": 5, "content": "..." }

Database Logic:

Insert vào bảng Review. Lưu ý: Field content từ FE phải map vào cột Description trong DB.

Insert vào bảng Write_review.

Trigger trgCheckReviewEligibility sẽ tự động chặn nếu đơn chưa xong hoặc seller tự review.

C. Thả Reaction (Protected)
Endpoint: POST /api/reviews/:reviewId/reactions

Auth: Bearer Token.

Body: { "type": "Love" }

Database Call: usp_Reactions_Upsert

Params:

@ReviewID: Lấy từ URL param.

@Type: Lấy từ Body.

@Author: Lấy UserID từ Token.

D. Lấy hàng chờ đánh giá (Protected)
Endpoint: GET /api/reviews/me/purchased

Database Call: usp_GetPurchasedItemsForReview

Params: @UserID lấy từ Token.

2. Database Specification (Review Module Only)
Phần này dành cho Backend Dev nắm cấu trúc DB để debug hoặc viết Raw Query nếu cần thiết.

A. Tables Schema (Relevant Columns)
Review

ID (PK, VARCHAR): Mã review.

Rating (INT): Số sao 1-5.

Description (NVARCHAR MAX): Nội dung review (Lưu ý: Tên cột là Description, không phải Content).

Time (DATETIME): Thời gian tạo.

Write_review (Bảng nối quan trọng)

ReviewID (FK): Trỏ về bảng Review.

UserID (FK): Người viết.

OrderID, Order_itemID (FK): Trỏ về đơn hàng đã mua.

Reactions

ReviewID, Author (Composite PK).

Type (VARCHAR): Loại cảm xúc (Like, Love, Haha...).

Product_SKU (Đã được Denormalize)

AvgRating (DECIMAL): Điểm trung bình (Tính tự động).

ReviewCount (INT): Tổng số review (Tính tự động).

B. SQL Scripts (Stored Procedures & Triggers)
Backend KHÔNG viết logic tính toán trong code Node.js, mà chỉ gọi các thủ tục sau:

1. usp_GetProductReviews
CREATE OR ALTER PROCEDURE usp_GetProductReviews
    @Barcode VARCHAR(100),
    @FilterRating INT = NULL,
    @SortByDate VARCHAR(4) = 'DESC'
AS
BEGIN
    SELECT 
        r.ID AS ReviewID,
        u.Full_Name AS AuthorName,
        r.Rating,
        r.Description AS Content, -- Map cột Description ra key Content cho FE
        r.[Time] AS ReviewDate,
        v.NAME AS VariationName,
        (SELECT COUNT(*) FROM Reactions WHERE ReviewID = r.ID) AS TotalReactions
    FROM Product_SKU p
    JOIN Order_Item oi ON p.Bar_code = oi.BarCode
    JOIN Write_review wr ON oi.ID = wr.Order_itemID AND oi.orderID = wr.OrderID
    JOIN Review r ON wr.ReviewID = r.ID
    JOIN Buyer b ON wr.UserID = b.ID
    JOIN [User] u ON b.ID = u.ID
    LEFT JOIN VARIATIONS v ON oi.BarCode = v.Bar_code AND oi.Variation_Name = v.NAME
    WHERE p.Bar_code = @Barcode
      AND (@FilterRating IS NULL OR r.Rating = @FilterRating)
    ORDER BY 
        CASE WHEN @SortByDate = 'DESC' THEN r.[Time] END DESC,
        CASE WHEN @SortByDate = 'ASC' THEN r.[Time] END ASC;
END
2. usp_Reactions_Upsert
Logic: Nếu chưa có thì Insert, có rồi thì Update hoặc Xóa (Toggle). (Code chi tiết đã có trong Database, Backend chỉ cần gọi EXEC).

3. trgCheckReviewEligibility (Trigger)
Trigger này nằm trên bảng Write_review. Nó sẽ Throw Error nếu:

Order Status != 'Completed' / 'Delivered'.

SellerID trùng với UserID (Tự review hàng mình). => Backend cần try-catch để bắt lỗi này và trả về 400 Bad Request cho FE.

4. trg_Review_MaintainProductAggregates (Trigger)
Trigger nằm trên bảng Review. Tự động update AvgRating và ReviewCount bên bảng Product mỗi khi có review thêm/xóa/sửa. Backend không cần làm gì thêm.