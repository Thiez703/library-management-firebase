import { db, auth } from './firebase-config.js';
import { showToast } from './auth.js';
import {
    doc,
    runTransaction,
    serverTimestamp,
    collection,
    query,
    where,
    getDocs,
    Timestamp,
    updateDoc,
    arrayUnion,
    arrayRemove,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ==========================================
// CẤU HÌNH NGHIỆP VỤ
// ==========================================
const MAX_BORROW_LIMIT = 5;
const BORROW_DURATION_DAYS = 14;
const DAILY_FINE_AMOUNT = 50000;

// ==========================================
// 1. HÀM MƯỢN SÁCH (BORROW BOOK)
// ==========================================
export const borrowBook = async (userId, bookId) => {
    if (!userId) {
        showToast('Vui lòng đăng nhập để mượn sách nhé! ✨', 'error');
        return;
    }

    try {
        // Kiểm tra mượn trùng trước
        const checkQuery = query(
            collection(db, "borrowRecords"),
            where("userId", "==", userId),
            where("bookId", "==", bookId),
            where("status", "==", "borrowing")
        );
        const checkSnap = await getDocs(checkQuery);
        if (!checkSnap.empty) throw new Error("Bạn đang mượn cuốn sách này rồi!");

        // Tìm Document ID thực của sách dựa trên field 'id'
        const bookQuery = query(collection(db, "books"), where("id", "==", bookId));
        const bookQuerySnap = await getDocs(bookQuery);
        if (bookQuerySnap.empty) throw new Error("Sách không tồn tại trên hệ thống!");
        
        const bookDoc = bookQuerySnap.docs[0];
        const actualBookDocId = bookDoc.id;

        await runTransaction(db, async (transaction) => {
            const bookRef = doc(db, "books", actualBookDocId);
            const userRef = doc(db, "users", userId);

            const [bookSnap, userSnap] = await Promise.all([
                transaction.get(bookRef),
                transaction.get(userRef)
            ]);

            let userData = userSnap.exists() ? userSnap.data() : { borrowingCount: 0, displayName: auth.currentUser?.displayName || "Thành viên" };
            if (!userSnap.exists()) transaction.set(userRef, userData);

            const bookData = bookSnap.data();
            if (bookData.availableQuantity <= 0) throw new Error("Sách đã hết hàng!");
            if (userData.borrowingCount >= MAX_BORROW_LIMIT) throw new Error(`Đã mượn tối đa ${MAX_BORROW_LIMIT} cuốn!`);

            // Cập nhật số lượng
            transaction.update(bookRef, { availableQuantity: bookData.availableQuantity - 1 });
            transaction.update(userRef, { borrowingCount: userData.borrowingCount + 1 });

            // Tạo record mượn
            const recordRef = doc(collection(db, "borrowRecords"));
            transaction.set(recordRef, {
                bookId,
                bookTitle: bookData.title || 'Sách không tên',
                userId,
                userName: userData.displayName,
                borrowDate: serverTimestamp(),
                dueDate: Timestamp.fromDate(new Date(Date.now() + BORROW_DURATION_DAYS * 24 * 60 * 60 * 1000)),
                status: "borrowing",
                fineAmount: 0,
                returnDate: null
            });
        });

        showToast('Mượn sách thành công! 📚');
        setTimeout(() => location.reload(), 1500);
    } catch (error) { showToast(error.message, 'error'); }
};

// ==========================================
// 2. HÀM TRẢ SÁCH (RETURN BOOK)
// ==========================================
export const returnBook = async (docId) => {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrowRecords", docId);
            const recordSnap = await transaction.get(recordRef);
            if (!recordSnap.exists()) throw new Error("Bản ghi không tồn tại!");
            
            const record = recordSnap.data();
            if (record.status === 'returned') throw new Error("Sách đã trả rồi!");

            // Tìm sách để hoàn số lượng
            const bookQuery = query(collection(db, "books"), where("id", "==", record.bookId));
            const bookSnap = await getDocs(bookQuery);

            if (!bookSnap.empty) {
                transaction.update(bookSnap.docs[0].ref, { 
                    availableQuantity: (bookSnap.docs[0].data().availableQuantity || 0) + 1 
                });
            }

            const userRef = doc(db, "users", record.userId);
            transaction.update(userRef, { borrowingCount: Math.max(0, (record.borrowingCount || 1) - 1) });

            transaction.update(recordRef, {
                status: 'returned',
                returnDate: serverTimestamp()
            });
        });
        showToast('Trả sách thành công! 👋');
        setTimeout(() => location.reload(), 1500);
    } catch (error) { showToast(error.message, 'error'); }
};

// ==========================================
// 3. HÀM YÊU THÍCH (TOGGLE FAVORITE)
// ==========================================
export const toggleFavorite = async (userId, bookId, button) => {
    if (!userId) {
        showToast('Vui lòng đăng nhập để lưu yêu thích! ❤️', 'error');
        return;
    }
    const userRef = doc(db, "users", userId);
    const icon = button.querySelector('i');
    try {
        const userSnap = await getDoc(userRef);
        const isFav = userSnap.data()?.favorites?.includes(bookId);
        
        await updateDoc(userRef, {
            favorites: isFav ? arrayRemove(bookId) : arrayUnion(bookId)
        });

        icon.classList.toggle('ph-fill');
        icon.classList.toggle('ph-bold');
        button.classList.toggle('text-rose-500');
        showToast(isFav ? 'Đã bỏ yêu thích' : 'Đã thêm vào yêu thích ❤️');
    } catch (e) { showToast('Lỗi cập nhật yêu thích', 'error'); }
};

// ==========================================
// UI BINDING
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', async (e) => {
        // Nút Mượn
        const borrowBtn = e.target.closest('.btn-borrow');
        if (borrowBtn) {
            const bookId = borrowBtn.dataset.id;
            borrowBtn.disabled = true;
            await borrowBook(auth.currentUser?.uid, bookId);
            borrowBtn.disabled = false;
        }

        // Nút Yêu thích
        const favBtn = e.target.closest('.btn-favorite');
        if (favBtn) {
            await toggleFavorite(auth.currentUser?.uid, favBtn.dataset.id, favBtn);
        }
    });

    window.confirmReturnAction = (id) => confirm("Xác nhận trả sách?") && returnBook(id);
    
    // Check trạng thái Trái tim khi load trang
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const favs = userSnap.data()?.favorites || [];
            document.querySelectorAll('.btn-favorite').forEach(btn => {
                if (favs.includes(btn.dataset.id)) {
                    btn.querySelector('i').classList.replace('ph-bold', 'ph-fill');
                    btn.classList.add('text-rose-500');
                }
            });
        }
    });
});