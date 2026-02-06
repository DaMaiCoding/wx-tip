// Navigation
const navItems = document.querySelectorAll('.nav-item[data-target]');
const contentViews = document.querySelectorAll('.content-view');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetId = item.getAttribute('data-target');
        
        // Update Nav State
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        // Update View State
        contentViews.forEach(view => {
            view.classList.remove('active');
            if(view.id === `view-${targetId}`) {
                view.classList.add('active');
            }
        });
    });
});

const btnTestNative = document.getElementById('btn-test-native');
const btnTestCustom = document.getElementById('btn-test-custom');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

// Modal Elements
const closeModal = document.getElementById('close-modal');
const modalBtnMinimize = document.getElementById('modal-btn-minimize');
const modalBtnExit = document.getElementById('modal-btn-exit');
const modalBtnCancel = document.getElementById('modal-btn-cancel');
const modalBtnX = document.getElementById('modal-btn-x');

function hideModal() {
    closeModal.classList.remove('active');
    setTimeout(() => {
        closeModal.style.display = 'none';
    }, 200);
}

function showModal() {
    closeModal.style.display = 'flex';
    // Trigger reflow
    closeModal.offsetHeight;
    closeModal.classList.add('active');
}

// Modal Event Listeners
if (modalBtnMinimize) {
    modalBtnMinimize.addEventListener('click', () => {
        window.electronAPI.close(); // Minimizes to tray
        hideModal();
    });
}

if (modalBtnExit) {
    modalBtnExit.addEventListener('click', () => {
        window.electronAPI.quitApp(); // Quits app
    });
}

if (modalBtnCancel) {
    modalBtnCancel.addEventListener('click', hideModal);
}

if (modalBtnX) {
    modalBtnX.addEventListener('click', hideModal);
}

// Close modal when clicking outside
if (closeModal) {
    closeModal.addEventListener('click', (e) => {
        if (e.target === closeModal) {
            hideModal();
        }
    });
}

// System Settings Elements
const chkAutoLaunch = document.getElementById('chk-autolaunch');
const chkMonitor = document.getElementById('chk-monitor');
const chkCustomPopup = document.getElementById('chk-custom-popup');
const btnAbout = document.getElementById('btn-about');
const themeRadios = document.querySelectorAll('input[name="theme"]');

// Window Controls
if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
        window.electronAPI.minimize();
    });
}

if (btnClose) {
    btnClose.addEventListener('click', () => {
        showModal();
    });
}

// Notification Test
if (btnTestNative) {
    btnTestNative.addEventListener('click', () => {
        console.log('点击了测试原生弹窗');
        window.electronAPI.showNotification('微信', '这是原生通知测试。', 'native');
    });
}

if (btnTestCustom) {
    btnTestCustom.addEventListener('click', () => {
        console.log('点击了测试自定义弹窗');
        window.electronAPI.showNotification('微信', '这是自定义弹窗测试。', 'custom');
    });
}

// Auto Launch
if (chkAutoLaunch) {
    chkAutoLaunch.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const isSet = await window.electronAPI.toggleAutoLaunch(enabled);
        console.log(`Auto Launch set to: ${isSet}`);
    });
}

// Monitor
if (chkMonitor) {
    chkMonitor.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const isSet = await window.electronAPI.toggleMonitor(enabled);
        console.log(`Monitor set to: ${isSet}`);
    });
}

// Custom Popup
if (chkCustomPopup) {
    chkCustomPopup.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const isSet = await window.electronAPI.toggleCustomPopup(enabled);
        console.log(`Custom Popup set to: ${isSet}`);
    });
}

// Theme Logic
function applyTheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

// Initial application
applyTheme();

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// Theme Radio Handling
themeRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
        const theme = e.target.value;
        await window.electronAPI.setTheme(theme);
        console.log(`Theme set to: ${theme}`);
        // Force re-check in case the media query event didn't trigger immediately or reliably
        applyTheme();
    });
});

// Initialize
(async () => {
    // Auto Launch State
    const isAutoLaunch = await window.electronAPI.getAutoLaunch();
    if (chkAutoLaunch) chkAutoLaunch.checked = isAutoLaunch;

    // Monitor State
    const isMonitor = await window.electronAPI.getMonitorStatus();
    if (chkMonitor) chkMonitor.checked = isMonitor;

    // Custom Popup State
    const isCustomPopup = await window.electronAPI.getCustomPopupStatus();
    if (chkCustomPopup) chkCustomPopup.checked = isCustomPopup;

    // Theme State
    const currentTheme = await window.electronAPI.getTheme();
    const themeToSelect = currentTheme || 'system';
    const radioToSelect = document.querySelector(`input[name="theme"][value="${themeToSelect}"]`);
    if (radioToSelect) radioToSelect.checked = true;

    // App Version
    const version = await window.electronAPI.getAppVersion();
    if (btnAbout) {
        btnAbout.setAttribute('data-tooltip', `当前版本: ${version}`);
    }
})();
