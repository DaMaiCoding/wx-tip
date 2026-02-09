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

// Confirm Modal Elements
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalContent = document.getElementById('confirm-modal-content');
const confirmModalDesc = document.getElementById('confirm-modal-desc');
const confirmModalBtnConfirm = document.getElementById('confirm-modal-btn-confirm');
const confirmModalBtnCancel = document.getElementById('confirm-modal-btn-cancel');
const confirmModalBtnX = document.getElementById('confirm-modal-btn-x');

let currentConfirmCallback = null;

function hideConfirmModal() {
    confirmModal.classList.remove('active');
    setTimeout(() => {
        confirmModal.style.display = 'none';
        currentConfirmCallback = null;
    }, 200);
}

function showConfirmModal({ title, content, description, confirmText, onConfirm }) {
    if (!confirmModal) return;
    
    confirmModalTitle.innerText = title || '提示';
    confirmModalContent.innerText = content || '确定执行此操作？';
    confirmModalDesc.innerText = description || '操作无法撤销。';
    confirmModalBtnConfirm.innerText = confirmText || '确定';
    
    currentConfirmCallback = onConfirm;
    
    confirmModal.style.display = 'flex';
    // Trigger reflow
    confirmModal.offsetHeight;
    confirmModal.classList.add('active');
}

if (confirmModalBtnCancel) confirmModalBtnCancel.addEventListener('click', hideConfirmModal);
if (confirmModalBtnX) confirmModalBtnX.addEventListener('click', hideConfirmModal);
if (confirmModal) {
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) hideConfirmModal();
    });
}

if (confirmModalBtnConfirm) {
    confirmModalBtnConfirm.addEventListener('click', async () => {
        if (currentConfirmCallback) {
            await currentConfirmCallback();
        }
        hideConfirmModal();
    });
}

// System Settings Elements
const chkAutoLaunch = document.getElementById('chk-autolaunch');
const chkMonitor = document.getElementById('chk-monitor');
const chkAntiRecall = document.getElementById('chk-anti-recall');
const chkCustomPopup = document.getElementById('chk-custom-popup');
const chkDanmaku = document.getElementById('chk-danmaku');
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

// Anti-Recall
if (chkAntiRecall) {
    chkAntiRecall.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const isSet = await window.electronAPI.toggleAntiRecall(enabled);
        console.log(`Anti-Recall set to: ${isSet}`);
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

// Danmaku
if (chkDanmaku) {
    chkDanmaku.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const isSet = await window.electronAPI.toggleDanmaku(enabled);
        console.log(`Danmaku set to: ${isSet}`);
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

    // Anti-Recall State
    const isAntiRecall = await window.electronAPI.getAntiRecallStatus();
    if (chkAntiRecall) chkAntiRecall.checked = isAntiRecall;

    // Custom Popup State
    const isCustomPopup = await window.electronAPI.getCustomPopupStatus();
    if (chkCustomPopup) chkCustomPopup.checked = isCustomPopup;

    // Danmaku State
    const isDanmaku = await window.electronAPI.getDanmakuStatus();
    if (chkDanmaku) chkDanmaku.checked = isDanmaku;

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

    // Initialize Recall History
    if (document.getElementById('recall-list')) {
        initRecallHistory();
    }
})();

// Recall History Logic
const recallList = document.getElementById('recall-list');
const btnClearRecall = document.getElementById('btn-clear-recall');

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        month: '2-digit',
        day: '2-digit'
    });
}

function createRecallElement(item) {
    const div = document.createElement('div');
    div.className = 'recall-item';
    
    // Safety check for content
    const content = item.content || '无内容';
    const time = item.time ? formatTime(item.time) : formatTime(Date.now());
    const itemId = item.time; // Use timestamp as ID
    const title = item.title || '拦截到撤回消息';
    
    div.innerHTML = `
        <div class="recall-header">
            <div class="recall-title">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
                </svg>
                <span>${title}</span>
            </div>
            <div class="recall-actions">
                <span class="recall-time">${time}</span>
                <button class="delete-btn" title="删除这条记录">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="recall-content">
            ${content}
        </div>
    `;

    // Add event listener for delete button
    const deleteBtn = div.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showConfirmModal({
                title: '删除提示',
                content: '确定删除这条记录？',
                description: '删除后将无法恢复该条记录。',
                confirmText: '确定删除',
                onConfirm: async () => {
                    await window.electronAPI.deleteRecallItem(itemId);
                    div.remove();
                    if (recallList.children.length === 0) {
                        showEmptyState();
                    }
                }
            });
        });
    }

    return div;
}

async function initRecallHistory() {
    try {
        // Load initial history
        const history = await window.electronAPI.getRecallHistory();
        renderRecallList(history);

        // Listen for new logs
        window.electronAPI.onRecallLog((item) => {
            addRecallItem(item);
        });

        // Clear button - Show Custom Modal
        if (btnClearRecall) {
            btnClearRecall.addEventListener('click', () => {
                showConfirmModal({
                    title: '清空提示',
                    content: '确定清空所有记录？',
                    description: '清空后所有撤回消息记录将无法恢复。',
                    confirmText: '确定清空',
                    onConfirm: async () => {
                        await window.electronAPI.clearRecallHistory();
                        renderRecallList([]);
                    }
                });
            });
        }

    } catch (err) {
        console.error('Failed to init recall history:', err);
    }
}

function renderRecallList(items) {
    if (!recallList) return;
    
    recallList.innerHTML = '';
    
    if (!items || items.length === 0) {
        showEmptyState();
        return;
    }

    items.forEach(item => {
        recallList.appendChild(createRecallElement(item));
    });
}

function addRecallItem(item) {
    if (!recallList) return;

    // Remove empty state if present
    const emptyState = recallList.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    // Prepend new item
    const element = createRecallElement(item);
    recallList.insertBefore(element, recallList.firstChild);
    
    // Limit to 100 items in UI
    if (recallList.children.length > 100) {
        recallList.removeChild(recallList.lastChild);
    }
}

function showEmptyState() {
    if (!recallList) return;
    recallList.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="64" height="64">
                    <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
                </svg>
            </div>
            <p>暂无撤回记录</p>
        </div>
    `;
}
