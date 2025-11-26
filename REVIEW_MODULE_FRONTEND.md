Chào "Tech Lead", tôi đã hiệu chỉnh lại cả 2 file để đảm bảo sự đồng nhất tuyệt đối giữa: **Giao diện React (Frontend)** \<-\> **API Node.js (Backend)** \<-\> **Database SQL Server**.

Các thay đổi chính tôi đã thực hiện:

1.  **Đồng bộ cột `Content`:** Đã thêm trường nội dung đánh giá vào tất cả các request/response (do chúng ta vừa sửa DB).
2.  **Chuẩn hóa Reaction:** Thay vì chỉ `Helpful`, giờ API hỗ trợ trọn bộ `Like, Love, Haha, Wow, Sad, Angry` khớp với UI Facebook-style.
3.  **Khớp Procedure:** Cập nhật đúng tên tham số (ví dụ `@FilterRating`) và tên cột trả về (ví dụ `TotalReactions`) theo đúng script SQL đã chạy.

Dưới đây là nội dung 2 file đã sửa. Bạn hãy copy đè lên file cũ nhé.

### File 1: `REVIEW_MODULE_README.md` (Dành cho Backend Dev)

File này mô tả Source-of-truth của hệ thống API.

````markdown
# Review Module — API & Integration Guide (Detailed)

Tài liệu này là source-of-truth cho Backend để hiện thực controller và gọi Stored Procedures chính xác.

## 1) Tóm tắt tính năng
- Lấy danh sách review (có lọc theo sao, sắp xếp) kèm thông tin biến thể (Màu/Size).
- Tạo review mới (Validate: phải mua hàng xong & không tự review hàng mình bán).
- Thả cảm xúc (Reaction): Hỗ trợ bộ 6 icon (Like, Love, Haha, Wow, Sad, Angry).
- Lấy danh sách hàng đã mua chờ đánh giá (Pending Reviews).

---

## 2) Endpoints Contract
Base path: `/api/reviews`

### 1. GET `/api/reviews/:barcode`
- **Purpose:** Lấy danh sách review của 1 sản phẩm.
- **Query params:**
  - `rating`: (Optional) Int (1-5). Nếu không truyền hoặc 'all' -> Lấy tất cả.
  - `sort`: (Optional) 'ASC' | 'DESC' (Default: DESC).
- **Database Call:** `usp_GetProductReviews`
- **Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "reviewID": "REV-001",
      "authorName": "Nguyen Van A",
      "rating": 5,
      "content": "Sản phẩm dùng rất tốt, đóng gói kỹ.",
      "reviewDate": "2023-11-25T10:00:00Z",
      "variationName": "Màu Đen",
      "totalReactions": 15
    }
  ]
}
````

### 2\. POST `/api/reviews`

  - **Purpose:** Người dùng viết review mới.
  - **Auth:** Required (Bearer Token).
  - **Body:**

<!-- end list -->

```json
{
  "orderId": "ORD-001",
  "orderItemId": "ITEM-001",
  "rating": 5,
  "content": "Giao hàng nhanh, shop uy tín."
}
```

  - **Database Call:** Insert into `Review` & `Write_review`.
  - **Error Handling:** Catch error từ trigger `trgCheckReviewEligibility` (nếu đơn chưa hoàn thành hoặc seller tự review).

### 3\. POST `/api/reviews/react`

  - **Purpose:** Thả tim/reaction (hoặc bỏ reaction nếu click lại).
  - **Auth:** Required.
  - **Body:**

<!-- end list -->

```json
{
  "reviewId": "REV-001",
  "type": "Love" 
}
```

*Valid types: 'Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry'.*

  - **Database Call:** `usp_Reactions_Upsert`

### 4\. GET `/api/reviews/me/pending`

  - **Purpose:** Lấy danh sách các món đã mua (Completed) nhưng CHƯA viết review.
  - **Auth:** Required.
  - **Database Call:** `usp_GetPurchasedItemsForReview`
  - **Response 200:**

<!-- end list -->

```json
{
  "success": true,
  "data": [
    {
      "orderID": "ORD-008",
      "orderItemID": "ITEM-008",
      "productName": "Chuột Gaming Logitech",
      "variationName": "Màu Đen",
      "price": 500000,
      "purchaseDate": "2025-11-20T..."
    }
  ]
}
```

-----

## 3\) Stored Procedures Signatures (SQL Server)

Backend phải gọi đúng tên tham số như sau:

1.  **`usp_GetProductReviews`**

      * `@Barcode` (VARCHAR)
      * `@FilterRating` (INT) -\> Truyền `NULL` nếu không lọc.
      * `@SortByDate` (VARCHAR) -\> 'ASC'/'DESC'.

2.  **`usp_Reactions_Upsert`**

      * `@ReviewID` (VARCHAR)
      * `@Type` (VARCHAR) -\> 'Like', 'Love', ...
      * `@Author` (VARCHAR) -\> UserID lấy từ Token.

3.  **`usp_GetPurchasedItemsForReview`**

      * `@UserID` (VARCHAR) -\> UserID lấy từ Token.

-----

## 4\) Auth & CORS Notes

  - Nếu dùng Token (JWT): Gửi header `Authorization: Bearer <token>`.
  - CORS: Backend phải allow origin của Frontend (VD: `http://localhost:5173`).

<!-- end list -->

````

---

### File 2: `API_Integration_Spec.md` (Dành cho Frontend/AI generate code)

File này hướng dẫn AI cách nối UI vào API.

```markdown
# API INTEGRATION SPECIFICATION: SOCIAL REVIEW MODULE
**Project:** BK-Bay E-commerce
**Context:** Mapping Frontend UI components to Backend APIs.

---

## 1. FEATURE: DISPLAY REVIEWS LIST
**UI Component:** `src/pages/Review/ProductReviews.jsx`

### Logic
* **Trigger:** Khi vào trang chi tiết sản phẩm hoặc bấm nút lọc sao (Filter Buttons).
* **API Call:** `GET /api/reviews/:barcode`
* **Query Params:**
    * `rating`: Lấy từ state của nút filter đang active (nếu chọn "Tất cả" -> không gửi param này).
    * `sort`: Mặc định 'DESC'.

### Data Mapping (Response -> UI Props)
* `data.reviewID` -> `key` & `id`
* `data.authorName` -> `user`
* `data.content` -> `content` (Hiển thị nội dung text)
* `data.rating` -> `rating` (Số sao để render component Star)
* `data.variationName` -> `variant` (VD: "Phân loại: Màu Đen")
* `data.reviewDate` -> `date`
* `data.totalReactions` -> `likes` (Số lượng reaction hiển thị cạnh nút Like)

---

## 2. FEATURE: REACTION (FACEBOOK STYLE)
**UI Component:** `ReactionButton` inside `ProductReviews.jsx`

### Logic
* **Trigger:** User bấm vào 1 trong 6 icon cảm xúc trên thanh Hover Dock.
* **Optimistic Update:** Frontend tự cập nhật UI (đổi icon, tăng số lượng) ngay lập tức trước khi gọi API để tạo cảm giác mượt.
* **API Call:** `POST /api/reviews/react`
* **Payload:**
    ```json
    {
      "reviewId": "REV-xxx",
      "type": "Haha" // Value lấy từ id của icon được bấm
    }
    ```

---

## 3. FEATURE: GET MY PURCHASES (PENDING REVIEW)
**UI Component:** `src/pages/Review/WriteReview.jsx` (Dropdown chọn sản phẩm)

### Logic
* **Trigger:** Khi trang `WriteReview` vừa load (useEffect).
* **API Call:** `GET /api/reviews/me/pending`
* **Role:** Chỉ gọi được khi user đã đăng nhập.

### Data Mapping
* `data.productName` + `data.variationName` -> Hiển thị tên sản phẩm trong Dropdown.
* `data.orderID` + `data.orderItemID` -> Lưu vào state `selectedItem` để dùng cho bước Submit.

---

## 4. FEATURE: SUBMIT REVIEW
**UI Component:** `src/pages/Review/WriteReview.jsx` (Nút "Gửi")

### Logic
* **Pre-condition:** User bắt buộc phải chọn 1 sản phẩm từ danh sách Pending ở trên.
* **API Call:** `POST /api/reviews`
* **Payload:**
    ```json
    {
      "orderId": "Lấy từ state selectedItem.orderID",
      "orderItemId": "Lấy từ state selectedItem.orderItemID",
      "rating": "Lấy từ state rating (int 1-5)",
      "content": "Lấy từ state textarea input"
    }
    ```
* **Post-action:** Nếu thành công -> Alert "Cảm ơn" -> Điều hướng về trang danh sách review.
````