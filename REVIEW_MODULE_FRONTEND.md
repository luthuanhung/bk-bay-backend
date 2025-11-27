# API INTEGRATION SPECIFICATION: SOCIAL REVIEW MODULE
**Project:** BK-Bay E-commerce
**Status:** APPROVED (Final Version)
**Context:** Mapping Frontend UI components to Backend APIs.

---

## 1. FEATURE: DISPLAY REVIEWS LIST
**UI Component:** `src/pages/Review/ProductReviews.jsx`

### Logic
* **Trigger:** Khi vào trang chi tiết sản phẩm hoặc bấm nút lọc sao (Filter Buttons).
* **API Call:** `GET /api/reviews/:barcode`
* **Query Params:**
    * `rating`: (Optional) Int (1-5). Lấy từ state của nút filter. Nếu chọn "Tất cả" -> không gửi param này.
    * `sort`: (Optional) 'ASC' | 'DESC'. Mặc định 'DESC'.

### Data Mapping (Response -> UI Props)
Response Format: `{ success: true, data: [ ... ] }`

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
* **Optimistic Update:** Frontend tự cập nhật UI (đổi icon, tăng số lượng) ngay lập tức trước khi gọi API.
* **API Call:** `POST /api/reviews/:reviewId/reactions`
* **Payload:**
    ```json
    {
      "type": "Haha" // Value lấy từ id của icon được bấm (Like, Love, Haha, Wow, Sad, Angry)
    }
    ```

---

## 3. FEATURE: GET MY PURCHASES (PENDING REVIEW)
**UI Component:** `src/pages/Review/WriteReview.jsx` (Dropdown chọn sản phẩm)

### Logic
* **Trigger:** Khi trang `WriteReview` vừa load (useEffect).
* **API Call:** `GET /api/reviews/me/purchased`
* **Role:** Chỉ gọi được khi user đã đăng nhập.

### Data Mapping
Response Format: `{ success: true, data: [ ... ] }`

* `data.productName` + `data.variationName` -> Hiển thị tên sản phẩm trong Dropdown.
* `data.orderID` + `data.orderItemID` -> Lưu vào state `selectedItem` để dùng cho bước Submit.
* `data.productImage` -> Hiển thị ảnh thumbnail nếu cần.

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
* **Post-action & Navigation Logic:**
  * **Vấn đề:** Trước đây, sau khi submit thành công, người dùng bị điều hướng tới URL lỗi (`/product//reviews`). Nguyên nhân là do component không lấy được `productId` từ sản phẩm đã chọn trong dropdown. Thêm vào đó, có yêu cầu bổ sung nút "Xem đánh giá" để đi tới trang review của sản phẩm mà không cần gửi.
  * **Giải pháp:**
    1.  Một hàm mới là `handleNavigateToReviews` đã được tạo trong `WriteReview.jsx`.
    2.  Hàm này sẽ tìm sản phẩm đang được chọn, kiểm tra một cách an toàn xem `productId` có tồn tại hay không.
    3.  Nếu có `productId`, nó sẽ điều hướng tới trang review chính xác (`/product/${productId}/reviews`). Nếu không, nó sẽ báo lỗi.
    4.  Hàm này được gọi ở 2 nơi:
        *   Sau khi `POST /api/reviews` trả về thành công.
        *   Khi người dùng nhấn nút "Xem đánh giá".
  * **Ghi chú về dữ liệu:** Có một giả thuyết rằng API `GET /api/reviews/me/purchased` thực chất đã trả về mã `barcode` của sản phẩm trong mỗi `OrderItem`. Tuy nhiên, file `reviewService.js` ở frontend có thể đã không map trường dữ liệu này vào thành thuộc tính `productId` trong object trả về, dẫn đến component không có được thông tin này. Đây là một điểm cần kiểm tra lại để đảm bảo sự đồng bộ giữa backend và frontend.