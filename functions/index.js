const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const FINE_PER_DAY = 5000;

exports.autoCleanup = functions.pubsub.schedule('0 8 * * *').timeZone('Asia/Ho_Chi_Minh').onRun(async (context) => {
    const nowMs = Date.now();
    const ticketsRef = db.collection('borrowRecords');
    const snapshot = await ticketsRef.where('status', 'in', ['pending', 'borrowing']).get();

    let cleanedCount = 0;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const readerEmail = data.userDetails?.email || data.email;
        const readerName = data.userDetails?.fullName || 'Độc giả';

        // 1. Tự động hủy mã mượn quá hạn (24h)
        if (data.status === 'pending') {
            const reqMs = data.requestDate?.toMillis ? data.requestDate.toMillis() : new Date(data.requestDate).getTime();
            if (reqMs && (nowMs - reqMs > 24 * 60 * 60 * 1000)) {
                // Hủy phiếu
                await docSnap.ref.update({
                    status: 'cancelled',
                    adminNote: 'Hệ thống tự huỷ sau 24 giờ chưa nhận sách.',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Hoàn lại số lượng sách
                if (Array.isArray(data.books)) {
                    for (const b of data.books) {
                        if (!b.id) continue;
                        const bookRef = db.collection('books').doc(b.id);
                        await db.runTransaction(async (t) => {
                            const bSnap = await t.get(bookRef);
                            if (bSnap.exists) {
                                const current = bSnap.data().availableQuantity || 0;
                                t.update(bookRef, { availableQuantity: current + 1 });
                            }
                        });
                    }
                }

                // Ghi log email (kích hoạt Firebase Extension Trigger Email)
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
                
                // Đã quá hạn
                if (daysLate > 0) {
                    const lastWarningMs = data.lastWarningDate?.toMillis ? data.lastWarningDate.toMillis() : 0;
                    // Chỉ gửi 1 lần mỗi 24h
                    if (nowMs - lastWarningMs > 24 * 60 * 60 * 1000) {
                        if (readerEmail) {
                            await db.collection('mail').add({
                                to: readerEmail,
                                message: {
                                    subject: 'LibSpace - CẢNH BÁO Sách đã quá hạn trả!',
                                    html: `<p>Xin chào ${readerName},</p>
                                           <p>Phiếu mượn <b>${data.recordId || docSnap.id}</b> của bạn đã <strong>quá hạn ${daysLate} ngày</strong>.</p>
                                           <p>Phí phạt dự kiến: ${(daysLate * FINE_PER_DAY).toLocaleString('vi-VN')} VNĐ.</p>
                                           <p>Vui lòng mang sách đến trả tại thư viện ngay để tránh phát sinh thêm phí phạt.</p>`
                                }
                            });
                        }
                        await docSnap.ref.update({
                            lastWarningDate: admin.firestore.FieldValue.serverTimestamp(),
                            isOverdue: true
                        });
                    } else {
                        // Nếu đã gửi mail rồi nhưng chưa có cờ isOverdue (BIZ-08)
                        if (!data.isOverdue) {
                            await docSnap.ref.update({ isOverdue: true });
                        }
                    }
                } 
                // Sắp đến hạn (còn <= 2 ngày)
                else if (daysLate >= -2 && daysLate < 0) {
                    const lastReminderMs = data.lastReminderDate?.toMillis ? data.lastReminderDate.toMillis() : 0;
                    // Chỉ gửi 1 lần mỗi 24h
                    if (nowMs - lastReminderMs > 24 * 60 * 60 * 1000) {
                        if (readerEmail) {
                            await db.collection('mail').add({
                                to: readerEmail,
                                message: {
                                    subject: 'LibSpace - Nhắc nhở sắp đến hạn trả sách',
                                    html: `<p>Xin chào ${readerName},</p>
                                           <p>Phiếu mượn <b>${data.recordId || docSnap.id}</b> của bạn sẽ đến hạn trả trong <strong>${Math.abs(daysLate)} ngày nữa</strong>.</p>
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
    }
    console.log(`[autoCleanup] Đã xử lý / gửi email ${cleanedCount} records.`);
    return null;
});
