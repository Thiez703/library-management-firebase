/**
 * Dịch vụ gửi Email qua EmailJS (Miễn phí 100%, không cần Visa)
 */
export const EmailJSService = {
    // CÁC THÔNG SỐ NÀY BẠN CẦN THAY BẰNG THÔNG SỐ TRÊN EMAILJS CỦA BẠN
    CONFIG: {
        SERVICE_ID: "service_cg59zan",    // Service ID của bạn
        PUBLIC_KEY: "ygtbgbtzaQVG-1SfP",  // Public Key thực tế của bạn
        TEMPLATES: {
            BORROW_CODE: "template_x0m6t2c", // Template đăng ký thành công
            APPROVED: "template_afuom7j",    // Template duyệt phiếu
            WARNING: "" // Để trống nếu bạn không dùng mẫu thứ 3
        }
    },

    /**
     * Hàm gửi mail chung
     * @param {string} templateId - ID của template cần dùng
     * @param {object} templateParams - Các biến trong template (ví dụ: {user_name: 'A', record_id: 'LIB1'})
     */
    send: async (templateId, templateParams) => {
        try {
            if (typeof emailjs === 'undefined') {
                console.error("EmailJS chưa được nạp. Hãy kiểm tra script tag trong file HTML.");
                return;
            }
            const response = await emailjs.send(
                EmailJSService.CONFIG.SERVICE_ID,
                templateId,
                templateParams
            );
            console.log("Email gửi thành công!", response.status, response.text);
        } catch (error) {
            console.error("Lỗi khi gửi email:", error);
        }
    }
};
