import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const MAIL_COLLECTION = 'mail';

/**
 * Gửi email thông qua Firebase Trigger Email Extension
 */
export const sendMail = async (to, subject, html) => {
    if (!to) return;
    try {
        await addDoc(collection(db, MAIL_COLLECTION), {
            to: to,
            message: {
                subject: subject,
                html: html,
            },
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Lỗi khi tạo yêu cầu gửi mail:", error);
    }
};

export const EmailTemplates = {
    borrowCode: (name, recordId, bookCount) => ({
        subject: `[Thư viện] Xác nhận đăng ký mượn sách - ${recordId}`,
        html: `
            <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #2563eb;">Đăng ký mượn sách thành công</h2>
                <p>Chào <b>${name}</b>,</p>
                <p>Bạn đã đăng ký mượn sách thành công. Dưới đây là thông tin phiếu của bạn:</p>
                <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
                    <p style="margin: 5px 0;"><b>Mã mượn:</b> <span style="font-size: 1.2em; color: #d97706;">${recordId}</span></p>
                    <p style="margin: 5px 0;"><b>Số lượng:</b> ${bookCount} cuốn</p>
                    <p style="margin: 5px 0;"><b>Trạng thái:</b> Chờ duyệt</p>
                </div>
                <p style="color: #dc2626; font-weight: bold;">⚠️ Lưu ý: Vui lòng đến thư viện trong vòng 24 giờ để nhận sách. Sau thời gian này mã sẽ tự động hết hạn.</p>
                <p>Trân trọng,<br>Ban quản lý Thư viện</p>
            </div>
        `
    }),

    approved: (name, recordId, dueDate) => ({
        subject: `[Thư viện] Phiếu mượn ${recordId} đã được duyệt`,
        html: `
            <div style="font-family: sans-serif; line-height: 1.6;">
                <h2 style="color: #059669;">Phiếu mượn đã sẵn sàng!</h2>
                <p>Chào <b>${name}</b>,</p>
                <p>Yêu cầu mượn sách <b>${recordId}</b> của bạn đã được duyệt.</p>
                <ul>
                    <li><b>Ngày mượn:</b> ${new Date().toLocaleDateString('vi-VN')}</li>
                    <li><b>Hạn trả sách:</b> <span style="color: #dc2626; font-weight: bold;">${dueDate}</span></li>
                </ul>
                <p>Chúc bạn có những giờ phút đọc sách thú vị!</p>
            </div>
        `
    }),

    expired: (name, recordId) => ({
        subject: `[Thư viện] Mã mượn ${recordId} đã hết hạn`,
        html: `
            <div style="font-family: sans-serif; line-height: 1.6;">
                <h2 style="color: #6b7280;">Thông báo hết hạn mã mượn</h2>
                <p>Chào bạn,</p>
                <p>Phiếu mượn <b>${recordId}</b> đã bị hủy do quá thời gian giữ chỗ (24 giờ).</p>
                <p>Nếu vẫn có nhu cầu, vui lòng thực hiện đăng ký mượn lại trên hệ thống.</p>
            </div>
        `
    }),

    dueSoon: (name, recordId, dueDate) => ({
        subject: `[Thư viện] Nhắc nhở: Sách sắp đến hạn trả - ${recordId}`,
        html: `
            <div style="font-family: sans-serif; line-height: 1.6;">
                <h2 style="color: #d97706;">Sắp đến hạn trả sách</h2>
                <p>Chào <b>${name}</b>,</p>
                <p>Phiếu mượn <b>${recordId}</b> của bạn sẽ đến hạn vào ngày <b>${dueDate}</b>.</p>
                <p>Vui lòng sắp xếp thời gian đến thư viện trả sách đúng hạn để tránh phát sinh phí phạt.</p>
            </div>
        `
    }),

    overdue: (name, recordId, fine) => ({
        subject: `[Thư viện] CẢNH BÁO: Phiếu mượn quá hạn - ${recordId}`,
        html: `
            <div style="font-family: sans-serif; line-height: 1.6; border: 2px solid #dc2626; padding: 20px; border-radius: 10px;">
                <h2 style="color: #dc2626;">CẢNH BÁO QUÁ HẠN</h2>
                <p>Chào bạn,</p>
                <p>Phiếu mượn <b>${recordId}</b> của bạn đã <b>QUÁ HẠN</b> trả sách.</p>
                <p style="background: #fee2e2; padding: 10px; border-radius: 5px;"><b>Phí phạt hiện tại:</b> ${fine} VNĐ/ngày</p>
                <p>Vui lòng trả sách ngay lập tức!</p>
            </div>
        `
    })
};
