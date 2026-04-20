import { db } from './firebase-config.js';
import {
    collection,
    doc,
    writeBatch,
    serverTimestamp,
    Timestamp,
    getDocs,
    deleteDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { hashCCCD } from './identity.js';

const log = (msg) => {
    console.log(msg);
    const el = document.getElementById('seedLogs');
    if (el) {
        el.innerHTML += `<div>${new Date().toLocaleTimeString()} - ${msg}</div>`;
        el.scrollTop = el.scrollHeight;
    }
};

const dayOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Timestamp.fromDate(d);
};

// ─── USERS (15 độc giả) ───────────────────────────────────────────────────────
const DUMMY_USERS = [
    { uid: 'seed_u01', displayName: 'Nguyễn Minh Tuấn',   email: 'tuan.nm@reader.vn',   phone: '0901111001', rawCccd: '001200111001', reputationScore: 100, status: 'active',  readerCode: 'RD-001' },
    { uid: 'seed_u02', displayName: 'Trần Thị Lan',        email: 'lan.tt@reader.vn',    phone: '0901111002', rawCccd: '001200111002', reputationScore: 98,  status: 'active',  readerCode: 'RD-002' },
    { uid: 'seed_u03', displayName: 'Lê Văn Hùng',         email: 'hung.lv@reader.vn',   phone: '0901111003', rawCccd: '001200111003', reputationScore: 92,  status: 'active',  readerCode: 'RD-003' },
    { uid: 'seed_u04', displayName: 'Phạm Thị Mai',        email: 'mai.pt@reader.vn',    phone: '0901111004', rawCccd: '001200111004', reputationScore: 88,  status: 'active',  readerCode: 'RD-004' },
    { uid: 'seed_u05', displayName: 'Hoàng Quốc Bảo',      email: 'bao.hq@reader.vn',    phone: '0901111005', rawCccd: '001200111005', reputationScore: 85,  status: 'active',  readerCode: 'RD-005' },
    { uid: 'seed_u06', displayName: 'Vũ Thị Thu Hà',       email: 'ha.vtt@reader.vn',    phone: '0901111006', rawCccd: '001200111006', reputationScore: 80,  status: 'active',  readerCode: 'RD-006' },
    { uid: 'seed_u07', displayName: 'Đặng Văn Long',       email: 'long.dv@reader.vn',   phone: '0901111007', rawCccd: '001200111007', reputationScore: 75,  status: 'active',  readerCode: 'RD-007' },
    { uid: 'seed_u08', displayName: 'Bùi Thị Ngọc',        email: 'ngoc.bt@reader.vn',   phone: '0901111008', rawCccd: '001200111008', reputationScore: 68,  status: 'active',  readerCode: 'RD-008' },
    { uid: 'seed_u09', displayName: 'Ngô Xuân Thành',      email: 'thanh.nx@reader.vn',  phone: '0901111009', rawCccd: '001200111009', reputationScore: 62,  status: 'active',  readerCode: 'RD-009' },
    { uid: 'seed_u10', displayName: 'Đinh Thị Hương',      email: 'huong.dt@reader.vn',  phone: '0901111010', rawCccd: '001200111010', reputationScore: 55,  status: 'active',  readerCode: 'RD-010' },
    { uid: 'seed_u11', displayName: 'Phan Văn Đức',        email: 'duc.pv@reader.vn',    phone: '0901111011', rawCccd: '001200111011', reputationScore: 48,  status: 'active',  readerCode: 'RD-011' },
    { uid: 'seed_u12', displayName: 'Lý Thị Bích Vân',     email: 'van.ltb@reader.vn',   phone: '0901111012', rawCccd: '001200111012', reputationScore: 38,  status: 'active',  readerCode: 'RD-012' },
    { uid: 'seed_u13', displayName: 'Trương Công Danh',    email: 'danh.tc@reader.vn',   phone: '0901111013', rawCccd: '001200111013', reputationScore: 28,  status: 'locked',  readerCode: 'RD-013' },
    { uid: 'seed_u14', displayName: 'Mai Thị Kiều Oanh',   email: 'oanh.mtk@reader.vn',  phone: '0901111014', rawCccd: '001200111014', reputationScore: 15,  status: 'locked',  readerCode: 'RD-014' },
    { uid: 'seed_u15', displayName: 'Cao Minh Nhật',       email: 'nhat.cm@reader.vn',   phone: '0901111015', rawCccd: '001200111015', reputationScore: 5,   status: 'banned',  readerCode: 'RD-015' },
];

// ─── CATEGORIES (8 thể loại) ──────────────────────────────────────────────────
const DUMMY_CATEGORIES = [
    { id: 'seed_cat_cntt', name: 'Công nghệ Thông tin' },
    { id: 'seed_cat_kt',   name: 'Kinh Tế & Quản Trị' },
    { id: 'seed_cat_vh',   name: 'Văn Học' },
    { id: 'seed_cat_kh',   name: 'Khoa Học & Tự Nhiên' },
    { id: 'seed_cat_ls',   name: 'Lịch Sử & Địa Lý' },
    { id: 'seed_cat_tl',   name: 'Tâm Lý & Kỹ Năng Sống' },
    { id: 'seed_cat_nn',   name: 'Ngoại Ngữ' },
    { id: 'seed_cat_tm',   name: 'Toán Học & Logic' },
];

// ─── BOOKS (48 cuốn) ──────────────────────────────────────────────────────────
const DUMMY_BOOKS = [
    // CNTT (6 cuốn)
    { id: 'seed_bk01', title: 'Lập trình JavaScript Nâng cao', author: 'Nguyễn Văn Coder', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 15, availableQuantity: 11, price: 180000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&q=80' },
    { id: 'seed_bk02', title: 'Clean Code - Mã sạch từ A đến Z', author: 'Robert C. Martin (dịch)', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 10, availableQuantity: 7, price: 220000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=400&q=80' },
    { id: 'seed_bk03', title: 'Thuật toán & Cấu trúc Dữ liệu', author: 'Lê Thị Algorithm', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 12, availableQuantity: 9, price: 195000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=400&q=80' },
    { id: 'seed_bk04', title: 'Thiết kế Hệ thống Phân tán', author: 'Trần Văn Systems', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 8, availableQuantity: 5, price: 250000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&q=80' },
    { id: 'seed_bk05', title: 'Python cho Khoa học Dữ liệu', author: 'Ngô Thị Data', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 20, availableQuantity: 14, price: 165000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&q=80' },
    { id: 'seed_bk06', title: 'Bảo mật Ứng dụng Web', author: 'Phạm An Toàn', categoryId: 'seed_cat_cntt', categoryName: 'Công nghệ Thông tin', totalQuantity: 7, availableQuantity: 0, price: 210000, status: 'out_of_stock', coverUrl: 'https://images.unsplash.com/photo-1563206767-5b18f218e8de?w=400&q=80' },

    // Kinh Tế (6 cuốn)
    { id: 'seed_bk07', title: 'Đầu tư Chứng khoán Thông minh', author: 'Vũ Phú Quý', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 10, availableQuantity: 6, price: 200000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=400&q=80' },
    { id: 'seed_bk08', title: 'Nghệ thuật Quản trị Doanh nghiệp', author: 'Hoàng CEO Bình', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 12, availableQuantity: 8, price: 240000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80' },
    { id: 'seed_bk09', title: 'Kinh tế Vĩ mô Việt Nam', author: 'TS. Lê Kinh Tế', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 8, availableQuantity: 4, price: 185000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&q=80' },
    { id: 'seed_bk10', title: 'Marketing Kỹ thuật số 4.0', author: 'Trịnh Digital', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 15, availableQuantity: 11, price: 175000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80' },
    { id: 'seed_bk11', title: 'Kế toán Tài chính Doanh nghiệp', author: 'Nguyễn Kế Toán', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 9, availableQuantity: 9, price: 190000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&q=80' },
    { id: 'seed_bk12', title: 'Startup Khởi nghiệp từ Ý tưởng', author: 'Bùi Startup', categoryId: 'seed_cat_kt', categoryName: 'Kinh Tế & Quản Trị', totalQuantity: 11, availableQuantity: 7, price: 160000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1559526324-593bc073d938?w=400&q=80' },

    // Văn Học (6 cuốn)
    { id: 'seed_bk13', title: 'Tắt Đèn', author: 'Ngô Tất Tố', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 20, availableQuantity: 16, price: 85000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&q=80' },
    { id: 'seed_bk14', title: 'Số Đỏ', author: 'Vũ Trọng Phụng', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 15, availableQuantity: 12, price: 90000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80' },
    { id: 'seed_bk15', title: 'Chí Phèo & Những Truyện Ngắn', author: 'Nam Cao', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 18, availableQuantity: 13, price: 80000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=400&q=80' },
    { id: 'seed_bk16', title: 'Nỗi Buồn Chiến Tranh', author: 'Bảo Ninh', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 10, availableQuantity: 7, price: 110000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1491841573634-28140fc7ced7?w=400&q=80' },
    { id: 'seed_bk17', title: 'Mắt Biếc', author: 'Nguyễn Nhật Ánh', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 25, availableQuantity: 18, price: 95000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=400&q=80' },
    { id: 'seed_bk18', title: 'Tuyển tập Thơ Xuân Diệu', author: 'Xuân Diệu', categoryId: 'seed_cat_vh', categoryName: 'Văn Học', totalQuantity: 8, availableQuantity: 0, price: 75000, status: 'out_of_stock', coverUrl: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400&q=80' },

    // Khoa Học (6 cuốn)
    { id: 'seed_bk19', title: 'Vật Lý Đại cương Tập 1', author: 'GS. Nguyễn Vật Lý', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 20, availableQuantity: 15, price: 145000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1532094349884-543559cc5d71?w=400&q=80' },
    { id: 'seed_bk20', title: 'Hóa học Hữu cơ Căn bản', author: 'TS. Trần Hóa', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 15, availableQuantity: 10, price: 155000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=400&q=80' },
    { id: 'seed_bk21', title: 'Sinh Học Phân tử', author: 'PGS. Lê Sinh Học', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 12, availableQuantity: 8, price: 170000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1530026186672-2cd00ffc50fe?w=400&q=80' },
    { id: 'seed_bk22', title: 'Vũ trụ trong Hạt Nhân', author: 'Brian Greene (dịch)', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 10, availableQuantity: 6, price: 195000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80' },
    { id: 'seed_bk23', title: 'Địa Lý Kinh tế Thế giới', author: 'Đinh Địa Lý', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 8, availableQuantity: 5, price: 130000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&q=80' },
    { id: 'seed_bk24', title: 'Thiên Văn học Nhập Môn', author: 'Carl Sagan (dịch)', categoryId: 'seed_cat_kh', categoryName: 'Khoa Học & Tự Nhiên', totalQuantity: 7, availableQuantity: 4, price: 180000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80' },

    // Lịch Sử (6 cuốn)
    { id: 'seed_bk25', title: 'Lịch sử Việt Nam Thời kỳ Đổi mới', author: 'PGS. Lịch Sử Viện', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 10, availableQuantity: 7, price: 140000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=400&q=80' },
    { id: 'seed_bk26', title: 'Đế chế La Mã - Sụp đổ và Huy hoàng', author: 'Edward Gibbon (dịch)', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 8, availableQuantity: 5, price: 220000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=400&q=80' },
    { id: 'seed_bk27', title: 'Chiến tranh Thế giới II - Tóm tắt', author: 'Anthony Beevor (dịch)', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 12, availableQuantity: 9, price: 195000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=400&q=80' },
    { id: 'seed_bk28', title: 'Hà Nội - Ký sự Một Thế Kỷ', author: 'Nguyễn Hà Thành', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 6, availableQuantity: 3, price: 160000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1553899017-4f47dfdf41e9?w=400&q=80' },
    { id: 'seed_bk29', title: 'Triều Nguyễn và Miền Nam Việt Nam', author: 'Li Tana (dịch)', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 5, availableQuantity: 2, price: 170000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80' },
    { id: 'seed_bk30', title: 'Địa Lý Du lịch Đông Nam Á', author: 'Trần Du Lịch', categoryId: 'seed_cat_ls', categoryName: 'Lịch Sử & Địa Lý', totalQuantity: 9, availableQuantity: 9, price: 125000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?w=400&q=80' },

    // Tâm Lý (6 cuốn)
    { id: 'seed_bk31', title: 'Đắc Nhân Tâm', author: 'Dale Carnegie (dịch)', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 30, availableQuantity: 20, price: 120000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?w=400&q=80' },
    { id: 'seed_bk32', title: 'Sức Mạnh Của Thói Quen', author: 'Charles Duhigg (dịch)', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 25, availableQuantity: 17, price: 130000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=400&q=80' },
    { id: 'seed_bk33', title: 'Tâm Lý Học Tội Phạm', author: 'Robert Hare (dịch)', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 10, availableQuantity: 6, price: 155000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1516062423079-7ca13cdc7f5a?w=400&q=80' },
    { id: 'seed_bk34', title: 'Nghệ thuật Giao tiếp Không Lời', author: 'Allan Pease (dịch)', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 15, availableQuantity: 10, price: 110000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80' },
    { id: 'seed_bk35', title: 'Tư Duy Nhanh và Chậm', author: 'Daniel Kahneman (dịch)', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 12, availableQuantity: 8, price: 145000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=400&q=80' },
    { id: 'seed_bk36', title: 'Kỹ năng Lãnh đạo & Truyền cảm hứng', author: 'Lê Kỹ Năng', categoryId: 'seed_cat_tl', categoryName: 'Tâm Lý & Kỹ Năng Sống', totalQuantity: 14, availableQuantity: 0, price: 135000, status: 'out_of_stock', coverUrl: 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=400&q=80' },

    // Ngoại Ngữ (6 cuốn)
    { id: 'seed_bk37', title: 'Tiếng Anh Giao tiếp Hàng ngày', author: 'Oxford Press (dịch)', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 30, availableQuantity: 22, price: 125000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&q=80' },
    { id: 'seed_bk38', title: 'Luyện thi IELTS 8.0+', author: 'Nguyễn IELTS', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 20, availableQuantity: 13, price: 195000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=400&q=80' },
    { id: 'seed_bk39', title: 'Tiếng Nhật Sơ Cấp N5-N4', author: 'Trần Nihongo', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 15, availableQuantity: 10, price: 150000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&q=80' },
    { id: 'seed_bk40', title: 'Tiếng Trung Thực dụng', author: 'Lê Hán Ngữ', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 12, availableQuantity: 8, price: 140000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1546521343-4eb2c01aa44b?w=400&q=80' },
    { id: 'seed_bk41', title: 'Tiếng Hàn Căn bản Tập 1', author: 'Vũ Hàn Quốc', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 10, availableQuantity: 6, price: 145000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1580477667995-2b94f01c9516?w=400&q=80' },
    { id: 'seed_bk42', title: 'Ngữ pháp Tiếng Pháp Nâng cao', author: 'Đinh Français', categoryId: 'seed_cat_nn', categoryName: 'Ngoại Ngữ', totalQuantity: 7, availableQuantity: 4, price: 165000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400&q=80' },

    // Toán Học (6 cuốn)
    { id: 'seed_bk43', title: 'Giải Tích Toán Học Tập 1', author: 'GS. Hoàng Toán', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 20, availableQuantity: 14, price: 130000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=400&q=80' },
    { id: 'seed_bk44', title: 'Đại số Tuyến tính và Ứng dụng', author: 'TS. Phạm Đại Số', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 15, availableQuantity: 10, price: 140000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&q=80' },
    { id: 'seed_bk45', title: 'Xác suất Thống kê Ứng dụng', author: 'Bùi Thống Kê', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 12, availableQuantity: 8, price: 135000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&q=80' },
    { id: 'seed_bk46', title: 'Logic Toán và Lập luận hình thức', author: 'Ngô Logic', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 8, availableQuantity: 5, price: 155000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=400&q=80' },
    { id: 'seed_bk47', title: 'Tối ưu hóa Toán học', author: 'GS. Lê Tối Ưu', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 6, availableQuantity: 3, price: 170000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1581090464777-f3220bbe1b8b?w=400&q=80' },
    { id: 'seed_bk48', title: 'Hình học Không gian & Đồ thị', author: 'Đinh Hình Học', categoryId: 'seed_cat_tm', categoryName: 'Toán Học & Logic', totalQuantity: 10, availableQuantity: 7, price: 125000, status: 'available', coverUrl: 'https://images.unsplash.com/photo-1567653418887-58b5c4d89485?w=400&q=80' },
];

// Helper: tạo fineId ngắn gọn
const makeFineId = (n) => `FN-${String(n).padStart(6, '0')}`;
const makeRecordId = (n) => `LIB-SEED${String(n).padStart(2, '0')}`;

// ─── BORROW RECORDS (50 phiếu) ────────────────────────────────────────────────
// userDetails phải có { fullName, phone, cccd } để khớp với borrow.js
const ud = (uid) => {
    const u = DUMMY_USERS.find(x => x.uid === uid);
    return { fullName: u.displayName, phone: u.phone, cccd: u.rawCccd };
};

const DUMMY_BORROWS = [
    // ── PENDING (8 phiếu chờ duyệt) ──
    { n: 1,  userId: 'seed_u01', books: [{ bookId: 'seed_bk01', title: 'Lập trình JavaScript Nâng cao', quantity: 1 }], status: 'pending', requestDate: dayOffset(-1) },
    { n: 2,  userId: 'seed_u02', books: [{ bookId: 'seed_bk07', title: 'Đầu tư Chứng khoán Thông minh', quantity: 1 }, { bookId: 'seed_bk08', title: 'Nghệ thuật Quản trị Doanh nghiệp', quantity: 1 }], status: 'pending', requestDate: dayOffset(-1) },
    { n: 3,  userId: 'seed_u03', books: [{ bookId: 'seed_bk31', title: 'Đắc Nhân Tâm', quantity: 2 }], status: 'pending', requestDate: dayOffset(-2) },
    { n: 4,  userId: 'seed_u04', books: [{ bookId: 'seed_bk37', title: 'Tiếng Anh Giao tiếp Hàng ngày', quantity: 1 }], status: 'pending', requestDate: dayOffset(-2) },
    { n: 5,  userId: 'seed_u05', books: [{ bookId: 'seed_bk13', title: 'Tắt Đèn', quantity: 1 }, { bookId: 'seed_bk17', title: 'Mắt Biếc', quantity: 1 }], status: 'pending', requestDate: dayOffset(-3) },
    { n: 6,  userId: 'seed_u06', books: [{ bookId: 'seed_bk43', title: 'Giải Tích Toán Học Tập 1', quantity: 1 }], status: 'pending', requestDate: dayOffset(-3) },
    { n: 7,  userId: 'seed_u07', books: [{ bookId: 'seed_bk19', title: 'Vật Lý Đại cương Tập 1', quantity: 1 }], status: 'pending', requestDate: dayOffset(-4) },
    { n: 8,  userId: 'seed_u08', books: [{ bookId: 'seed_bk32', title: 'Sức Mạnh Của Thói Quen', quantity: 1 }], status: 'pending', requestDate: dayOffset(-4) },

    // ── BORROWING đúng hạn (10 phiếu đang mượn, còn hạn) ──
    { n: 9,  userId: 'seed_u01', books: [{ bookId: 'seed_bk02', title: 'Clean Code - Mã sạch từ A đến Z', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-10), borrowDate: dayOffset(-9), dueDate: dayOffset(5) },
    { n: 10, userId: 'seed_u02', books: [{ bookId: 'seed_bk09', title: 'Kinh tế Vĩ mô Việt Nam', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-8), borrowDate: dayOffset(-7), dueDate: dayOffset(7) },
    { n: 11, userId: 'seed_u03', books: [{ bookId: 'seed_bk14', title: 'Số Đỏ', quantity: 1 }, { bookId: 'seed_bk15', title: 'Chí Phèo & Những Truyện Ngắn', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-5), borrowDate: dayOffset(-4), dueDate: dayOffset(10) },
    { n: 12, userId: 'seed_u04', books: [{ bookId: 'seed_bk20', title: 'Hóa học Hữu cơ Căn bản', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-12), borrowDate: dayOffset(-11), dueDate: dayOffset(3) },
    { n: 13, userId: 'seed_u05', books: [{ bookId: 'seed_bk33', title: 'Tâm Lý Học Tội Phạm', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-6), borrowDate: dayOffset(-5), dueDate: dayOffset(9) },
    { n: 14, userId: 'seed_u06', books: [{ bookId: 'seed_bk38', title: 'Luyện thi IELTS 8.0+', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-3), borrowDate: dayOffset(-2), dueDate: dayOffset(12) },
    { n: 15, userId: 'seed_u09', books: [{ bookId: 'seed_bk25', title: 'Lịch sử Việt Nam Thời kỳ Đổi mới', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-7), borrowDate: dayOffset(-6), dueDate: dayOffset(8) },
    { n: 16, userId: 'seed_u10', books: [{ bookId: 'seed_bk44', title: 'Đại số Tuyến tính và Ứng dụng', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-9), borrowDate: dayOffset(-8), dueDate: dayOffset(6) },
    { n: 17, userId: 'seed_u11', books: [{ bookId: 'seed_bk35', title: 'Tư Duy Nhanh và Chậm', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-4), borrowDate: dayOffset(-3), dueDate: dayOffset(11) },
    { n: 18, userId: 'seed_u12', books: [{ bookId: 'seed_bk39', title: 'Tiếng Nhật Sơ Cấp N5-N4', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-11), borrowDate: dayOffset(-10), dueDate: dayOffset(4) },

    // ── BORROWING quá hạn (6 phiếu đang mượn, đã quá hạn) ──
    { n: 19, userId: 'seed_u08', books: [{ bookId: 'seed_bk04', title: 'Thiết kế Hệ thống Phân tán', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-25), borrowDate: dayOffset(-24), dueDate: dayOffset(-10) },
    { n: 20, userId: 'seed_u09', books: [{ bookId: 'seed_bk10', title: 'Marketing Kỹ thuật số 4.0', quantity: 2 }], status: 'borrowing', requestDate: dayOffset(-30), borrowDate: dayOffset(-29), dueDate: dayOffset(-15) },
    { n: 21, userId: 'seed_u10', books: [{ bookId: 'seed_bk16', title: 'Nỗi Buồn Chiến Tranh', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-20), borrowDate: dayOffset(-19), dueDate: dayOffset(-5) },
    { n: 22, userId: 'seed_u11', books: [{ bookId: 'seed_bk26', title: 'Đế chế La Mã - Sụp đổ và Huy hoàng', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-40), borrowDate: dayOffset(-39), dueDate: dayOffset(-25) },
    { n: 23, userId: 'seed_u12', books: [{ bookId: 'seed_bk05', title: 'Python cho Khoa học Dữ liệu', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-18), borrowDate: dayOffset(-17), dueDate: dayOffset(-3) },
    { n: 24, userId: 'seed_u13', books: [{ bookId: 'seed_bk34', title: 'Nghệ thuật Giao tiếp Không Lời', quantity: 1 }], status: 'borrowing', requestDate: dayOffset(-35), borrowDate: dayOffset(-34), dueDate: dayOffset(-20) },

    // ── RETURNED đúng hạn (14 phiếu đã trả, đúng hạn) ──
    { n: 25, userId: 'seed_u01', books: [{ bookId: 'seed_bk31', title: 'Đắc Nhân Tâm', quantity: 1 }], status: 'returned', requestDate: dayOffset(-40), borrowDate: dayOffset(-39), dueDate: dayOffset(-25), returnDate: dayOffset(-27), adminNote: 'Sách trả đúng hạn, tình trạng tốt.', fineOverdue: 0, fineDamage: 0 },
    { n: 26, userId: 'seed_u02', books: [{ bookId: 'seed_bk13', title: 'Tắt Đèn', quantity: 1 }], status: 'returned', requestDate: dayOffset(-50), borrowDate: dayOffset(-49), dueDate: dayOffset(-35), returnDate: dayOffset(-37), adminNote: 'Trả sách đúng hạn.', fineOverdue: 0, fineDamage: 0 },
    { n: 27, userId: 'seed_u03', books: [{ bookId: 'seed_bk07', title: 'Đầu tư Chứng khoán Thông minh', quantity: 1 }], status: 'returned', requestDate: dayOffset(-45), borrowDate: dayOffset(-44), dueDate: dayOffset(-30), returnDate: dayOffset(-32), adminNote: 'Ổn.', fineOverdue: 0, fineDamage: 0 },
    { n: 28, userId: 'seed_u04', books: [{ bookId: 'seed_bk32', title: 'Sức Mạnh Của Thói Quen', quantity: 1 }], status: 'returned', requestDate: dayOffset(-35), borrowDate: dayOffset(-34), dueDate: dayOffset(-20), returnDate: dayOffset(-22), adminNote: 'Sách sạch, trả đúng hạn.', fineOverdue: 0, fineDamage: 0 },
    { n: 29, userId: 'seed_u05', books: [{ bookId: 'seed_bk19', title: 'Vật Lý Đại cương Tập 1', quantity: 1 }], status: 'returned', requestDate: dayOffset(-30), borrowDate: dayOffset(-29), dueDate: dayOffset(-15), returnDate: dayOffset(-17), adminNote: 'OK.', fineOverdue: 0, fineDamage: 0 },
    { n: 30, userId: 'seed_u06', books: [{ bookId: 'seed_bk17', title: 'Mắt Biếc', quantity: 2 }], status: 'returned', requestDate: dayOffset(-28), borrowDate: dayOffset(-27), dueDate: dayOffset(-13), returnDate: dayOffset(-15), adminNote: 'Trả sớm hơn hạn.', fineOverdue: 0, fineDamage: 0 },
    { n: 31, userId: 'seed_u07', books: [{ bookId: 'seed_bk37', title: 'Tiếng Anh Giao tiếp Hàng ngày', quantity: 1 }], status: 'returned', requestDate: dayOffset(-25), borrowDate: dayOffset(-24), dueDate: dayOffset(-10), returnDate: dayOffset(-12), adminNote: 'Tốt.', fineOverdue: 0, fineDamage: 0 },
    { n: 32, userId: 'seed_u01', books: [{ bookId: 'seed_bk03', title: 'Thuật toán & Cấu trúc Dữ liệu', quantity: 1 }], status: 'returned', requestDate: dayOffset(-60), borrowDate: dayOffset(-59), dueDate: dayOffset(-45), returnDate: dayOffset(-47), adminNote: 'OK', fineOverdue: 0, fineDamage: 0 },
    { n: 33, userId: 'seed_u02', books: [{ bookId: 'seed_bk22', title: 'Vũ trụ trong Hạt Nhân', quantity: 1 }], status: 'returned', requestDate: dayOffset(-70), borrowDate: dayOffset(-69), dueDate: dayOffset(-55), returnDate: dayOffset(-57), adminNote: 'Sách nguyên vẹn.', fineOverdue: 0, fineDamage: 0 },
    { n: 34, userId: 'seed_u03', books: [{ bookId: 'seed_bk43', title: 'Giải Tích Toán Học Tập 1', quantity: 1 }], status: 'returned', requestDate: dayOffset(-55), borrowDate: dayOffset(-54), dueDate: dayOffset(-40), returnDate: dayOffset(-42), adminNote: 'Ổn định.', fineOverdue: 0, fineDamage: 0 },
    { n: 35, userId: 'seed_u04', books: [{ bookId: 'seed_bk27', title: 'Chiến tranh Thế giới II - Tóm tắt', quantity: 1 }], status: 'returned', requestDate: dayOffset(-80), borrowDate: dayOffset(-79), dueDate: dayOffset(-65), returnDate: dayOffset(-67), adminNote: 'Trả đúng hạn.', fineOverdue: 0, fineDamage: 0 },
    { n: 36, userId: 'seed_u05', books: [{ bookId: 'seed_bk34', title: 'Nghệ thuật Giao tiếp Không Lời', quantity: 1 }], status: 'returned', requestDate: dayOffset(-90), borrowDate: dayOffset(-89), dueDate: dayOffset(-75), returnDate: dayOffset(-77), adminNote: 'OK.', fineOverdue: 0, fineDamage: 0 },
    { n: 37, userId: 'seed_u06', books: [{ bookId: 'seed_bk45', title: 'Xác suất Thống kê Ứng dụng', quantity: 1 }], status: 'returned', requestDate: dayOffset(-65), borrowDate: dayOffset(-64), dueDate: dayOffset(-50), returnDate: dayOffset(-52), adminNote: 'Tình trạng tốt.', fineOverdue: 0, fineDamage: 0 },
    { n: 38, userId: 'seed_u07', books: [{ bookId: 'seed_bk25', title: 'Lịch sử Việt Nam Thời kỳ Đổi mới', quantity: 1 }], status: 'returned', requestDate: dayOffset(-50), borrowDate: dayOffset(-49), dueDate: dayOffset(-35), returnDate: dayOffset(-37), adminNote: 'Sách sạch.', fineOverdue: 0, fineDamage: 0 },

    // ── RETURNED trễ hạn (8 phiếu đã trả, có phạt) ──
    { n: 39, userId: 'seed_u08', books: [{ bookId: 'seed_bk33', title: 'Tâm Lý Học Tội Phạm', quantity: 1 }], status: 'returned', requestDate: dayOffset(-45), borrowDate: dayOffset(-44), dueDate: dayOffset(-30), returnDate: dayOffset(-24), adminNote: 'Trả trễ 6 ngày.', fineOverdue: 6000, fineDamage: 0 },
    { n: 40, userId: 'seed_u09', books: [{ bookId: 'seed_bk38', title: 'Luyện thi IELTS 8.0+', quantity: 1 }], status: 'returned', requestDate: dayOffset(-55), borrowDate: dayOffset(-54), dueDate: dayOffset(-40), returnDate: dayOffset(-29), adminNote: 'Trả trễ 11 ngày.', fineOverdue: 22000, fineDamage: 0 },
    { n: 41, userId: 'seed_u10', books: [{ bookId: 'seed_bk08', title: 'Nghệ thuật Quản trị Doanh nghiệp', quantity: 1 }], status: 'returned', requestDate: dayOffset(-60), borrowDate: dayOffset(-59), dueDate: dayOffset(-45), returnDate: dayOffset(-30), adminNote: 'Trả trễ 15 ngày.', fineOverdue: 30000, fineDamage: 0 },
    { n: 42, userId: 'seed_u11', books: [{ bookId: 'seed_bk14', title: 'Số Đỏ', quantity: 1 }], status: 'returned', requestDate: dayOffset(-70), borrowDate: dayOffset(-69), dueDate: dayOffset(-55), returnDate: dayOffset(-48), adminNote: 'Trả trễ 7 ngày, sách hơi bẩn.', fineOverdue: 7000, fineDamage: 10000 },
    { n: 43, userId: 'seed_u12', books: [{ bookId: 'seed_bk44', title: 'Đại số Tuyến tính và Ứng dụng', quantity: 1 }], status: 'returned', requestDate: dayOffset(-80), borrowDate: dayOffset(-79), dueDate: dayOffset(-65), returnDate: dayOffset(-45), adminNote: 'Trả trễ 20 ngày.', fineOverdue: 40000, fineDamage: 0 },
    { n: 44, userId: 'seed_u13', books: [{ bookId: 'seed_bk32', title: 'Sức Mạnh Của Thói Quen', quantity: 2 }], status: 'returned', requestDate: dayOffset(-90), borrowDate: dayOffset(-89), dueDate: dayOffset(-75), returnDate: dayOffset(-50), adminNote: 'Trả trễ 25 ngày.', fineOverdue: 50000, fineDamage: 0 },
    { n: 45, userId: 'seed_u14', books: [{ bookId: 'seed_bk22', title: 'Vũ trụ trong Hạt Nhân', quantity: 1 }], status: 'returned', requestDate: dayOffset(-100), borrowDate: dayOffset(-99), dueDate: dayOffset(-85), returnDate: dayOffset(-55), adminNote: 'Trả trễ 30 ngày, sách bị rách bìa.', fineOverdue: 60000, fineDamage: 150000 },
    { n: 46, userId: 'seed_u15', books: [{ bookId: 'seed_bk35', title: 'Tư Duy Nhanh và Chậm', quantity: 1 }], status: 'returned', requestDate: dayOffset(-120), borrowDate: dayOffset(-119), dueDate: dayOffset(-105), returnDate: dayOffset(-75), adminNote: 'Trả trễ 30 ngày, không tìm thấy sách.', fineOverdue: 60000, fineDamage: 0 },

    // ── CANCELLED (4 phiếu bị huỷ) ──
    { n: 47, userId: 'seed_u07', books: [{ bookId: 'seed_bk23', title: 'Địa Lý Kinh tế Thế giới', quantity: 1 }], status: 'cancelled', requestDate: dayOffset(-15), adminNote: 'Độc giả tự huỷ.' },
    { n: 48, userId: 'seed_u08', books: [{ bookId: 'seed_bk29', title: 'Triều Nguyễn và Miền Nam Việt Nam', quantity: 1 }], status: 'cancelled', requestDate: dayOffset(-12), adminNote: 'Huỷ do sách hết.' },
    { n: 49, userId: 'seed_u09', books: [{ bookId: 'seed_bk46', title: 'Logic Toán và Lập luận hình thức', quantity: 1 }], status: 'cancelled', requestDate: dayOffset(-8), adminNote: 'Độc giả không đến nhận.' },
    { n: 50, userId: 'seed_u10', books: [{ bookId: 'seed_bk41', title: 'Tiếng Hàn Căn bản Tập 1', quantity: 1 }], status: 'cancelled', requestDate: dayOffset(-5), adminNote: 'Huỷ theo yêu cầu.' },
];

// ─── FINES (20 phiếu phạt) ───────────────────────────────────────────────────
// Tương ứng với 8 phiếu returned-trễ + 6 phiếu borrowing-quá-hạn + 6 phiếu đã xử lý
const DUMMY_FINES = [
    // Phạt cho phiếu returned trễ — unpaid hoặc paid
    { fn: 1,  recordN: 39, userId: 'seed_u08', userName: 'Bùi Thị Ngọc',        bookTitles: ['Tâm Lý Học Tội Phạm'],                     daysLate: 6,  overdueAmount: 6000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -22 },
    { fn: 2,  recordN: 40, userId: 'seed_u09', userName: 'Ngô Xuân Thành',      bookTitles: ['Luyện thi IELTS 8.0+'],                      daysLate: 11, overdueAmount: 22000, damageAmount: 0,      status: 'paid',   paidAtOffset: -27 },
    { fn: 3,  recordN: 41, userId: 'seed_u10', userName: 'Đinh Thị Hương',      bookTitles: ['Nghệ thuật Quản trị Doanh nghiệp'],          daysLate: 15, overdueAmount: 30000, damageAmount: 0,      status: 'paid',   paidAtOffset: -29 },
    { fn: 4,  recordN: 42, userId: 'seed_u11', userName: 'Phan Văn Đức',        bookTitles: ['Số Đỏ'],                                     daysLate: 7,  overdueAmount: 7000,  damageAmount: 10000,  status: 'paid',   paidAtOffset: -46 },
    { fn: 5,  recordN: 43, userId: 'seed_u12', userName: 'Lý Thị Bích Vân',     bookTitles: ['Đại số Tuyến tính và Ứng dụng'],             daysLate: 20, overdueAmount: 40000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 6,  recordN: 44, userId: 'seed_u13', userName: 'Trương Công Danh',    bookTitles: ['Sức Mạnh Của Thói Quen'],                    daysLate: 25, overdueAmount: 50000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 7,  recordN: 45, userId: 'seed_u14', userName: 'Mai Thị Kiều Oanh',   bookTitles: ['Vũ trụ trong Hạt Nhân'],                     daysLate: 30, overdueAmount: 60000, damageAmount: 150000, status: 'unpaid', paidAtOffset: null },
    { fn: 8,  recordN: 46, userId: 'seed_u15', userName: 'Cao Minh Nhật',       bookTitles: ['Tư Duy Nhanh và Chậm'],                      daysLate: 30, overdueAmount: 60000, damageAmount: 0,      status: 'waived', waivedReason: 'Sách thực ra bị thất lạc tại thư viện — nhân viên xác nhận.', waivedAtOffset: -73 },
    // Phạt cho phiếu đang borrowing quá hạn — unpaid
    { fn: 9,  recordN: 19, userId: 'seed_u08', userName: 'Bùi Thị Ngọc',        bookTitles: ['Thiết kế Hệ thống Phân tán'],                daysLate: 10, overdueAmount: 20000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 10, recordN: 20, userId: 'seed_u09', userName: 'Ngô Xuân Thành',      bookTitles: ['Marketing Kỹ thuật số 4.0'],                 daysLate: 15, overdueAmount: 30000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 11, recordN: 21, userId: 'seed_u10', userName: 'Đinh Thị Hương',      bookTitles: ['Nỗi Buồn Chiến Tranh'],                      daysLate: 5,  overdueAmount: 5000,  damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 12, recordN: 22, userId: 'seed_u11', userName: 'Phan Văn Đức',        bookTitles: ['Đế chế La Mã - Sụp đổ và Huy hoàng'],       daysLate: 25, overdueAmount: 50000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 13, recordN: 23, userId: 'seed_u12', userName: 'Lý Thị Bích Vân',     bookTitles: ['Python cho Khoa học Dữ liệu'],               daysLate: 3,  overdueAmount: 3000,  damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    { fn: 14, recordN: 24, userId: 'seed_u13', userName: 'Trương Công Danh',    bookTitles: ['Nghệ thuật Giao tiếp Không Lời'],            daysLate: 20, overdueAmount: 40000, damageAmount: 0,      status: 'unpaid', paidAtOffset: null },
    // Phiếu phạt cũ đã giải quyết
    { fn: 15, recordN: 25, userId: 'seed_u01', userName: 'Nguyễn Minh Tuấn',    bookTitles: ['Đắc Nhân Tâm'],                              daysLate: 2,  overdueAmount: 2000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -26 },
    { fn: 16, recordN: 27, userId: 'seed_u03', userName: 'Lê Văn Hùng',         bookTitles: ['Đầu tư Chứng khoán Thông minh'],             daysLate: 1,  overdueAmount: 1000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -31 },
    { fn: 17, recordN: 30, userId: 'seed_u06', userName: 'Vũ Thị Thu Hà',       bookTitles: ['Mắt Biếc'],                                  daysLate: 3,  overdueAmount: 3000,  damageAmount: 0,      status: 'waived', waivedReason: 'Lần đầu vi phạm, miễn phạt khuyến khích.', waivedAtOffset: -14 },
    { fn: 18, recordN: 32, userId: 'seed_u01', userName: 'Nguyễn Minh Tuấn',    bookTitles: ['Thuật toán & Cấu trúc Dữ liệu'],            daysLate: 2,  overdueAmount: 2000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -46 },
    { fn: 19, recordN: 36, userId: 'seed_u05', userName: 'Hoàng Quốc Bảo',      bookTitles: ['Nghệ thuật Giao tiếp Không Lời'],            daysLate: 5,  overdueAmount: 5000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -76 },
    { fn: 20, recordN: 38, userId: 'seed_u07', userName: 'Đặng Văn Long',       bookTitles: ['Lịch sử Việt Nam Thời kỳ Đổi mới'],         daysLate: 4,  overdueAmount: 4000,  damageAmount: 0,      status: 'paid',   paidAtOffset: -36 },
];

// ─── SEED RUNNER ─────────────────────────────────────────────────────────────

export const runSeeder = async () => {
    try {
        const currentUser = db._auth?.currentUser || {}; // Truy cập nhanh user hiện tại
        const cachedUser = JSON.parse(localStorage.getItem('lib_user') || '{}');
        log(`Đang chạy với UID: ${cachedUser.uid || 'N/A'}, Quyền: ${cachedUser.role || 'N/A'}`);

        log('Bắt đầu quy trình Seed dữ liệu mẫu (100 records)...');

        // 1. Users + Identity
        log('Đang tạo 15 độc giả mẫu...');
        let batch = writeBatch(db);
        for (const u of DUMMY_USERS) {
            const cccdHash = await hashCCCD(u.rawCccd);
            batch.set(doc(db, 'users', u.uid), {
                email: u.email,
                displayName: u.displayName,
                role: 'user',
                status: u.status,
                isVerified: true,
                phone: u.phone,
                cccdHash,
                reputationScore: u.reputationScore,
                trustScore: u.reputationScore,
                readerCode: u.readerCode,
                createdAt: serverTimestamp()
            });
            batch.set(doc(db, 'phones', u.phone), { uid: u.uid, createdAt: serverTimestamp() });
            batch.set(doc(db, 'cccds', cccdHash), { uid: u.uid, createdAt: serverTimestamp() });
        }
        await batch.commit();
        log('✅ Đã tạo 15 độc giả và identity records.');

        // 2. Categories
        log('Đang tạo 8 thể loại sách...');
        batch = writeBatch(db);
        for (const cat of DUMMY_CATEGORIES) {
            batch.set(doc(db, 'categories', cat.id), { name: cat.name, createdAt: serverTimestamp() });
        }
        await batch.commit();
        log('✅ Đã tạo 8 thể loại.');

        // 3. Books (48 cuốn — batch theo 25)
        log('Đang tạo 48 cuốn sách mẫu...');
        batch = writeBatch(db);
        for (let i = 0; i < DUMMY_BOOKS.length; i++) {
            if (i > 0 && i % 490 === 0) { await batch.commit(); batch = writeBatch(db); }
            const bk = DUMMY_BOOKS[i];
            batch.set(doc(db, 'books', bk.id), { ...bk, createdAt: serverTimestamp() });
        }
        await batch.commit();
        log('✅ Đã tạo 48 cuốn sách.');

        // 4. Borrow Records (50 phiếu — chia batch ~25/lần)
        log('Đang tạo 50 phiếu mượn...');
        batch = writeBatch(db);
        for (let i = 0; i < DUMMY_BORROWS.length; i++) {
            if (i === 25) { await batch.commit(); batch = writeBatch(db); }
            const r = DUMMY_BORROWS[i];
            const recordId = makeRecordId(r.n);
            const userInfo = ud(r.userId);
            const docData = {
                recordId,
                userId: r.userId,
                userDetails: userInfo,
                books: r.books,
                status: r.status,
                requestDate: r.requestDate || serverTimestamp(),
                borrowDate: r.borrowDate || null,
                dueDate: r.dueDate || null,
                returnDate: r.returnDate || null,
                fineOverdue: r.fineOverdue ?? 0,
                fineDamage: r.fineDamage ?? 0,
                adminNote: r.adminNote || '',
                createdAt: r.requestDate || serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            batch.set(doc(db, 'borrowRecords', recordId), docData);
        }
        await batch.commit();
        log('✅ Đã tạo 50 phiếu mượn.');

        // 5. Fines (20 phiếu phạt)
        log('Đang tạo 20 phiếu phạt...');
        batch = writeBatch(db);
        for (const f of DUMMY_FINES) {
            const fineId = makeFineId(f.fn);
            const recordId = makeRecordId(f.recordN);
            const amount = (f.overdueAmount || 0) + (f.damageAmount || 0);
            const fineType = f.damageAmount > 0 && f.overdueAmount > 0 ? 'both'
                : f.damageAmount > 0 ? 'damage' : 'overdue';

            batch.set(doc(db, 'fines', fineId), {
                fineId,
                recordId,
                userId: f.userId,
                userName: f.userName,
                bookTitles: f.bookTitles,
                amount,
                overdueAmount: f.overdueAmount || 0,
                damageAmount: f.damageAmount || 0,
                type: fineType,
                daysLate: f.daysLate,
                status: f.status,
                createdAt: serverTimestamp(),
                paidAt: f.paidAtOffset != null ? dayOffset(f.paidAtOffset) : null,
                waivedAt: f.waivedAtOffset != null ? dayOffset(f.waivedAtOffset) : null,
                waivedReason: f.waivedReason || '',
                updatedAt: serverTimestamp()
            });
        }
        await batch.commit();
        log('✅ Đã tạo 20 phiếu phạt.');

        log('🎉 HOÀN TẤT! Đã seed 15 users + 8 categories + 48 books + 50 borrows + 20 fines = 141 documents.');
    } catch (e) {
        log(`❌ Lỗi khi seed dữ liệu: ${e.message}`);
        console.error(e);
    }
};

export const clearSeederData = async () => {
    log('Đang xóa toàn bộ dữ liệu seed...');
    try {
        let batch = writeBatch(db);
        let count = 0;

        for (const u of DUMMY_USERS) {
            batch.delete(doc(db, 'users', u.uid));
            batch.delete(doc(db, 'phones', u.phone));
            count += 2;
        }

        for (const cat of DUMMY_CATEGORIES) {
            batch.delete(doc(db, 'categories', cat.id));
            count++;
        }

        for (const bk of DUMMY_BOOKS) {
            batch.delete(doc(db, 'books', bk.id));
            count++;
        }

        await batch.commit(); batch = writeBatch(db); count = 0;

        for (let n = 1; n <= 50; n++) {
            batch.delete(doc(db, 'borrowRecords', makeRecordId(n)));
            count++;
        }
        for (let n = 1; n <= 20; n++) {
            batch.delete(doc(db, 'fines', makeFineId(n)));
            count++;
        }
        await batch.commit();

        log('✅ Đã xóa toàn bộ dữ liệu seed.');
    } catch (e) {
        log(`❌ Lỗi khi xóa: ${e.message}`);
        console.error(e);
    }
};

window.runSeeder = runSeeder;
window.clearSeederData = clearSeederData;
