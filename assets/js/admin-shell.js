/**
 * admin-shell.js
 * Script thêm vào mỗi trang admin con để hỗ trợ Shell layout.
 * - Nếu đang trong iframe (shell): ẩn sidebar, inject nút hamburger vào header
 * - Nếu chạy standalone: redirect về index.html (shell page)
 */
(function() {
    const isInIframe = window.self !== window.top;

    if (isInIframe) {
        // Đang trong iframe → ẩn sidebar via CSS class
        document.documentElement.classList.add('in-shell');
        window.__ADMIN_SHELL__ = true;

        // Inject hamburger button into child page header
        const injectHamburger = () => {
            const header = document.querySelector('main > header, body > div > main > header');
            if (!header) return;

            // Create hamburger button
            const btn = document.createElement('button');
            btn.id = 'shell-hamburger-btn';
            btn.className = 'w-9 h-9 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-all mr-2 shrink-0';
            btn.title = 'Đóng/Mở menu';
            btn.innerHTML = '<i class="ph ph-list text-xl"></i>';
            btn.addEventListener('click', () => {
                // Call parent's toggleSidebar
                if (window.parent && window.parent.toggleSidebar) {
                    window.parent.toggleSidebar();
                }
            });

            // Insert at the beginning of header
            header.insertBefore(btn, header.firstChild);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectHamburger);
        } else {
            injectHamburger();
        }
    } else {
        // Không trong iframe → redirect về shell page
        const currentPage = window.location.pathname.split('/').pop();
        if (currentPage && currentPage !== 'index.html') {
            localStorage.setItem('admin_current_page', currentPage);
            window.location.replace('index.html');
        }
    }
})();
