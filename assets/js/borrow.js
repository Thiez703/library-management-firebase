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
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// =======================
// ⚙️ CONFIG
// =======================
const LIMIT_BOOKS = 3000;
const BORROW_DAYS = 14;
const FINE_RATE = 50000;

// =======================
// 📚 MƯỢN SÁCH
// =======================
export const borrowBook = async (userId, bookId) => {
    if (!userId) {
        showToast('Vui lòng đăng nhập!', 'error');
        return;
    }

    try {
        await runTransaction(db, async (transaction) => {
            const bookRef = doc(db, "books", bookId);
            const userRef = doc(db, "users", userId);

            // (1) Đọc dữ liệu
            const bookSnap = await transaction.get(bookRef);
            const userSnap = await transaction.get(userRef);

            if (!bookSnap.exists())
                throw new Error("Sách không tồn tại!");

            if (!userSnap.exists())
                throw new Error("Người dùng không tồn tại!");

            const book = bookSnap.data();
            const userData = userSnap.data();

            if (book.availableQuantity <= 0)
                throw new Error("Sách đã hết!");

            if ((userData.borrowingCount || 0) >= LIMIT_BOOKS)
                throw new Error(`Chỉ được mượn tối đa ${LIMIT_BOOKS} cuốn!`);

            // (2) Giảm số lượng sách
            const newQty = book.availableQuantity - 1;
            transaction.update(bookRef, {
                availableQuantity: newQty,
                status: newQty === 0 ? "out_of_stock" : "available"
            });

            // (3) Tăng số lượng user
            transaction.update(userRef, {
                borrowingCount: (userData.borrowingCount || 0) + 1
            });

            // (4) Tạo record
            const now = new Date();
            const yy = now.getFullYear().toString().slice(2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const datePart = `${yy}${mm}${dd}`;
            const randomPart = Math.random().toString(36).substring(2, 5).toUpperCase();
            const recordId = `REQ-${datePart}-${randomPart}`;

            const dueDate = new Date();
            dueDate.setDate(now.getDate() + BORROW_DAYS);

            const recordRef = doc(db, "borrowRecords", recordId);

            transaction.set(recordRef, {
                userId: userId,
                bookId: bookId,
                bookTitle: book.title || '',
                author: book.author || 'Unknown',
                coverUrl: book.coverUrl || '',
                borrowDate: serverTimestamp(),
                dueDate: Timestamp.fromDate(dueDate),
                status: "borrowing",
                fineAmount: 0
            });
        });

        showToast('🚀 Mượn sách thành công!');
    } catch (error) {
        showToast(error.message || error, 'error');
    }
};

// =======================
// 📦 TRẢ SÁCH
// =======================
export const returnBook = async (recordId) => {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrowRecords", recordId);
            const recordSnap = await transaction.get(recordRef);

            if (!recordSnap.exists())
                throw new Error("Bản ghi không tồn tại!");

            const record = recordSnap.data();

            if (record.status === "returned")
                throw new Error("Sách đã được trả!");

            const bookRef = doc(db, "books", record.bookId);
            const userRef = doc(db, "users", record.userId);

            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) throw new Error("Dữ liệu sách không tồn tại!");

            const userSnap = await transaction.get(userRef);
            if (!userSnap.exists()) throw new Error("Dữ liệu người dùng không tồn tại!");

            // 💰 Tính tiền phạt
            const now = new Date();
            const dueDate = record.dueDate.toDate();
            let fine = 0;

            if (now > dueDate) {
                const diffDays = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
                fine = diffDays * FINE_RATE;
            }

            // 📚 Update book
            transaction.update(bookRef, {
                availableQuantity: (bookSnap.data()?.availableQuantity || 0) + 1,
                status: "available"
            });

            // 👤 Update user
            transaction.update(userRef, {
                borrowingCount: Math.max(0, (userSnap.data()?.borrowingCount || 1) - 1)
            });

            // 🧾 Update record
            transaction.update(recordRef, {
                status: "returned",
                returnDate: serverTimestamp(),
                fineAmount: fine
            });
        });

        showToast('✅ Trả sách thành công!');
    } catch (error) {
        showToast(error.message || error, 'error');
    }
};

// =======================
// ⏰ CHECK QUÁ HẠN
// =======================
export const checkOverdue = async () => {
    try {
        const q = query(
            collection(db, "borrowRecords"),
            where("status", "==", "borrowing")
        );

        const snap = await getDocs(q);
        const now = new Date();

        const tasks = [];

        snap.forEach((docSnap) => {
            const data = docSnap.data();
            const dueDate = data.dueDate.toDate();

            if (now > dueDate) {
                const diffDays = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
                const fine = diffDays * FINE_RATE;

                const task = runTransaction(db, async (transaction) => {
                    const ref = doc(db, "borrowRecords", docSnap.id);
                    const latestRecord = await transaction.get(ref);
                    
                    if (latestRecord.exists() && latestRecord.data().status === "borrowing") {
                        transaction.update(ref, { fineAmount: fine });
                    }
                });

                tasks.push(task);
            }
        });

        await Promise.all(tasks);

        console.log("✔ Đã cập nhật phí quá hạn!");
    } catch (error) {
        console.error("Lỗi checkOverdue:", error);
    }
};

// =======================
// 🔁 HELPER: CONFIRM RETURN
// =======================
window.confirmReturnAction = (id) => {
    if (confirm("Bạn có chắc muốn trả sách?")) {
        returnBook(id);
    }
};
