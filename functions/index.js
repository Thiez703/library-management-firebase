const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// M7: Đọc feeSchedule từ Firestore, fallback về hardcode nếu chưa cấu hình
const getFeeSchedule = async () => {
    try {
        const snap = await db.collection('system').doc('feeSchedule').get();
        if (snap.exists) return snap.data();
    } catch { /* fallback */ }
    return null;
};

const calculateFineAmount = (daysLate, feeSchedule) => {
    if (daysLate <= 0) return 0;
    const tiers = feeSchedule?.lateFees;
    if (Array.isArray(tiers) && tiers.length > 0) {
        for (const tier of tiers) {
            if (tier.maxDays === null || daysLate <= tier.maxDays) {
                return daysLate * (Number(tier.ratePerDay) || 0);
            }
        }
    }
    // Fallback hardcode nếu Firestore chưa cấu hình
    if (daysLate <= 7) return daysLate * 1000;
    if (daysLate <= 30) return daysLate * 2000;
    return daysLate * 5000;
};

exports.autoCleanup = functions.pubsub.schedule('0 8 * * *').timeZone('Asia/Ho_Chi_Minh').onRun(async (context) => {
    const nowMs = Date.now();
    const ticketsRef = db.collection('borrowRecords');
    const snapshot = await ticketsRef.where('status', 'in', ['pending', 'borrowing']).get();

    // M7: Load feeSchedule một lần cho toàn bộ job
    const feeSchedule = await getFeeSchedule();

    let cleanedCount = 0;

    for (const docSnap of snapshot.docs) {
        // BIZ-08: Wrap từng record trong try-catch để 1 lỗi không crash toàn bộ job
        try {
            const data = docSnap.data();
            const readerEmail = data.userDetails?.email || data.email;
            const readerName = data.userDetails?.fullName || 'Độc giả';

            // 1. Tự động hủy mã mượn quá hạn (24h)
            if (data.status === 'pending') {
                const reqMs = data.requestDate?.toMillis ? data.requestDate.toMillis() : new Date(data.requestDate).getTime();
                if (reqMs && (nowMs - reqMs > 24 * 60 * 60 * 1000)) {
                    // M8: Dùng một batch duy nhất để hoàn sách + hủy phiếu (nguyên tử)
                    const batch = db.batch();

                    if (Array.isArray(data.books)) {
                        // Đọc tất cả book documents trước khi batch
                        const bookRefs = data.books
                            .map(b => b.bookId || b.id)
                            .filter(Boolean)
                            .map(id => db.collection('books').doc(id));

                        const bookSnaps = await Promise.all(bookRefs.map(ref => ref.get()));

                        for (let i = 0; i < bookSnaps.length; i++) {
                            const bSnap = bookSnaps[i];
                            if (!bSnap.exists) continue;
                            const bookItem = data.books.find(b => (b.bookId || b.id) === bSnap.id);
                            const restoreQty = Number(bookItem?.quantity) || 1;
                            const next = (bSnap.data().availableQuantity || 0) + restoreQty;
                            batch.update(bookRefs[i], {
                                availableQuantity: next,
                                status: next > 0 ? 'available' : 'out_of_stock'
                            });
                        }
                    }

                    batch.update(docSnap.ref, {
                        status: 'cancelled',
                        adminNote: 'Hệ thống tự huỷ sau 24 giờ chưa nhận sách.',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    await batch.commit();

                    // Gửi email SAU khi batch commit thành công
                    if (readerEmail) {
                        await db.collection('mail').add({
                            to: readerEmail,
                            message: {
                                subject: 'LibSpace - Hủy mã mượn do quá hạn',
                                html: `<p>Xin chào ${readerName},</p>
                                       <p>Mã mượn <b>${data.recordId || docSnap.id}</b> của bạn đã quá hạn nhận sách (24h) và đã bị hệ thống tự động hủy.</p>
                                       <p>Vui lòng đăng ký mượn lại nếu bạn vẫn có nhu cầu.</p>`
                            }
                        });
                    }
                    cleanedCount++;
                }
            }

            // 2. Cảnh báo quá hạn & Nhắc nhở sắp đến hạn
            if (data.status === 'borrowing') {
                const dueMs = data.dueDate?.toMillis ? data.dueDate.toMillis() : new Date(data.dueDate).getTime();
                if (dueMs) {
                    const daysLate = Math.ceil((nowMs - dueMs) / (1000 * 60 * 60 * 24));

                    // Đã quá hạn (> 0 ngày)
                    if (daysLate > 0) {
                        const lastWarningMs = data.lastWarningDate?.toMillis ? data.lastWarningDate.toMillis() : 0;
                        if (nowMs - lastWarningMs > 24 * 60 * 60 * 1000) {
                            if (readerEmail) {
                                await db.collection('mail').add({
                                    to: readerEmail,
                                    message: {
                                        subject: 'LibSpace - CẢNH BÁO Sách đã quá hạn trả!',
                                        html: `<p>Xin chào ${readerName},</p>
                                               <p>Phiếu mượn <b>${data.recordId || docSnap.id}</b> của bạn đã <strong>quá hạn ${daysLate} ngày</strong>.</p>
                                               <p>Phí phạt dự kiến: ${calculateFineAmount(daysLate, feeSchedule).toLocaleString('vi-VN')} VNĐ.</p>
                                               <p>Vui lòng mang sách đến trả tại thư viện ngay để tránh phát sinh thêm phí phạt.</p>`
                                    }
                                });
                            }
                            await docSnap.ref.update({
                                lastWarningDate: admin.firestore.FieldValue.serverTimestamp(),
                                isOverdue: true
                            });
                        } else if (!data.isOverdue) {
                            await docSnap.ref.update({ isOverdue: true });
                        }
                    }
                    // LOW-09: Sắp đến hạn (còn <= 2 ngày, bao gồm đúng hôm nay daysLate === 0)
                    else if (daysLate >= -2 && daysLate <= 0) {
                        const lastReminderMs = data.lastReminderDate?.toMillis ? data.lastReminderDate.toMillis() : 0;
                        if (nowMs - lastReminderMs > 24 * 60 * 60 * 1000) {
                            const daysLeft = Math.abs(daysLate);
                            const dueMsg = daysLeft === 0 ? 'hôm nay' : `trong ${daysLeft} ngày nữa`;
                            if (readerEmail) {
                                await db.collection('mail').add({
                                    to: readerEmail,
                                    message: {
                                        subject: 'LibSpace - Nhắc nhở sắp đến hạn trả sách',
                                        html: `<p>Xin chào ${readerName},</p>
                                               <p>Phiếu mượn <b>${data.recordId || docSnap.id}</b> của bạn sẽ đến hạn trả <strong>${dueMsg}</strong>.</p>
                                               <p>Bạn có thể theo dõi tình trạng mượn hoặc yêu cầu gia hạn tại website.</p>`
                                    }
                                });
                            }
                            await docSnap.ref.update({
                                lastReminderDate: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }
                    }
                }
            }
        } catch (recordErr) {
            console.error(`[autoCleanup] Lỗi xử lý record ${docSnap.id}:`, recordErr);
        }
    }
    console.log(`[autoCleanup] Đã xử lý / gửi email ${cleanedCount} records.`);
    return null;
});
