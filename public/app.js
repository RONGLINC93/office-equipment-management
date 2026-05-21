/**
 * 办公设备管理系统 - 前端应用
 * Copyright (c) 2025 RONGLINC
 * SPDX-License-Identifier: ISC
 */

const API_URL = '/api';
const DEFAULT_ICON_MAP = {
  '电脑': 'fa-laptop',
  '打印机': 'fa-print',
  '复印机': 'fa-copy',
  '扫描仪': 'fa-scanner',
  '传真机': 'fa-fax',
  '投影仪': 'fa-video',
  '电话': 'fa-phone',
  '碎纸机': 'fa-trash-alt',
  '装订机': 'fa-book',
  '考勤机': 'fa-clock',
  '显示屏': 'fa-tv',
  '网络设备': 'fa-network-wired',
  '其他': 'fa-desktop'
};

// 检测是否是移动端
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

let devices = [];
let deviceTypesCache = [];
let editingId = null;
let selectedImages = [];
let deleteConfirmCallback = null;

let currentLevel = 0;
let currentFilters = {
  address: null,
  building: null,
  roomNumber: null
};
let navigationHistory = [];
let seatSelectionModalData = null; // 座位选择弹窗数据

document.addEventListener('DOMContentLoaded', async () => {
  // 检查登录状态
  await checkLoginStatus();
  
  await loadDevices(true);
  await getDeviceTypes();
  setupEventListeners();
  applySettings();
  await renderDeviceTypeList();
  
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('collapsed');
  }
});

// 检查登录状态
async function checkLoginStatus() {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = 'login.html';
      return;
    }

    const response = await fetch(`/api/check-login?token=${token}`);
    const result = await response.json();
    
    if (!result.loggedIn) {
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
      window.location.href = 'login.html';
    } else {
      // 更新当前用户信息
      localStorage.setItem('currentUser', JSON.stringify(result.user));
      updateUserInfo(result.user);
    }
  } catch (error) {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
  }
}

// 更新用户信息显示
function updateUserInfo(user) {
  const profileName = document.getElementById('profileName');
  const profileRole = document.getElementById('profileRole');
  
  if (profileName) profileName.textContent = user.fullName || user.username;
  if (profileRole) {
    const roleMap = { 'admin': '系统管理员', 'manager': '设备管理员', 'user': '普通用户' };
    profileRole.textContent = roleMap[user.role] || '用户';
  }
}

// 退出登录
function logout() {
  showConfirmModal('确定要退出登录吗？', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
  }, '退出');
}

// 设置事件监听器
function setupEventListeners() {
  document.getElementById('btnAdd').addEventListener('click', showAddModal);
  document.getElementById('btnSearch').addEventListener('click', searchDevices);
  document.getElementById('btnClear').addEventListener('click', clearSearch);
  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') searchDevices();
  });
  
  // 搜索视图中的事件监听器
  document.getElementById('btnSearchKeyword')?.addEventListener('click', () => {
    performSearch();
  });
  document.getElementById('searchKeyword')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  document.getElementById('btnClearSearch')?.addEventListener('click', clearSearchView);
  document.getElementById('btnBack').addEventListener('click', goBack);
  
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
  
  // 顶部个人中心按钮点击
  document.getElementById('btnProfile')?.addEventListener('click', async () => {
    ensureTabExists('profile', 'fa-user-circle', '个人中心');
    switchTab('profile');
    await loadUserInfo();
  });

  // 手动更新按钮点击 - 打开更新模态框
  document.getElementById('btnManualUpdate')?.addEventListener('click', () => {
    const updateModal = document.getElementById('updateModal');
    updateModal.classList.add('show');
  });

  // 更新模态框关闭按钮
  document.querySelector('.update-modal-close')?.addEventListener('click', () => {
    document.getElementById('updateModal').classList.remove('show');
  });

  // 更新模态框取消按钮
  document.getElementById('btnUpdateCancel')?.addEventListener('click', () => {
    document.getElementById('updateModal').classList.remove('show');
  });

  // 文件选择处理
  const updateFileInput = document.getElementById('updateFile');
  const btnUploadUpdate = document.getElementById('btnUploadUpdate');
  const updateFileName = document.getElementById('updateFileName');

  updateFileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.name.endsWith('.zip')) {
        btnUploadUpdate.disabled = false;
        updateFileName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
        const updateStatus = document.getElementById('updateStatus');
        updateStatus.style.display = 'none';
      } else {
        updateFileName.textContent = '';
        const updateStatus = document.getElementById('updateStatus');
        updateStatus.style.display = 'block';
        updateStatus.className = 'update-status error';
        updateStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i> 请选择ZIP格式的更新包！';
        btnUploadUpdate.disabled = true;
        updateFileInput.value = '';
      }
    }
  });
  
  // 上传并更新按钮点击
  btnUploadUpdate?.addEventListener('click', async () => {
    const file = updateFileInput.files[0];
    if (!file) return;

    // 防止重复点击
    if (btnUploadUpdate.disabled) return;

    const updateStatus = document.getElementById('updateStatus');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressFill = uploadProgress.querySelector('.progress-fill');
    const progressText = uploadProgress.querySelector('.progress-text');

    btnUploadUpdate.disabled = true;
    btnUploadUpdate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
    updateStatus.style.display = 'block';
    updateStatus.className = 'update-status';
    updateStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在上传更新包...';
    uploadProgress.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';

    // 使用 XMLHttpRequest 以支持上传进度
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = percent + '%';
          progressText.textContent = percent + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploadProgress.style.display = 'none';
          updateStatus.className = 'update-status success';
          updateStatus.innerHTML = '<i class="fas fa-check-circle"></i> 更新包上传成功！正在重启服务器...5秒后自动刷新页面';

          setTimeout(() => {
            window.location.reload();
          }, 5000);

          resolve();
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.error || '更新失败'));
          } catch {
            reject(new Error('更新失败'));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('网络错误'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('请求超时'));
      });

      const formData = new FormData();
      formData.append('file', file);

      xhr.open('POST', `${API_URL}/system-update`);
      xhr.timeout = 120000; // 2分钟超时
      xhr.send(formData);
    }).catch((error) => {
      uploadProgress.style.display = 'none';
      updateStatus.className = 'update-status error';
      updateStatus.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message}`;
      btnUploadUpdate.disabled = false;
      btnUploadUpdate.innerHTML = '<i class="fas fa-upload"></i> 上传并更新';
    });
  });
  
  // 侧边栏导航点击事件
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', handleNavClick);
  });
  
  // 标签页点击
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        const view = tab.getAttribute('data-view');
        switchTab(view);
      }
    });
  });
  
  // 关闭标签页按钮
  document.querySelectorAll('.tab-close').forEach(closeBtn => {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = closeBtn.closest('.tab-item');
      const view = tabItem.getAttribute('data-view');
      closeTab(view);
    });
  });

  // 标签栏拖拽排序
  const tabBar = document.querySelector('.tab-bar');
  let draggedTab = null;

  tabBar.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('tab-item')) {
      draggedTab = e.target;
      e.target.classList.add('dragging');
    }
  });

  tabBar.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('tab-item')) {
      e.target.classList.remove('dragging');
      draggedTab = null;
    }
  });

  tabBar.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(e.clientX);
    if (draggedTab) {
      if (afterElement == null) {
        tabBar.appendChild(draggedTab);
      } else {
        tabBar.insertBefore(draggedTab, afterElement);
      }
    }
  });

  // 获取拖拽后元素
  function getDragAfterElement(x) {
    const tabs = [...tabBar.querySelectorAll('.tab-item:not([style*="opacity"])')];
    return tabs.reduce((closest, tab) => {
      const box = tab.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: tab };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
  
  document.getElementById('deviceForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('btnCancel').addEventListener('click', hideModal);
  
  // 图片上传事件
  document.getElementById('deviceImage')?.addEventListener('change', handleImageUpload);
  
  // 系统设置事件
  document.getElementById('btnSaveSettings')?.addEventListener('click', saveSettings);
  document.getElementById('btnResetSettings')?.addEventListener('click', resetSettings);
  document.getElementById('btnBackup')?.addEventListener('click', backupData);
  document.getElementById('btnRestore')?.addEventListener('click', restoreData);
  document.getElementById('btnClearData')?.addEventListener('click', clearData);
  document.getElementById('btnAddDeviceType')?.addEventListener('click', addDeviceType);
  document.getElementById('btnCreateBackup')?.addEventListener('click', createBackup);
  document.getElementById('btnRestoreOk')?.addEventListener('click', performRestore);
  document.getElementById('btnRestoreCancel')?.addEventListener('click', hideRestoreModal);
  document.querySelector('.restore-modal-close')?.addEventListener('click', hideRestoreModal);
  
  // 座位布局快速选择
  document.getElementById('seatLayout')?.addEventListener('change', function() {
    if (this.value) {
      const [row, col] = this.value.split('x');
      renderSeatPreview(parseInt(row), parseInt(col));
    }
  });

  // 座位行和座位列手动输入时也更新预览
  document.getElementById('seatRow')?.addEventListener('input', updateSeatPreviewFromInputs);
  document.getElementById('seatColumn')?.addEventListener('input', updateSeatPreviewFromInputs);
  
  // 个人中心事件
  document.getElementById('btnUpdateProfile')?.addEventListener('click', updateProfile);
  document.getElementById('btnChangePassword')?.addEventListener('click', changePassword);
  document.getElementById('btnLogout')?.addEventListener('click', logout);
  
  // 回车添加设备类型
  document.getElementById('newDeviceType')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addDeviceType();
  });
  
  // 侧边栏宽度滑块
  document.getElementById('sidebarWidth')?.addEventListener('input', (e) => {
    document.getElementById('sidebarWidthValue').textContent = e.target.value + 'px';
  });
  
  const modal = document.getElementById('modal');
  const modalCloseButtons = modal.querySelectorAll('.close');
  modalCloseButtons.forEach(btn => {
    btn.addEventListener('click', hideModal);
  });
  
  const confirmModal = document.getElementById('confirmModal');
  confirmModal.querySelector('.confirm-close').addEventListener('click', hideConfirmModal);
  document.getElementById('btnConfirmCancel').addEventListener('click', hideConfirmModal);
  // 防重复确认标志
let isConfirming = false;

document.getElementById('btnConfirmOk').addEventListener('click', async () => {
    console.log('[确认弹窗] 确认按钮被点击');
    console.log('[确认弹窗] isConfirming:', isConfirming);
    console.log('[确认弹窗] deleteConfirmCallback:', !!deleteConfirmCallback);
    
    if (isConfirming) return;
    
    const btnConfirmOk = document.getElementById('btnConfirmOk');
    const originalText = btnConfirmOk.textContent;
    
    if (deleteConfirmCallback) {
      isConfirming = true;
      btnConfirmOk.textContent = '处理中...';
      
      // 保存回调并立即清空
      const callback = deleteConfirmCallback;
      deleteConfirmCallback = null;
      
      console.log('[确认弹窗] 执行回调');
      try {
        await callback();
        console.log('[确认弹窗] 回调执行完成');
      } catch (error) {
        console.error('[确认弹窗] 回调执行失败:', error);
      }
      
      // 隐藏弹窗（此时 deleteConfirmCallback 已经被清空）
      hideConfirmModal();
      console.log('[确认弹窗] 弹窗已隐藏');
    }
    
    isConfirming = false;
    btnConfirmOk.textContent = originalText;
    console.log('[确认弹窗] 状态已重置');
  });

  // 设备右键菜单事件
  setupDeviceContextMenu();
}

// 设备右键菜单相关变量
let contextMenuTargetDevice = null;
let contextMenuInitialized = false;

// 显示设备右键菜单
function showDeviceContextMenu(x, y, deviceId) {
  contextMenuTargetDevice = deviceId;

  const contextMenu = document.getElementById('deviceContextMenu');
  contextMenu.classList.add('show');

  // 计算菜单位置，确保在视口内
  const menuWidth = 180;
  const menuHeight = 180;

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10;
  }

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

// 初始化设备右键菜单
function setupDeviceContextMenu() {
  // 防止重复初始化
  if (contextMenuInitialized) return;
  contextMenuInitialized = true;

  const cardView = document.getElementById('cardView');
  if (!cardView) return;

  // 右键点击设备项（桌面端）
  cardView.addEventListener('contextmenu', (e) => {
    const deviceItem = e.target.closest('.device-item');
    if (!deviceItem) return;

    e.preventDefault();
    showDeviceContextMenu(e.clientX, e.clientY, deviceItem.dataset.deviceId);
  });

  // 点击其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
      document.getElementById('deviceContextMenu')?.classList.remove('show');
    }
  });

  // 菜单项点击事件
  document.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      handleContextMenuAction(action, contextMenuTargetDevice);
      document.getElementById('deviceContextMenu')?.classList.remove('show');
    });
    
    // 移动端触摸支持
    item.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = item.dataset.action;
      handleContextMenuAction(action, contextMenuTargetDevice);
      document.getElementById('deviceContextMenu')?.classList.remove('show');
    });
  });

  // 禁用页面其他地方的右键菜单
  document.addEventListener('contextmenu', (e) => {
    const deviceItem = e.target.closest('.device-item');
    if (!deviceItem) {
      e.preventDefault();
    }
  });

  // 移动端菜单按钮触摸事件支持
  document.addEventListener('touchend', (e) => {
    const menuBtn = e.target.closest('.device-menu-btn');
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const deviceItem = menuBtn.closest('.device-item');
      if (deviceItem) {
        showDeviceContextMenu(e.changedTouches[0].clientX, e.changedTouches[0].clientY, deviceItem.dataset.deviceId);
      }
    }
  }, { passive: false });
}

// 处理右键菜单操作
function handleContextMenuAction(action, deviceId) {
  if (!deviceId) return;

  switch (action) {
    case 'edit':
      editDevice(deviceId);
      break;
    case 'copy':
      copyDevice(deviceId);
      break;
    case 'move':
      moveDevice(deviceId);
      break;
    case 'delete':
      deleteDevice(deviceId);
      break;
    case 'properties':
      viewDevice(deviceId);
      break;
  }
}

// 复制设备
function copyDevice(deviceId) {
  const device = devices.find(d => d.id === deviceId);
  if (!device) return;

  // 打开座位选择弹窗（复制模式）
  showSeatSelectionModal(deviceId, device, 'copy');
}

// 移动设备
function moveDevice(deviceId) {
  const device = devices.find(d => d.id === deviceId);
  if (!device) return;

  // 打开座位选择弹窗
  showSeatSelectionModal(deviceId, device);
}

// 删除设备（统一入口）
function deleteDevice(id) {
  const device = devices.find(d => d.id === id);
  const deviceName = device ? device.deviceName : '此设备';
  
  showConfirmModal(`确定要删除设备 "<strong>${deviceName}</strong>" 吗？此操作不可恢复。`, async () => {
    try {
      const response = await fetch(`${API_URL}/devices/${id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('删除失败');
      
      await loadDevices();
      renderLevel(currentLevel, currentFilters);
      showMessage(`设备 "${deviceName}" 已删除`, 'success');
    } catch (error) {
      showMessage('删除设备失败：' + error.message, 'error');
    }
  }, '删除');
}

// 显示座位选择弹窗
function showSeatSelectionModal(deviceId, device, mode = 'move') {
  // 移除已存在的弹窗
  const existingModal = document.getElementById('seatSelectionModal');
  if (existingModal) existingModal.remove();

  const currentSeatRow = parseInt(device.seatRow) || 0;
  const currentSeatCol = parseInt(device.seatColumn) || 0;
  const currentSeatName = currentSeatRow === 0 ? '公共区域' : `${currentSeatRow}行${currentSeatCol}列`;

  // 动态计算座位行列数（根据当前房间的座位数，如果不在房间则使用3×3）
  let totalRows = 3;
  let totalCols = 3;
  
  // 优先使用当前筛选的房间
  let targetRoomNumber = currentFilters.roomNumber;
  
  // 如果不在房间级别，使用设备所在的房间
  if (!targetRoomNumber && device.roomNumber) {
    targetRoomNumber = device.roomNumber;
  }
  
  if (targetRoomNumber) {
    // 使用目标房间的设备计算座位数
    const roomDevices = devices.filter(d => d.roomNumber === targetRoomNumber);
    const rows = roomDevices.map(d => parseInt(d.seatRow) || 0).filter(r => r > 0);
    const cols = roomDevices.map(d => {
      const col = parseInt(d.seatColumn) || 0;
      return col > 0 ? col : 1;
    });
    
    totalRows = rows.length > 0 ? Math.max(...rows) : 3;
    totalCols = cols.length > 0 ? Math.max(...cols) : 3;
  }

  // 生成座位网格HTML（参考座位预览的seat-preview-grid-mini）
  let seatGridHtml = '';

  // 第一行：公共区域 + 列标签
  const publicClass = currentSeatRow === 0 ? 'seat-preview-cell public-cell clickable selected' : 'seat-preview-cell public-cell clickable';
  seatGridHtml += `<div class="${publicClass}" onclick="selectSeatInModal(0, 0, '公共区域')">公共区域</div>`;
  for (let c = 1; c <= totalCols; c++) {
    seatGridHtml += `<div class="seat-preview-cell col-label">${c}列</div>`;
  }

  // 行和座位（从下到上）
  for (let r = totalRows; r >= 1; r--) {
    seatGridHtml += `<div class="seat-preview-cell row-label">${r}行</div>`;
    for (let c = 1; c <= totalCols; c++) {
      const isCurrent = r === currentSeatRow && c === currentSeatCol;
      const cellClass = isCurrent ? 'seat-preview-cell clickable selected' : 'seat-preview-cell clickable';
      seatGridHtml += `<div class="${cellClass}" onclick="selectSeatInModal(${r}, ${c}, '${r}行${c}列')">(${r},${c})</div>`;
    }
  }

  const isCopyMode = mode === 'copy';
  const title = isCopyMode ? '复制设备' : '移动设备';
  const titleIcon = isCopyMode ? 'fa-copy' : 'fa-exchange-alt';
  const buttonText = isCopyMode ? '确定复制' : '确定移动';

  const modal = document.createElement('div');
  modal.id = 'seatSelectionModal';
  modal.className = 'modal show';
  modal.innerHTML = `
    <div class="modal-content modal-sm">
      <div class="modal-header">
        <h2><i class="fas ${titleIcon}"></i> ${title}</h2>
        <span class="close" onclick="closeSeatSelectionModal()">&times;</span>
      </div>
      <div class="modal-body" style="text-align: left;">
        <p style="margin-bottom: 12px;">当前设备：<strong>${device.deviceName}</strong></p>
        ${isCopyMode ? '' : `<p style="margin-bottom: 16px;">当前位置：<strong>${currentSeatName}</strong></p>`}
        
        <div style="margin-bottom: 12px;">
          <label style="color: var(--text-secondary); margin-right: 8px;">座位布局：</label>
          <select id="seatLayoutSelect" onchange="updateSeatSelectionGrid()" class="form-control" style="width: auto; display: inline-block;">
          <option value="1x1" ${totalRows === 1 && totalCols === 1 ? 'selected' : ''}>1×1</option>
          <option value="1x2" ${totalRows === 1 && totalCols === 2 ? 'selected' : ''}>1×2</option>
          <option value="1x3" ${totalRows === 1 && totalCols === 3 ? 'selected' : ''}>1×3</option>
          <option value="1x4" ${totalRows === 1 && totalCols === 4 ? 'selected' : ''}>1×4</option>
          <option value="1x5" ${totalRows === 1 && totalCols === 5 ? 'selected' : ''}>1×5</option>
          <option value="2x1" ${totalRows === 2 && totalCols === 1 ? 'selected' : ''}>2×1</option>
          <option value="2x2" ${totalRows === 2 && totalCols === 2 ? 'selected' : ''}>2×2</option>
          <option value="2x3" ${totalRows === 2 && totalCols === 3 ? 'selected' : ''}>2×3</option>
          <option value="2x4" ${totalRows === 2 && totalCols === 4 ? 'selected' : ''}>2×4</option>
          <option value="2x5" ${totalRows === 2 && totalCols === 5 ? 'selected' : ''}>2×5</option>
          <option value="3x1" ${totalRows === 3 && totalCols === 1 ? 'selected' : ''}>3×1</option>
          <option value="3x2" ${totalRows === 3 && totalCols === 2 ? 'selected' : ''}>3×2</option>
          <option value="3x3" ${totalRows === 3 && totalCols === 3 ? 'selected' : ''}>3×3</option>
          <option value="3x4" ${totalRows === 3 && totalCols === 4 ? 'selected' : ''}>3×4</option>
          <option value="3x5" ${totalRows === 3 && totalCols === 5 ? 'selected' : ''}>3×5</option>
          <option value="4x1" ${totalRows === 4 && totalCols === 1 ? 'selected' : ''}>4×1</option>
          <option value="4x2" ${totalRows === 4 && totalCols === 2 ? 'selected' : ''}>4×2</option>
          <option value="4x3" ${totalRows === 4 && totalCols === 3 ? 'selected' : ''}>4×3</option>
          <option value="4x4" ${totalRows === 4 && totalCols === 4 ? 'selected' : ''}>4×4</option>
          <option value="4x5" ${totalRows === 4 && totalCols === 5 ? 'selected' : ''}>4×5</option>
          <option value="5x1" ${totalRows === 5 && totalCols === 1 ? 'selected' : ''}>5×1</option>
          <option value="5x2" ${totalRows === 5 && totalCols === 2 ? 'selected' : ''}>5×2</option>
          <option value="5x3" ${totalRows === 5 && totalCols === 3 ? 'selected' : ''}>5×3</option>
          <option value="5x4" ${totalRows === 5 && totalCols === 4 ? 'selected' : ''}>5×4</option>
          <option value="5x5" ${totalRows === 5 && totalCols === 5 ? 'selected' : ''}>5×5</option>
          </select>
        </div>
        
        <p style="margin-bottom: 12px; color: var(--text-secondary);">选择目标座位：</p>
        <div id="seatSelectionGrid" class="seat-preview-grid" style="grid-template-columns: repeat(${totalCols + 1}, 50px);">
          ${seatGridHtml}
        </div>
        <div id="selectedSeatDisplay" style="margin-top: 16px; padding: 10px; background: #f8fafc; border-radius: 6px;">
          已选择：<strong>${currentSeatName}</strong>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeSeatSelectionModal()">取消</button>
        <button class="btn btn-primary" onclick="${isCopyMode ? `confirmCopyDevice('${deviceId}')` : `confirmMoveDevice('${deviceId}')`}"><i class="fas fa-check"></i> ${buttonText}</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 保存当前设备信息用于重新渲染
  seatSelectionModalData = {
    deviceId: deviceId,
    device: device,
    mode: mode,
    currentSeatRow: currentSeatRow,
    currentSeatCol: currentSeatCol
  };
}

// 更新座位选择弹窗的网格
function updateSeatSelectionGrid() {
  const select = document.getElementById('seatLayoutSelect');
  const grid = document.getElementById('seatSelectionGrid');
  const display = document.getElementById('selectedSeatDisplay');
  
  if (!select || !grid || !seatSelectionModalData) return;
  
  const [rows, cols] = select.value.split('x').map(Number);
  const { currentSeatRow, currentSeatCol } = seatSelectionModalData;
  
  // 生成新的座位网格HTML
  let seatGridHtml = '';
  
  // 第一行：公共区域 + 列标签
  const publicClass = currentSeatRow === 0 ? 'seat-preview-cell public-cell clickable selected' : 'seat-preview-cell public-cell clickable';
  seatGridHtml += `<div class="${publicClass}" onclick="selectSeatInModal(0, 0, '公共区域')">公共区域</div>`;
  for (let c = 1; c <= cols; c++) {
    seatGridHtml += `<div class="seat-preview-cell col-label">${c}列</div>`;
  }
  
  // 行和座位（从下到上）
  for (let r = rows; r >= 1; r--) {
    seatGridHtml += `<div class="seat-preview-cell row-label">${r}行</div>`;
    for (let c = 1; c <= cols; c++) {
      const isCurrent = r === currentSeatRow && c === currentSeatCol;
      const cellClass = isCurrent ? 'seat-preview-cell clickable selected' : 'seat-preview-cell clickable';
      seatGridHtml += `<div class="${cellClass}" onclick="selectSeatInModal(${r}, ${c}, '${r}行${c}列')">(${r},${c})</div>`;
    }
  }
  
  grid.style.gridTemplateColumns = `repeat(${cols + 1}, 50px)`;
  grid.innerHTML = seatGridHtml;
  
  // 更新显示
  const currentSeatName = currentSeatRow === 0 ? '公共区域' : `${currentSeatRow}行${currentSeatCol}列`;
  display.innerHTML = `已选择：<strong>${currentSeatName}</strong>`;
}

// 在弹窗中选择座位（只选中，不移动）
function selectSeatInModal(row, col, name) {
  const modal = document.getElementById('seatSelectionModal');
  if (!modal) return;

  // 更新选中状态
  modal.dataset.targetRow = row;
  modal.dataset.targetCol = col;
  modal.dataset.targetName = name;

  // 更新显示
  const display = document.getElementById('selectedSeatDisplay');
  if (display) {
    display.innerHTML = `已选择：<strong>${name}</strong>`;
  }

  // 更新UI选中样式
  const cells = modal.querySelectorAll('.seat-preview-cell.clickable');
  cells.forEach(cell => cell.classList.remove('selected'));
  
  // 找到并高亮选中的座位
  cells.forEach(cell => {
    if ((row === 0 && cell.textContent.includes('公共区域')) || 
        (row > 0 && cell.textContent === `(${row},${col})`)) {
      cell.classList.add('selected');
    }
  });
}

// 确认移动设备
async function confirmMoveDevice(deviceId) {
  const modal = document.getElementById('seatSelectionModal');
  if (!modal) return;

  const targetRow = parseInt(modal.dataset.targetRow);
  const targetCol = parseInt(modal.dataset.targetCol);
  const targetName = modal.dataset.targetName;

  closeSeatSelectionModal();
  await moveDeviceToSeat(deviceId, targetRow, targetCol);
}

// 确认复制设备
async function confirmCopyDevice(deviceId) {
  const modal = document.getElementById('seatSelectionModal');
  if (!modal) return;

  const targetRow = parseInt(modal.dataset.targetRow);
  const targetCol = parseInt(modal.dataset.targetCol);

  closeSeatSelectionModal();

  const originalDevice = devices.find(d => d.id === deviceId);
  if (!originalDevice) return;

  try {
    const formData = new FormData();
    formData.append('deviceType', originalDevice.deviceType || '');
    formData.append('deviceName', originalDevice.deviceName || '');
    formData.append('deviceConfig', originalDevice.deviceConfig || '');
    formData.append('remark', originalDevice.remark || '');
    formData.append('address', originalDevice.address || '');
    formData.append('building', originalDevice.building || '');
    formData.append('roomNumber', originalDevice.roomNumber || '');
    formData.append('seatRow', targetRow.toString());
    formData.append('seatColumn', targetCol.toString());
    formData.append('updateTime', new Date().toISOString());

    const existingImages = originalDevice.images || [];
    if (existingImages.length > 0) {
      formData.append('existingImages', JSON.stringify(existingImages));
    }

    const response = await fetch(`${API_URL}/devices`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) throw new Error('复制失败');

    await loadDevices();
    renderLevel(currentLevel, currentFilters);
    showMessage(`设备 "${originalDevice.deviceName}" 已复制成功`, 'success');
  } catch (error) {
    showMessage('复制设备失败：' + error.message, 'error');
  }
}

// 关闭座位选择弹窗
function closeSeatSelectionModal() {
  const modal = document.getElementById('seatSelectionModal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 200);
  }
}

// 选择目标座位并移动设备（保留旧函数兼容）
async function selectTargetSeat(deviceId, targetRow, targetCol, targetName) {
  closeSeatSelectionModal();
  await moveDeviceToSeat(deviceId, targetRow, targetCol);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
}


// 侧边栏导航点击事件处理
function handleNavClick(e) {
  e.stopPropagation();
  
  const target = e.currentTarget;
  const navItem = target.closest('.nav-item');
  
  if (!navItem) return;
  
  // 如果是父级导航（设备管理）
  if (navItem.classList.contains('nav-parent')) {
    // 切换展开/收起状态
    const wasActive = navItem.classList.contains('active');
    
    // 收起其他所有父级导航
    document.querySelectorAll('.nav-parent').forEach(item => {
      item.classList.remove('active');
    });
    
    // 如果之前不是展开状态，现在展开
    if (!wasActive) {
      navItem.classList.add('active');
    }
    
    // 切换到设备管理界面
    switchTab('deviceManagement');
  } else {
    // 其他导航项（系统设置、统计报表、用户管理）- 不改变侧边栏选中状态
    // 根据导航项切换到对应视图
    const navText = navItem.querySelector('.nav-text')?.textContent;
    if (navText === '系统设置') {
      ensureTabExists('settings', 'fas fa-cog', '系统设置');
      switchTab('settings');
    } else if (navText === '统计报表') {
      ensureTabExists('reports', 'fas fa-chart-line', '统计报表');
      switchTab('reports');
    } else if (navText === '用户管理') {
      ensureTabExists('users', 'fas fa-users', '用户管理');
      switchTab('users');
    } else if (navText === '关于系统') {
      ensureTabExists('about', 'fas fa-info-circle', '关于系统');
      switchTab('about');
    }
  }
}

// 确保标签存在 如果不存在则创建
function ensureTabExists(view, iconClass, labelText) {
  // 检查标签是否已存在
  const existingTab = document.querySelector(`.tab-item[data-view="${view}"]`);
  if (existingTab) {
    return;
  }

  // 创建新标签
  const tabBar = document.querySelector('.tab-bar');
  const newTab = document.createElement('div');
  newTab.className = 'tab-item';
  newTab.setAttribute('data-view', view);
  newTab.setAttribute('draggable', 'true');
  newTab.innerHTML = `
    <i class="fas ${iconClass}"></i>
    <span>${labelText}</span>
    <span class="tab-close">&times;</span>
  `;

  // 添加到标签栏末尾
  tabBar.appendChild(newTab);

  // 添加点击事件
  newTab.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchTab(view);
    }
  });

  // 添加关闭事件
  const closeBtn = newTab.querySelector('.tab-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(view);
  });
}

// 切换标签视图
function switchTab(view) {
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.remove('active');
    if (tab.getAttribute('data-view') === view) {
      tab.classList.add('active');
    }
  });

  const views = ['listView', 'tableView', 'cardView', 'settingsView', 'profileView', 'reportsView', 'usersView', 'aboutView', 'searchView'];
  views.forEach(v => document.getElementById(v).style.display = 'none');

  const btnBackRow = document.getElementById('btnBack').closest('.nav-row');
  const toolbar = document.getElementById('searchInput').closest('.toolbar');
  btnBackRow.style.display = 'none';
  toolbar.style.display = 'none';

  if (view === 'deviceManagement') {
    btnBackRow.style.display = 'flex';
    toolbar.style.display = 'flex';
    renderLevel(currentLevel, currentFilters);
    renderTreeView();
  } else if (view === 'settings') {
    document.getElementById('settingsView').style.display = 'block';
    loadDeviceTypes();
    refreshBackupList();
  } else if (view === 'reports') {
    document.getElementById('reportsView').style.display = 'block';
    renderReports();
  } else if (view === 'users') {
    document.getElementById('usersView').style.display = 'block';
    renderUsers();
  } else if (view === 'profile') {
    document.getElementById('profileView').style.display = 'block';
  } else if (view === 'about') {
    document.getElementById('aboutView').style.display = 'block';
  } else if (view === 'search') {
    document.getElementById('searchView').style.display = 'block';
    // 执行搜索
    const searchTerm = document.getElementById('searchKeyword').value.trim();
    if (searchTerm) {
      performSearch(searchTerm);
    }
  }
}

function closeTab(view) {
  // 设备管理标签不能关闭
  if (view === 'deviceManagement') {
    return;
  }
  
  const tabToClose = document.querySelector(`.tab-item[data-view="${view}"]`);
  if (!tabToClose) return;
  
  // 获取所有标签
  const allTabs = Array.from(document.querySelectorAll('.tab-item'));
  const currentIndex = allTabs.indexOf(tabToClose);
  const isCurrentActive = tabToClose.classList.contains('active');
  
  // 隐藏对应的视图
  if (view === 'settings') {
    document.getElementById('settingsView').style.display = 'none';
  } else if (view === 'reports') {
    document.getElementById('reportsView').style.display = 'none';
  } else if (view === 'users') {
    document.getElementById('usersView').style.display = 'none';
  } else if (view === 'profile') {
    document.getElementById('profileView').style.display = 'none';
  } else if (view === 'about') {
    document.getElementById('aboutView').style.display = 'none';
  }
  
  // 移除标签
  tabToClose.remove();
  
  // 如果关闭的是当前激活的标签，切换到相邻标签
  if (isCurrentActive) {
    const remainingTabs = Array.from(document.querySelectorAll('.tab-item'));
    if (remainingTabs.length > 0) {
      // 优先选择前一个标签，如果是最后一个则选择前一个
      const newIndex = Math.min(currentIndex, remainingTabs.length - 1);
      const newTab = remainingTabs[newIndex];
      const newView = newTab.getAttribute('data-view');
      switchTab(newView);
    } else {
      // 没有其他标签了，切换到设备管理
      switchTab('deviceManagement');
    }
  }
}

// 获取 token
function getToken() {
  return localStorage.getItem('token');
}

// 加载个人信息
async function loadUserInfo() {
  try {
    const response = await fetch(`${API_URL}/user?token=${getToken()}`);
    if (response.ok) {
      const user = await response.json();
      updateUserInfo(user);
      // 更新表单字段
      const profileUsername = document.getElementById('profileUsername');
      const profileFullName = document.getElementById('profileFullName');
      const profileEmail = document.getElementById('profileEmail');
      const profilePhone = document.getElementById('profilePhone');
      const profileDepartment = document.getElementById('profileDepartment');
      
      if (profileUsername) profileUsername.value = user.username;
      if (profileFullName) profileFullName.value = user.fullName || '';
      if (profileEmail) profileEmail.value = user.email || '';
      if (profilePhone) profilePhone.value = user.phone || '';
      if (profileDepartment) profileDepartment.value = user.department || '';
    }
  } catch (error) {
    console.error('加载用户信息失败:', error);
  }
}

// 更新个人信息
// 防重复更新个人信息标志
let isUpdatingProfile = false;

async function updateProfile() {
  // 防止重复点击
  if (isUpdatingProfile) return;
  isUpdatingProfile = true;
  
  const btnUpdateProfile = document.getElementById('btnUpdateProfile');
  const originalText = btnUpdateProfile?.textContent || '保存';
  btnUpdateProfile && (btnUpdateProfile.textContent = '保存中...');
  
  const fullName = document.getElementById('profileFullName').value;
  const email = document.getElementById('profileEmail').value;
  const phone = document.getElementById('profilePhone').value;
  const department = document.getElementById('profileDepartment').value;

  try {
    const response = await fetch(`${API_URL}/user?token=${getToken()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, phone, department })
    });

    if (response.ok) {
      document.getElementById('profileName').textContent = fullName;
      showMessage('个人信息更新成功', 'success');
    } else {
      const error = await response.json();
      showMessage(error.error || '更新失败', 'error');
    }
  } catch (error) {
    showMessage('更新失败: ' + error.message, 'error');
  } finally {
    isUpdatingProfile = false;
    btnUpdateProfile && (btnUpdateProfile.textContent = originalText);
  }
}

// 修改密码
// 防重复修改密码标志
let isChangingPassword = false;

async function changePassword() {
  // 防止重复点击
  if (isChangingPassword) return;
  isChangingPassword = true;
  
  const btnChangePassword = document.getElementById('btnChangePassword');
  const originalText = btnChangePassword?.textContent || '修改';
  btnChangePassword && (btnChangePassword.textContent = '修改中...');
  
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showMessage('请填写所有密码字段', 'error');
    isChangingPassword = false;
    btnChangePassword && (btnChangePassword.textContent = originalText);
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage('两次输入的新密码不一致', 'error');
    isChangingPassword = false;
    btnChangePassword && (btnChangePassword.textContent = originalText);
    return;
  }

  if (newPassword.length < 6) {
    showMessage('密码长度至少为 6 位', 'error');
    isChangingPassword = false;
    btnChangePassword && (btnChangePassword.textContent = originalText);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/user/change-password?token=${getToken()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    if (response.ok) {
      showMessage('密码修改成功', 'success');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    } else {
      const error = await response.json();
      showMessage(error.error || '修改失败', 'error');
    }
  } catch (error) {
    showMessage('修改失败: ' + error.message, 'error');
  } finally {
    isChangingPassword = false;
    btnChangePassword && (btnChangePassword.textContent = originalText);
  }
}

// 加载设备列表
async function loadDevices(initial = false) {
  try {
    const response = await fetch(`${API_URL}/devices`);
    if (!response.ok) throw new Error('加载失败');
    devices = await response.json();
    
    renderTreeView();
    
    if (initial) {
      renderLevel(0, {});
    } else {
      renderLevel(currentLevel, currentFilters);
    }
  } catch (error) {
    showMessage('加载设备列表失败：' + error.message, 'error');
  }
}

// 渲染树视图
function renderTreeView() {
  const treeView = document.getElementById('treeView');
  
  // 保存当前展开的状态
  const expandedAddresses = [];
  const expandedBuildings = [];
  document.querySelectorAll('.tree-children.expanded').forEach(el => {
    if (el.id.startsWith('addr-')) {
      expandedAddresses.push(el.id);
    } else if (el.id.startsWith('bld-')) {
      expandedBuildings.push(el.id);
    }
  });
  
  const groupedByAddress = devices.reduce((acc, device) => {
    const address = device.address || '未分类';
    if (!acc[address]) {
      acc[address] = { buildings: {}, count: 0 };
    }
    acc[address].count++;
    
    const building = device.building || '未分类';
    if (!acc[address].buildings[building]) {
      acc[address].buildings[building] = { rooms: {}, count: 0 };
    }
    acc[address].buildings[building].count++;
    
    const room = device.roomNumber || '未分类';
    if (!acc[address].buildings[building].rooms[room]) {
      acc[address].buildings[building].rooms[room] = 0;
    }
    acc[address].buildings[building].rooms[room]++;
    
    return acc;
  }, {});
  
  let html = '';

  Object.keys(groupedByAddress).sort().forEach(address => {
    const addressData = groupedByAddress[address];
    const addressId = `addr-${escapeHtmlAttr(address)}`;
    const isAddressExpanded = expandedAddresses.includes(addressId) ? 'expanded' : '';
    const isAddressActive = currentFilters.address === address && !currentFilters.building;

    html += `
      <div class="tree-item has-children${isAddressActive ? ' active' : ''}" data-type="address" data-value="${escapeHtmlAttr(address)}">
        <span class="tree-arrow">›</span>
        <span class="tree-icon"><i class="fas fa-map-marker-alt"></i></span>
        <span class="tree-item-text">${escapeHtml(address)}</span>
        <span class="tree-count">${addressData.count}</span>
      </div>
      <div id="${addressId}" class="tree-children ${isAddressExpanded}">
    `;

    Object.keys(addressData.buildings).sort().forEach(building => {
      const buildingData = addressData.buildings[building];
      const buildingId = `bld-${escapeHtmlAttr(address)}-${escapeHtmlAttr(building)}`;
      const isBuildingExpanded = expandedBuildings.includes(buildingId) ? 'expanded' : '';
      const isBuildingActive = currentFilters.address === address && currentFilters.building === building && !currentFilters.roomNumber;

      html += `
        <div class="tree-item has-children${isBuildingActive ? ' active' : ''}" data-type="building" data-address="${escapeHtmlAttr(address)}" data-value="${escapeHtmlAttr(building)}">
          <span class="tree-arrow">›</span>
          <span class="tree-icon"><i class="fas fa-building"></i></span>
          <span class="tree-item-text">${escapeHtml(building)}</span>
          <span class="tree-count">${buildingData.count}</span>
        </div>
        <div id="${buildingId}" class="tree-children ${isBuildingExpanded}">
      `;

      Object.keys(buildingData.rooms).sort().forEach(room => {
        const isRoomActive = currentFilters.address === address && currentFilters.building === building && currentFilters.roomNumber === room;
        html += `
          <div class="tree-item${isRoomActive ? ' active' : ''}" data-type="room" data-address="${escapeHtmlAttr(address)}" data-building="${escapeHtmlAttr(building)}" data-value="${escapeHtmlAttr(room)}">
            <span class="tree-arrow">›</span>
            <span class="tree-icon"><i class="fas fa-door-open"></i></span>
            <span class="tree-item-text">${escapeHtml(room)}</span>
            <span class="tree-count">${buildingData.rooms[room]}</span>
          </div>
        `;
      });

      html += '</div>';
    });

    html += '</div>';
  });
  
  treeView.innerHTML = html || '<div class="tree-item tree-item-empty">暂无数据</div>';
  
  addTreeListeners();
}

// 添加树节点点击事件监听器
function addTreeListeners() {
  document.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const type = item.getAttribute('data-type');
      const address = item.getAttribute('data-address');
      const building = item.getAttribute('data-building');
      const value = item.getAttribute('data-value');
      
      switchTab('deviceManagement');
      
      document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      if (type === 'address') {
        item.querySelector('.tree-arrow')?.classList.toggle('expanded');
        const children = document.getElementById(`addr-${escapeHtmlAttr(value)}`);
        children?.classList.toggle('expanded');
        
        navigationHistory.push({ level: 0, filters: { ...currentFilters } });
        renderLevel(1, { address: value });
      } else if (type === 'building') {
        item.querySelector('.tree-arrow')?.classList.toggle('expanded');
        const children = document.getElementById(`bld-${escapeHtmlAttr(address)}-${escapeHtmlAttr(value)}`);
        children?.classList.toggle('expanded');
        
        navigationHistory.push({ level: 1, filters: { ...currentFilters } });
        renderLevel(2, { address: address, building: value });
      } else if (type === 'room') {
        navigationHistory.push({ level: 2, filters: { ...currentFilters } });
        renderLevel(3, { address: address, building: building, roomNumber: value });
      }
    });
  });
}

// 渲染指定层级的视图
function renderLevel(level, filters) {
  const listView = document.getElementById('listView');
  const tableView = document.getElementById('tableView');
  const cardView = document.getElementById('cardView');
  const btnBack = document.getElementById('btnBack');
  
  currentLevel = level;
  currentFilters = filters;
  
  let filteredDevices = devices;
  
  if (filters.address) {
    filteredDevices = filteredDevices.filter(d => d.address === filters.address);
  }
  if (filters.building) {
    filteredDevices = filteredDevices.filter(d => d.building === filters.building);
  }
  if (filters.roomNumber) {
    filteredDevices = filteredDevices.filter(d => d.roomNumber === filters.roomNumber);
  }
  
  updateBreadcrumb();
  
  if (level === 0) {
    const addresses = [...new Set(filteredDevices.map(d => d.address))].sort();

    if (addresses.length === 0) {
      listView.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
    } else {
      listView.innerHTML = addresses.map(addr => {
        const buildings = new Set(filteredDevices.filter(d => d.address === addr).map(d => d.building)).size;
        return createListItem(addr, buildings, '<i class="fas fa-map-marker-alt"></i>', '楼宇');
      }).join('');
    }

    tableView.style.display = 'none';
    cardView.style.display = 'none';
    listView.style.display = 'grid';
    listView.className = 'list-view list-view-address';
    btnBack.style.display = 'none';

  } else if (level === 1) {
    const buildings = [...new Set(filteredDevices.map(d => d.building))].sort();

    if (buildings.length === 0) {
      listView.innerHTML = '<div class="empty-state"><p>该地址下暂无楼宇数据</p></div>';
      listView.className = 'list-view';
    } else {
      listView.innerHTML = buildings.map(b => {
        const rooms = new Set(filteredDevices.filter(d => d.building === b).map(d => d.roomNumber)).size;
        return createListItem(b, rooms, '<i class="fas fa-building"></i>', '房间');
      }).join('');
      listView.className = buildings.length === 1 ? 'list-view list-view-single' : 'list-view list-view-building';
    }

    tableView.style.display = 'none';
    cardView.style.display = 'none';
    listView.style.display = 'grid';
    btnBack.style.display = 'inline-block';

  } else if (level === 2) {
    const roomNumbers = [...new Set(filteredDevices.map(d => d.roomNumber))].sort();

    if (roomNumbers.length === 0) {
      listView.innerHTML = '<div class="empty-state"><p>该楼宇下暂无房号数据</p></div>';
      listView.className = 'list-view';
    } else {
      listView.innerHTML = roomNumbers.map(r => {
        const deviceCount = filteredDevices.filter(d => d.roomNumber === r).length;
        return createListItem(r, deviceCount, '<i class="fas fa-door-open"></i>', '设备');
      }).join('');
      listView.className = roomNumbers.length === 1 ? 'list-view list-view-single' : 'list-view list-view-room';
    }

    tableView.style.display = 'none';
    cardView.style.display = 'none';
    listView.style.display = 'grid';
    btnBack.style.display = 'inline-block';

  } else if (level === 3) {
    listView.style.display = 'none';
    tableView.style.display = 'none';
    cardView.style.display = 'flex';
    btnBack.style.display = 'inline-block';
    
    renderCardView(filteredDevices);
  }
  
  addListItemListeners();
}

// 创建列表项
function createListItem(title, count, icon, unit = '个') {
  return `
    <div class="list-item" data-value="${escapeHtmlAttr(title)}">
      <div class="list-item-icon">${icon}</div>
      <div class="list-item-title">${escapeHtml(title)}</div>
      <div class="list-item-count">${unit} ${count}</div>
      <button class="list-item-delete" onclick="handleDeleteClick(event, '${escapeHtmlAttr(title)}')">
        <i class="fas fa-trash-alt"></i>
      </button>
      <div class="list-item-arrow">›</div>
    </div>
  `;
}

// 添加列表项点击事件监听器
function addListItemListeners() {
  document.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', (event) => {
      // 如果点击的是删除按钮，不触发列表项点击事件
      if (event.target.closest('.list-item-delete')) {
        return;
      }
      const value = item.getAttribute('data-value');
      handleItemClick(value);
    });
  });
}

// 处理列表项点击事件
function handleItemClick(value) {
  if (currentLevel === 0) {
    navigationHistory.push({ level: 0, filters: { ...currentFilters } });
    renderLevel(1, { ...currentFilters, address: value });
  } else if (currentLevel === 1) {
    navigationHistory.push({ level: 1, filters: { ...currentFilters } });
    renderLevel(2, { ...currentFilters, building: value });
  } else if (currentLevel === 2) {
    navigationHistory.push({ level: 2, filters: { ...currentFilters } });
    renderLevel(3, { ...currentFilters, roomNumber: value });
  }
}

// 处理删除按钮点击事件
function handleDeleteClick(event, value) {
  event.stopPropagation();
  console.log('[删除] handleDeleteClick 被调用');
  console.log('[删除] 值:', value);
  console.log('[删除] 当前层级:', currentLevel);
  console.log('[删除] 当前过滤器:', currentFilters);
  
  const levelNames = ['地址', '楼宇', '房间'];
  const levelName = levelNames[currentLevel];
  
  // 获取当前层级的子项数量和关联设备数量
  let childCount = 0;
  let deviceCount = 0;
  let warningMessage = '';
  
  if (currentLevel === 0) {
    // 删除地址
    const buildingsInAddress = [...new Set(devices.filter(d => d.address === value).map(d => d.building))];
    childCount = buildingsInAddress.length;
    
    const devicesInAddress = devices.filter(d => d.address === value);
    deviceCount = devicesInAddress.length;
    
    if (childCount > 0 || deviceCount > 0) {
      warningMessage = `该地址下有 ${childCount} 个楼宇，共 ${deviceCount} 台设备。`;
    }
  } else if (currentLevel === 1) {
    // 删除楼宇
    const roomsInBuilding = [...new Set(devices.filter(d => d.address === currentFilters.address && d.building === value).map(d => d.roomNumber))];
    childCount = roomsInBuilding.length;
    
    const devicesInBuilding = devices.filter(d => d.address === currentFilters.address && d.building === value);
    deviceCount = devicesInBuilding.length;
    
    if (childCount > 0 || deviceCount > 0) {
      warningMessage = `该楼宇下有 ${childCount} 个房间，共 ${deviceCount} 台设备。`;
    }
  } else if (currentLevel === 2) {
    // 删除房间
    const devicesInRoom = devices.filter(d => 
      d.address === currentFilters.address && 
      d.building === currentFilters.building && 
      d.roomNumber === value
    );
    deviceCount = devicesInRoom.length;
    
    if (deviceCount > 0) {
      warningMessage = `该房间下有 ${deviceCount} 台设备。`;
    }
  }
  
  // 构建确认消息
  let confirmMessage = `确定要删除"${value}"${levelName}吗？`;
  if (warningMessage) {
    confirmMessage += `\n\n${warningMessage}\n删除后将同时删除所有关联的数据！`;
  }
  
  // 严格验证：如果有子项或设备，需要二次确认
  if (childCount > 0 || deviceCount > 0) {
    console.log('[删除] 需要二次确认');
    // 使用单个弹窗显示完整的警告信息，不再嵌套弹窗
    const fullMessage = `警告！此操作将永久删除 "${value}"${levelName} 及其所有关联数据。\n\n${warningMessage}\n\n确定要继续删除吗？`;
    showConfirmModal(fullMessage, async () => {
      console.log('[删除] 确认通过，调用 performDelete');
      await performDelete(value);
    }, '确认删除');
  } else {
    console.log('[删除] 直接确认');
    showConfirmModal(confirmMessage, async () => {
      console.log('[删除] 确认通过，调用 performDelete');
      await performDelete(value);
    });
  }
}

// 执行删除操作
async function performDelete(value) {
  try {
    console.log('[删除] 开始执行删除操作');
    console.log('[删除] 当前层级:', currentLevel);
    console.log('[删除] 当前过滤器:', currentFilters);
    console.log('[删除] 要删除的值:', value);
    
    let deletedCount = 0;
    
    if (currentLevel === 0) {
      // 删除地址：删除所有该地址下的设备
      const devicesToDelete = devices.filter(d => d.address === value);
      console.log('[删除] 找到要删除的设备数量:', devicesToDelete.length);
      for (const device of devicesToDelete) {
        await fetch(`${API_URL}/devices/${device.id}`, { method: 'DELETE' });
        deletedCount++;
      }
    } else if (currentLevel === 1) {
      // 删除楼宇：删除所有该楼宇下的设备
      const devicesToDelete = devices.filter(d => 
        d.address === currentFilters.address && 
        d.building === value
      );
      console.log('[删除] 找到要删除的设备数量:', devicesToDelete.length);
      for (const device of devicesToDelete) {
        await fetch(`${API_URL}/devices/${device.id}`, { method: 'DELETE' });
        deletedCount++;
      }
    } else if (currentLevel === 2) {
      // 删除房间：删除所有该房间下的设备
      const devicesToDelete = devices.filter(d => 
        d.address === currentFilters.address && 
        d.building === currentFilters.building && 
        d.roomNumber === value
      );
      console.log('[删除] 找到要删除的设备数量:', devicesToDelete.length);
      for (const device of devicesToDelete) {
        await fetch(`${API_URL}/devices/${device.id}`, { method: 'DELETE' });
        deletedCount++;
      }
    }
    
    console.log('[删除] 已删除设备数量:', deletedCount);
    
    await loadDevices();
    console.log('[删除] 设备列表已重新加载');
    
    // 返回上一级并重新渲染
    console.log('[删除] 导航历史长度:', navigationHistory.length);
    if (navigationHistory.length > 0) {
      const prev = navigationHistory.pop();
      console.log('[删除] 返回上一级:', prev);
      renderLevel(prev.level, prev.filters);
    } else {
      renderLevel(0, {});
    }
    
    showMessage(`删除成功！共删除 ${deletedCount} 台设备`, 'success');
    console.log('[删除] 操作完成');
  } catch (error) {
    console.error('[删除] 失败:', error);
    showMessage('删除失败：' + error.message, 'error');
  }
}

// 返回上一级
function goBack() {
  if (navigationHistory.length > 0) {
    const prev = navigationHistory.pop();
    renderLevel(prev.level, prev.filters);
  }
}

// 更新面包屑导航
function updateBreadcrumb() {
  const breadcrumb = document.getElementById('breadcrumb');
  let html = '<span class="breadcrumb-item" data-level="0"><i class="fas fa-home"></i> 首页</span>';
  
  if (currentFilters.address) {
    html += `<span class="breadcrumb-item" data-level="1"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(currentFilters.address)}</span>`;
  }
  if (currentFilters.building) {
    html += `<span class="breadcrumb-item" data-level="2"><i class="fas fa-building"></i> ${escapeHtml(currentFilters.building)}</span>`;
  }
  if (currentFilters.roomNumber) {
    html += `<span class="breadcrumb-item active" data-level="3"><i class="fas fa-door-open"></i> ${escapeHtml(currentFilters.roomNumber)}</span>`;
  }
  
  breadcrumb.innerHTML = html;
  
  document.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      const level = parseInt(item.getAttribute('data-level'));
      jumpToLevel(level);
    });
  });
}

// 跳转到指定层级
function jumpToLevel(level) {
  navigationHistory = [];
  
  if (level === 0) {
    renderLevel(0, {});
  } else if (level === 1) {
    renderLevel(1, { address: currentFilters.address });
  } else if (level === 2) {
    renderLevel(2, { address: currentFilters.address, building: currentFilters.building });
  } else if (level === 3) {
    renderLevel(3, currentFilters);
  }
}

// 渲染设备表格
function renderTable(filteredDevices = null) {
  const tbody = document.getElementById('deviceTableBody');
  const data = filteredDevices || devices;
  
  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <p>暂无设备数据</p>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = data.map(device => `
      <tr>
        <td>${escapeHtml(device.seatRow || '')}</td>
        <td>${escapeHtml(device.seatColumn || '')}</td>
        <td>${escapeHtml(device.deviceType || '')}</td>
        <td>${escapeHtml(device.deviceName || '')}</td>
        <td>${escapeHtml(device.deviceConfig || '')}</td>
        <td>${escapeHtml(device.remark || '')}</td>
        <td>${formatUpdateTime(device.updateTime)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-warning" onclick="editDevice('${device.id}')">编辑</button>
            <button class="btn btn-danger" onclick="deleteDevice('${device.id}')">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

// 渲染座位视图
function renderCardView(devices) {
  const cardView = document.getElementById('cardView');
  
  if (!devices || devices.length === 0) {
    cardView.innerHTML = '<div class="empty-state"><p>暂无设备数据</p></div>';
    cardView.style.display = 'flex';
    return;
  }
  
  const publicDevices = devices.filter(d => !d.seatRow || (parseInt(d.seatRow) === 0 && (!d.seatColumn || parseInt(d.seatColumn) === 0)));
  const seatDevices = devices.filter(d => d.seatRow && parseInt(d.seatRow) > 0);
  
  if (publicDevices.length > 0 && seatDevices.length === 0) {
    let html = `
      <div class="seat-info-bar">
        <strong>公共区域</strong>，设备 <strong>${publicDevices.length} 台</strong>
        ${!isMobile() ? '<span class="drag-hint"><i class="fas fa-info-circle"></i> 提示：可拖拽设备到其他座位</span>' : ''}
      </div>
      <div class="seat-row">
        <div class="row-label wide">公共区域</div>
        <div class="seat-card has-device wide">
          <div class="seat-card-header">
            <span class="seat-card-title">公共设备</span>
            <span class="seat-card-icon"><i class="fas fa-users"></i></span>
          </div>
          <div class="seat-card-body">
    `;
    
    html += publicDevices.map(device => `
      <div class="device-item" draggable="${!isMobile()}" data-device-id="${device.id}" data-seat-row="0" data-seat-col="0" onclick="viewDevice('${device.id}')">
        <i class="fas ${getDeviceIcon(device.deviceType)} device-icon"></i>
        <div class="device-info">
          <div class="device-name">${escapeHtml(device.deviceName)}</div>
          <div class="device-type">${escapeHtml(device.deviceType)}${device.deviceConfig ? ' | ' + escapeHtml(device.deviceConfig) : ''}</div>
          <div class="device-time">更新：${formatUpdateTime(device.updateTime)}</div>
        </div>
        ${!isMobile() ? '<i class="fas fa-grip-vertical drag-handle"></i>' : ''}
        ${isMobile() ? '<i class="fas fa-ellipsis-v device-menu-btn" onclick="event.stopPropagation(); showDeviceContextMenu(event.clientX, event.clientY, \'' + device.id + '\');"></i>' : ''}
      </div>
    `).join('');
    
    html += `
          </div>
          <div class="seat-card-footer">
            <button class="btn btn-success btn-sm btn-block" onclick="addDeviceToPublic()">➕ 添加设备</button>
          </div>
        </div>
      </div>
    `;
    
    cardView.innerHTML = html;
    cardView.style.display = 'flex';
    return;
  }
  
  const rows = seatDevices.map(d => parseInt(d.seatRow) || 0).filter(r => r > 0);
  const cols = seatDevices.map(d => {
    const col = parseInt(d.seatColumn) || 0;
    return col > 0 ? col : 1;
  });
  
  const maxRow = rows.length > 0 ? Math.max(...rows) : 1;
  const maxCol = cols.length > 0 ? Math.max(...cols) : 1;
  
  const totalRows = Math.max(maxRow, 1);
  const totalCols = Math.max(maxCol, 1);
  const totalSeats = totalRows * totalCols;
  const emptySeats = totalSeats - new Set(seatDevices.map(d => `${d.seatRow}-${d.seatColumn || 1}`)).size;
  
  let html = `
    <div class="seat-info-bar">
      当前区域：<strong>${totalRows} 行</strong> × <strong>${totalCols} 列</strong> = 
      <strong>${totalSeats} 个座位</strong>，
      已使用 <strong>${new Set(seatDevices.map(d => `${d.seatRow}-${d.seatColumn || 1}`)).size} 个</strong>，
      空闲 <strong>${emptySeats} 个</strong>，
      设备 <strong>${seatDevices.length} 台</strong>
      ${publicDevices.length > 0 ? `，公共区域 <strong>${publicDevices.length} 台</strong>` : ''}
      ${!isMobile() ? '<span class="drag-hint"><i class="fas fa-info-circle"></i> 提示：可拖拽设备到其他座位</span>' : ''}
    </div>`;
  
  // 座位预览和公共区域卡片放到同一行
  html += `
    <div class="seat-row">
     
      <div class="seat-preview-row">
        <div class="seat-preview-header" ><i class="fas fa-th"></i> 座位布局预览</div>
        <div class="seat-preview-grid-mini" style="grid-template-columns: 42px repeat(${totalCols}, 42px);">
          <div class="seat-preview-cell-mini public-cell-mini${publicDevices.length > 0 ? ' has-device-mini' : ''}" onclick="scrollToPublicArea()">公共<br/>区域</div>
  `;
  
  // 列标签
  for (let c = 1; c <= totalCols; c++) {
    html += `<div class="seat-preview-cell-mini col-label-mini">${c}列</div>`;
  }
  
  // 行和座位（从下到上）
  for (let r = totalRows; r >= 1; r--) {
    html += `<div class="seat-preview-cell-mini row-label-mini">${r}行</div>`;
    for (let c = 1; c <= totalCols; c++) {
      const hasDevice = seatDevices.some(d => parseInt(d.seatRow) === r && (parseInt(d.seatColumn) || 1) === c);
      const cellClass = hasDevice ? 'seat-preview-cell-mini clickable-mini has-device-mini' : 'seat-preview-cell-mini clickable-mini';
      html += `<div class="${cellClass}" onclick="scrollToSeat(${r}, ${c})">(${r},${c})</div>`;
    }
  }
  
  html += `
        </div>
      </div>
  `;
  
  // 只有有公共设备时才显示公共区域卡片
  if (publicDevices.length > 0) {
    html += `
      <div class="row-label wide">公共区域</div>
      <div id="seat-public" class="seat-card has-device" style="flex: 1; min-width: 200px;">
        <div class="seat-card-header">
          <span class="seat-card-title">公共设备</span>
          <span class="seat-card-icon"><i class="fas fa-users"></i></span>
        </div>
        <div class="seat-card-body">
    `;
    
    html += publicDevices.map(device => `
      <div class="device-item" draggable="${!isMobile()}" data-device-id="${device.id}" data-seat-row="0" data-seat-col="0" onclick="viewDevice('${device.id}')">
        <i class="fas ${getDeviceIcon(device.deviceType)} device-icon"></i>
        <div class="device-info">
          <div class="device-name">${escapeHtml(device.deviceName)}</div>
          <div class="device-type">${escapeHtml(device.deviceType)}${device.deviceConfig ? ' | ' + escapeHtml(device.deviceConfig) : ''}</div>
          <div class="device-time">更新：${formatUpdateTime(device.updateTime)}</div>
        </div>
        ${!isMobile() ? '<i class="fas fa-grip-vertical drag-handle"></i>' : ''}
        ${isMobile() ? '<i class="fas fa-ellipsis-v device-menu-btn" onclick="event.stopPropagation(); showDeviceContextMenu(event.clientX, event.clientY, \'' + device.id + '\');"></i>' : ''}
      </div>
    `).join('');
    
    html += `
        </div>
        <div class="seat-card-footer">
          <button class="btn btn-success btn-sm btn-block" onclick="addDeviceToPublic()">➕ 添加设备</button>
        </div>
      </div>
    `;
  }
  
  html += `</div>`;
  
  for (let row = totalRows; row >= 1; row--) {
    html += `<div class="seat-row">`;
    html += `<div class="row-label">${row}行</div>`;
    
    for (let col = 1; col <= totalCols; col++) {
      const currentSeatDevices = seatDevices.filter(d => parseInt(d.seatRow) === row && (parseInt(d.seatColumn) || 1) === col);
      
      if (currentSeatDevices.length > 0) {
        html += `
          <div id="seat-${row}-${col}" class="seat-card has-device">
            <div class="seat-card-header">
              <span class="seat-card-title">${row}行${col}列</span>
              <span class="seat-card-icon"><i class="fas fa-desktop"></i></span>
            </div>
            <div class="seat-card-body">
              ${currentSeatDevices.map(device => `
                <div class="device-item" draggable="${!isMobile()}" data-device-id="${device.id}" data-seat-row="${device.seatRow}" data-seat-col="${device.seatColumn || 1}" onclick="viewDevice('${device.id}')">
                  <i class="fas ${getDeviceIcon(device.deviceType)} device-icon small"></i>
                  <div class="device-info">
                    <div class="device-name small">${escapeHtml(device.deviceName)}</div>
                    <div class="device-type small">${escapeHtml(device.deviceType)}${device.deviceConfig ? ' | ' + escapeHtml(device.deviceConfig) : ''}</div>
                    <div class="device-time small">更新：${formatUpdateTime(device.updateTime)}</div>
                  </div>
                  ${!isMobile() ? '<i class="fas fa-grip-vertical drag-handle"></i>' : ''}
                  ${isMobile() ? '<i class="fas fa-ellipsis-v device-menu-btn" onclick="event.stopPropagation(); showDeviceContextMenu(event.clientX, event.clientY, \'' + device.id + '\');"></i>' : ''}
                </div>
              `).join('')}
            </div>
            <div class="seat-card-footer">
              <button class="btn btn-success btn-sm btn-block" onclick="addDeviceToSeat(${row}, ${col})">➕ 添加设备</button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div id="seat-${row}-${col}" class="seat-card empty" onclick="addDeviceToSeat(${row}, ${col})">
            <div class="seat-card-header">
              <span class="seat-card-title">${row}行${col}列</span>
              <span class="seat-card-icon"><i class="fas fa-plus"></i></span>
            </div>
            <div class="seat-card-body">
              <div class="seat-card-empty-text">空座位</div>
            </div>
          </div>
        `;
      }
    }
    
    html += `</div>`;
  }
  
  cardView.innerHTML = html;
  cardView.style.display = 'flex';

  // 初始化设备拖拽事件
  setupDeviceDragAndDrop();
}

// 拖拽相关变量
let draggedDevice = null;
let dragOverSeat = null;

// 初始化设备拖拽事件
function setupDeviceDragAndDrop() {
  const cardView = document.getElementById('cardView');
  if (!cardView) return;
  
  // 移除之前的事件监听器（防止重复绑定）
  cardView.removeEventListener('dragstart', handleDeviceDragStart);
  cardView.removeEventListener('dragover', handleDeviceDragOver);
  cardView.removeEventListener('drop', handleDeviceDrop);
  cardView.removeEventListener('dragend', handleDeviceDragEnd);
  
  // 添加拖拽事件监听（仅桌面端）
  cardView.addEventListener('dragstart', handleDeviceDragStart);
  cardView.addEventListener('dragover', handleDeviceDragOver);
  cardView.addEventListener('drop', handleDeviceDrop);
  cardView.addEventListener('dragend', handleDeviceDragEnd);
}

// 设备拖拽开始
function handleDeviceDragStart(e) {
  const deviceItem = e.target.closest('.device-item');
  if (!deviceItem) return;
  
  draggedDevice = {
    id: deviceItem.dataset.deviceId,
    seatRow: parseInt(deviceItem.dataset.seatRow),
    seatCol: parseInt(deviceItem.dataset.seatCol)
  };
  
  e.dataTransfer.effectAllowed = 'move';
  deviceItem.classList.add('dragging');
  
  // 创建拖拽预览效果
  e.dataTransfer.setData('text/plain', deviceItem.dataset.deviceId);
  
  // 添加拖拽时的视觉效果
  setTimeout(() => {
    deviceItem.style.opacity = '0.5';
  }, 0);
}

// 设备拖拽经过
function handleDeviceDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const seatCard = e.target.closest('.seat-card');
  if (!seatCard) return;
  
  // 移除之前的高亮效果
  if (dragOverSeat) {
    dragOverSeat.classList.remove('drag-over');
  }
  
  // 设置新的高亮效果
  dragOverSeat = seatCard;
  seatCard.classList.add('drag-over');
}

// 设备拖拽放下
function handleDeviceDrop(e) {
  e.preventDefault();
  
  if (!draggedDevice) return;
  
  const seatCard = e.target.closest('.seat-card');
  if (!seatCard) {
    handleDeviceDragEnd();
    return;
  }
  
  // 获取目标座位信息
  const seatId = seatCard.id;
  let targetRow, targetCol;
  
  if (seatId === 'seat-public') {
    targetRow = 0;
    targetCol = 0;
  } else {
    const match = seatId.match(/seat-(\d+)-(\d+)/);
    if (!match) {
      handleDeviceDragEnd();
      return;
    }
    targetRow = parseInt(match[1]);
    targetCol = parseInt(match[2]);
  }
  
  // 如果目标位置和原位置相同，不执行操作
  if (draggedDevice.seatRow === targetRow && draggedDevice.seatCol === targetCol) {
    handleDeviceDragEnd();
    return;
  }
  
  // 移动设备到新座位
  moveDeviceToSeat(draggedDevice.id, targetRow, targetCol);
  
  handleDeviceDragEnd();
}

// 设备拖拽结束
function handleDeviceDragEnd() {
  // 恢复拖拽元素的样式
  document.querySelectorAll('.device-item.dragging').forEach(item => {
    item.classList.remove('dragging');
    item.style.opacity = '1';
  });
  
  // 移除高亮效果
  if (dragOverSeat) {
    dragOverSeat.classList.remove('drag-over');
  }
  
  draggedDevice = null;
  dragOverSeat = null;
  touchDragStartPos = null;
  touchDragging = false;
}

// 移动设备到指定座位
async function moveDeviceToSeat(deviceId, targetRow, targetCol) {
  try {
    const device = devices.find(d => d.id === deviceId);
    if (!device) {
      showMessage('未找到设备', 'error');
      return;
    }
    
    const response = await fetch(`${API_URL}/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seatRow: targetRow,
        seatColumn: targetCol,
        updateTime: new Date().toISOString()
      })
    });
    
    if (!response.ok) throw new Error('移动失败');
    
    await loadDevices();
    renderLevel(currentLevel, currentFilters);
    
    const targetSeatName = targetRow === 0 ? '公共区域' : `${targetRow}行${targetCol}列`;
    showMessage(`设备 "${device.deviceName}" 已移动到 ${targetSeatName}`, 'success');
  } catch (error) {
    showMessage('移动设备失败：' + error.message, 'error');
  }
}

// 查看设备详情
function viewDevice(id) {
  const device = devices.find(d => d.id === id);
  if (!device) return;
  
  const content = `
    <div class="device-detail-content">
      <div class="detail-section">
        <div class="detail-section-title"><i class="fas fa-map-marker-alt"></i> 位置信息</div>
        
        <div class="detail-row">
          <div class="detail-item">
            <div class="detail-label">地址</div>
            <div class="detail-value">${escapeHtml(device.address || '-')}</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">楼宇</div>
            <div class="detail-value">${escapeHtml(device.building || '-')}</div>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-item">
            <div class="detail-label">房号</div>
            <div class="detail-value">${escapeHtml(device.roomNumber || '-')}</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">座位</div>
            <div class="detail-value">${escapeHtml(device.seatRow || '-')}行 ${escapeHtml(device.seatColumn || '-')}列</div>
          </div>
        </div>
      </div>
      
      <div class="detail-section">
        <div class="detail-section-title"><i class="fas fa-desktop"></i> 设备信息</div>
        
        <div class="detail-row">
          <div class="detail-item">
            <div class="detail-label">设备类型</div>
            <div class="detail-value">${escapeHtml(device.deviceType || '-')}</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">设备名称</div>
            <div class="detail-value">${escapeHtml(device.deviceName || '-')}</div>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-item full-width">
            <div class="detail-label">设备配置</div>
            <div class="detail-value">${escapeHtml(device.deviceConfig || '-')}</div>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-item full-width">
            <div class="detail-label">更新时间</div>
            <div class="detail-value">${formatUpdateTime(device.updateTime)}</div>
          </div>
        </div>
      </div>
      
      ${device.remark ? `
        <div class="detail-section">
          <div class="detail-section-title"><i class="fas fa-file-text"></i> 备注信息</div>
          <div class="detail-row">
            <div class="detail-item full-width">
              <div class="detail-label">备注</div>
              <div class="detail-value detail-remark">${escapeHtml(device.remark)}</div>
            </div>
          </div>
        </div>
      ` : ''}
      
      ${device.images && device.images.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section-title"><i class="fas fa-images"></i> 设备图片</div>
          <div class="detail-row">
            <div class="detail-item full-width">
              <div class="detail-images">
                ${device.images.map(img => `
                  <img src="${img}" alt="设备图片" class="detail-image" onclick="previewImage('${img}')">
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
  
  showDeviceDetailModal('设备详情', content, device.id);
}

// 显示设备详情弹窗
function showDeviceDetailModal(title, content, deviceId) {
  const modal = document.createElement('div');
  modal.id = 'deviceDetailModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content modal-sm">
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <span class="close detail-close">&times;</span>
      </div>
      <div class="modal-body">
        ${content}
      </div>
      <div class="modal-footer">
        <button class="btn btn-warning btn-sm" onclick="editDeviceFromDetail('${deviceId}')">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDeviceFromDetail('${deviceId}')">删除</button>
        <button class="btn" onclick="closeDeviceDetail()">关闭</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.detail-close').addEventListener('click', closeDeviceDetail);
  modal.querySelector('.btn:last-child').addEventListener('click', closeDeviceDetail);
  
  modal.classList.add('show');
}

// 关闭设备详情弹窗
function closeDeviceDetail() {
  const modal = document.getElementById('deviceDetailModal');
  if (modal) {
    modal.remove();
  }
}

// 图片预览
function previewImage(src) {
  const previewModal = document.createElement('div');
  previewModal.className = 'image-preview-modal';
  previewModal.onclick = () => previewModal.remove();
  previewModal.innerHTML = `
    <span class="close-preview">&times;</span>
    <img src="${src}" alt="预览">
  `;
  previewModal.querySelector('.close-preview').onclick = (e) => {
    e.stopPropagation();
    previewModal.remove();
  };
  document.body.appendChild(previewModal);
}

// 编辑设备
function editDeviceFromDetail(id) {
  closeDeviceDetail();
  setTimeout(() => editDevice(id), 200);
}

// 删除设备
function deleteDeviceFromDetail(id) {
  closeDeviceDetail();
  setTimeout(() => deleteDevice(id), 200);
}

// 添加座位到设备
async function addDeviceToSeat(row, col) {
  await showAddModal();
  document.getElementById('address').value = currentFilters.address || '';
  document.getElementById('building').value = currentFilters.building || '';
  document.getElementById('roomNumber').value = currentFilters.roomNumber || '';
  document.getElementById('seatRow').value = row.toString();
  document.getElementById('seatColumn').value = col.toString();
  
  // 重新渲染预览网格，确保能显示选中的座位
  const displayRows = Math.max(row, 3);
  const displayCols = Math.max(col, 2);
  renderSeatPreview(displayRows, displayCols);
}

// 滚动到指定座位
function scrollToSeat(row, col) {
  const seatCardId = `seat-${row}-${col}`;
  const seatCard = document.getElementById(seatCardId);
  
  if (seatCard) {
    // 添加高亮效果
    seatCard.classList.add('seat-card-highlight');
    
    // 滚动到座位卡片位置
    seatCard.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });
    
    // 3秒后移除高亮效果
    setTimeout(() => {
      seatCard.classList.remove('seat-card-highlight');
    }, 3000);
  } else {
    showMessage(`未找到座位 ${row}行${col}列`, 'warning');
  }
}

// 滚动到公共区域
function scrollToPublicArea() {
  const publicCard = document.getElementById('seat-public');
  
  if (publicCard) {
    // 添加高亮效果
    publicCard.classList.add('seat-card-highlight');
    
    // 滚动到公共区域卡片位置
    publicCard.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });
    
    // 3秒后移除高亮效果
    setTimeout(() => {
      publicCard.classList.remove('seat-card-highlight');
    }, 3000);
  } else {
    // 提示用户当前没有公共设备
    showMessage('当前区域暂无公共设备', 'warning');
  }
}

// 添加公共设备
function addDeviceToPublic() {
  showAddModal();
  document.getElementById('address').value = currentFilters.address || '';
  document.getElementById('building').value = currentFilters.building || '';
  document.getElementById('roomNumber').value = currentFilters.roomNumber || '';
  document.getElementById('seatRow').value = '0';
  document.getElementById('seatColumn').value = '0';
}

// 显示添加设备弹窗
async function showAddModal() {
  editingId = null;
  document.getElementById('modalTitleText').textContent = '添加设备';
  document.getElementById('modalTitle').querySelector('.modal-icon').innerHTML = '<i class="fas fa-file-edit"></i>';
  document.getElementById('deviceForm').reset();
  document.getElementById('deviceId').value = '';
  
  // 清除图片预览
  document.getElementById('imagePreview').innerHTML = '';
  selectedImages = [];
  
  // 根据当前面包屑导航层级自动填入地址、楼宇、房号
  if (currentLevel >= 1 && currentFilters.address) {
    document.getElementById('address').value = currentFilters.address;
  }
  if (currentLevel >= 2 && currentFilters.building) {
    document.getElementById('building').value = currentFilters.building;
  }
  if (currentLevel >= 3 && currentFilters.roomNumber) {
    document.getElementById('roomNumber').value = currentFilters.roomNumber;
  }
  
  // 动态加载设备类型选项
  await loadDeviceTypeOptions();
  
  // 初始化座位预览（根据当前房间的座位数，如果不在房间则使用3×3）
  let totalRows = 3;
  let totalCols = 3;
  
  if (currentFilters.roomNumber) {
    // 当前在房间级别，使用当前房间的设备计算座位数
    const roomDevices = devices.filter(d => d.roomNumber === currentFilters.roomNumber);
    const maxRows = roomDevices.map(d => parseInt(d.seatRow) || 0).filter(r => r > 0);
    const maxCols = roomDevices.map(d => {
      const col = parseInt(d.seatColumn) || 0;
      return col > 0 ? col : 1;
    });
    
    totalRows = maxRows.length > 0 ? Math.max(...maxRows) : 3;
    totalCols = maxCols.length > 0 ? Math.max(...maxCols) : 3;
  }
  
  renderSeatPreview(totalRows, totalCols);
  
  // 默认选中第一个座位(1,1)
  document.getElementById('seatRow').value = 1;
  document.getElementById('seatColumn').value = 1;
  updateSeatPreviewSelection(1, 1);
  
  document.getElementById('modal').classList.add('show');
}

async function editDevice(id) {
  editingId = id;
  const device = devices.find(d => d.id === id);
  if (!device) return;
  
  document.getElementById('modalTitleText').textContent = '编辑设备';
  document.getElementById('modalTitle').querySelector('.modal-icon').innerHTML = '<i class="fas fa-edit"></i>';
  document.getElementById('deviceId').value = device.id;
  document.getElementById('address').value = device.address || '';
  document.getElementById('building').value = device.building || '';
  document.getElementById('roomNumber').value = device.roomNumber || '';
  document.getElementById('seatRow').value = device.seatRow || '';
  document.getElementById('seatColumn').value = device.seatColumn || '';
  document.getElementById('deviceType').value = device.deviceType || '';
  document.getElementById('deviceName').value = device.deviceName || '';
  document.getElementById('deviceConfig').value = device.deviceConfig || '';
  document.getElementById('remark').value = device.remark || '';
  
  // 加载现有图片到预览
  selectedImages = [];
  const preview = document.getElementById('imagePreview');
  preview.innerHTML = '';
  
  if (device.images && device.images.length > 0) {
    device.images.forEach((imagePath, index) => {
      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item';
      previewItem.dataset.index = index;
      previewItem.dataset.existing = 'true';
      previewItem.dataset.imagePath = imagePath;
      
      previewItem.innerHTML = `
        <img src="${imagePath}" alt="设备图片" onclick="previewImage('${imagePath}')" class="clickable-image">
        <button type="button" class="remove-btn" onclick="removeExistingImage('${imagePath}')">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      preview.appendChild(previewItem);
      selectedImages.push({ path: imagePath, isExisting: true });
    });
  }
  
  // 动态加载设备类型选项
  await loadDeviceTypeOptions();
  
  // 初始化座位预览（根据当前房间的座位数，如果不在房间则使用3×3）
  let totalRows = 3;
  let totalCols = 3;
  
  // 优先使用当前筛选的房间
  let targetRoomNumber = currentFilters.roomNumber;
  
  // 如果不在房间级别，使用设备所在的房间
  if (!targetRoomNumber && device.roomNumber) {
    targetRoomNumber = device.roomNumber;
  }
  
  if (targetRoomNumber) {
    // 使用目标房间的设备计算座位数
    const roomDevices = devices.filter(d => d.roomNumber === targetRoomNumber);
    const maxRows = roomDevices.map(d => parseInt(d.seatRow) || 0).filter(r => r > 0);
    const maxCols = roomDevices.map(d => {
      const col = parseInt(d.seatColumn) || 0;
      return col > 0 ? col : 1;
    });
    
    totalRows = maxRows.length > 0 ? Math.max(...maxRows) : 3;
    totalCols = maxCols.length > 0 ? Math.max(...maxCols) : 3;
  }
  
  renderSeatPreview(totalRows, totalCols);
  
  document.getElementById('modal').classList.add('show');
}

async function loadDeviceTypeOptions() {
  const deviceTypes = await getDeviceTypes();
  const select = document.getElementById('deviceType');
  
  if (!select) return;
  
  // 保存当前选中的值
  const currentValue = select.value;
  
  // 清空选项（保留第一个"请选择类型"）
  select.innerHTML = '<option value="">请选择类型</option>';
  
  // 添加设备类型选项
  deviceTypes.forEach(item => {
    const option = document.createElement('option');
    option.value = item.type;
    option.textContent = item.type;
    option.setAttribute('data-icon', item.icon);
    select.appendChild(option);
  });
  
  // 恢复选中的值
  if (currentValue) {
    select.value = currentValue;
  }
}

// 渲染座位预览方格
function renderSeatPreview(rows, cols) {
  const preview = document.getElementById('seatPreview');
  const grid = document.getElementById('seatPreviewGrid');
  
  if (!rows || !cols || rows <= 0 || cols <= 0) {
    preview.style.display = 'none';
    return;
  }
  
  preview.style.display = 'block';
  grid.style.gridTemplateColumns = `50px repeat(${cols}, 50px)`;
  grid.style.gridTemplateRows = `40px repeat(${rows}, 40px)`;
  
  // 清空之前的内容
  grid.innerHTML = '';
  let html = '';
  
  // 左上角公共区域按钮
  html += `
    <div class="seat-preview-cell public-cell" onclick="selectPublicArea()">
      公共<br/>区域
    </div>
  `;
  
  // 列标签（从左到右）
  for (let c = 1; c <= cols; c++) {
    html += `<div class="seat-preview-cell col-label">${c}列</div>`;
  }
  
  // 获取当前选中的座位
  const currentSeatRow = parseInt(document.getElementById('seatRow').value) || 0;
  const currentSeatCol = parseInt(document.getElementById('seatColumn').value) || 0;
  const isPublicSelected = currentSeatRow === 0 && currentSeatCol === 0;
  
  // 行和座位（从下到上）
  for (let r = rows; r >= 1; r--) {
    html += `<div class="seat-preview-cell row-label">${r}行</div>`;
    for (let c = 1; c <= cols; c++) {
      const isSelected = r === currentSeatRow && c === currentSeatCol;
      const selectedClass = isSelected ? ' selected' : '';
      html += `<div class="seat-preview-cell clickable${selectedClass}" onclick="selectSeatCell(${r}, ${c})">(${r},${c})</div>`;
    }
  }
  
  grid.innerHTML = html;
  
  // 设置当前选中的值（使用传入的行列数）
  document.getElementById('seatLayout').value = `${rows}x${cols}`;
  
  // 设置公共区域选中状态
  if (isPublicSelected) {
    const publicCell = grid.querySelector('.seat-preview-cell.public-cell');
    if (publicCell) {
      publicCell.classList.add('selected');
    }
  }
}

// 选择公共区域
function selectPublicArea() {
  document.getElementById('seatRow').value = '';
  document.getElementById('seatColumn').value = '';
  
  // 更新预览中的选中状态
  updateSeatPreviewSelection(0, 0);
}

// 选择座位单元格
function selectSeatCell(row, col) {
  document.getElementById('seatRow').value = row;
  document.getElementById('seatColumn').value = col;
  
  // 更新预览中的选中状态
  updateSeatPreviewSelection(row, col);
}

// 更新座位预览的选中状态
function updateSeatPreviewSelection(selectedRow, selectedCol) {
  const grid = document.getElementById('seatPreviewGrid');
  if (!grid) return;
  
  // 移除所有单元格的选中状态
  const cells = grid.querySelectorAll('.seat-preview-cell.clickable, .seat-preview-cell.public-cell');
  cells.forEach(cell => cell.classList.remove('selected'));
  
  // 如果是公共区域(0,0)
  if (selectedRow === 0 && selectedCol === 0) {
    const publicCell = grid.querySelector('.seat-preview-cell.public-cell');
    if (publicCell) {
      publicCell.classList.add('selected');
    }
    return;
  }
  
  // 找到并选中目标单元格
  const seatCells = grid.querySelectorAll('.seat-preview-cell.clickable');
  seatCells.forEach(cell => {
    // 从单元格内容中提取行和列信息
    const content = cell.textContent.trim();
    const match = content.match(/\((\d+),(\d+)\)/);
    if (match) {
      const cellRow = parseInt(match[1]);
      const cellCol = parseInt(match[2]);
      if (cellRow === selectedRow && cellCol === selectedCol) {
        cell.classList.add('selected');
      }
    }
  });
}

// 座位布局变化处理
function onSeatLayoutChange(select) {
  if (select.value) {
    const [row, col] = select.value.split('x');
    renderSeatPreview(parseInt(row), parseInt(col));
  }
}

// 根据输入更新预览
function updateSeatPreviewFromInputs() {
  const rows = parseInt(document.getElementById('seatRow').value) || 0;
  const cols = parseInt(document.getElementById('seatColumn').value) || 0;
  renderSeatPreview(rows, cols);
}

// 隐藏弹窗
// 处理图片上传
function handleImageUpload(e) {
  const files = e.target.files;
  const preview = document.getElementById('imagePreview');
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;
    
    // 添加到已选图片数组
    selectedImages.push(file);
    
    // 创建预览 - 使用立即执行的闭包来捕获正确的索引
    const currentIndex = selectedImages.length - 1;
    const reader = new FileReader();
    reader.onload = (function(index) {
      return function(event) {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        previewItem.dataset.index = index;
        
        previewItem.innerHTML = `
          <img src="${event.target.result}" alt="预览" onclick="previewImage('${event.target.result}')" class="clickable-image">
          <button type="button" class="remove-btn" onclick="removeImage(${index})">
            <i class="fas fa-times"></i>
          </button>
        `;
        
        preview.appendChild(previewItem);
      };
    })(currentIndex);
    reader.readAsDataURL(file);
  }
  
  // 清空input以允许重新选择相同文件
  e.target.value = '';
}

// 移除图片
function removeImage(index) {
  selectedImages.splice(index, 1);
  renderImagePreviews();
}

// 移除已存在的图片（从服务器）
function removeExistingImage(imagePath) {
  const index = selectedImages.findIndex(img => img.path === imagePath && img.isExisting);
  if (index !== -1) {
    selectedImages.splice(index, 1);
  }
  renderImagePreviews();
}

// 重新渲染图片预览
function renderImagePreviews() {
  const preview = document.getElementById('imagePreview');
  preview.innerHTML = '';
  
  selectedImages.forEach((item, index) => {
    // 判断是已存在的图片还是新选择的图片
    if (item.isExisting) {
      // 已存在的图片
      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item';
      previewItem.dataset.index = index;
      previewItem.dataset.existing = 'true';
      previewItem.dataset.imagePath = item.path;
      
      previewItem.innerHTML = `
        <img src="${item.path}" alt="设备图片" onclick="previewImage('${item.path}')" class="clickable-image">
        <button type="button" class="remove-btn" onclick="removeExistingImage('${item.path}')">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      preview.appendChild(previewItem);
    } else {
      // 新选择的图片（File对象）
      const reader = new FileReader();
      reader.onload = (function(idx) {
        return function(event) {
          const previewItem = document.createElement('div');
          previewItem.className = 'preview-item';
          previewItem.dataset.index = idx;
          
          previewItem.innerHTML = `
            <img src="${event.target.result}" alt="预览" onclick="previewImage('${event.target.result}')" class="clickable-image">
            <button type="button" class="remove-btn" onclick="removeImage(${idx})">
              <i class="fas fa-times"></i>
            </button>
          `;
          
          preview.appendChild(previewItem);
        };
      })(index);
      reader.readAsDataURL(item);
    }
  });
}

function hideModal() {
  document.getElementById('modal').classList.remove('show');
  document.getElementById('deviceForm').reset();
  document.getElementById('deviceId').value = '';
  document.getElementById('seatLayout').value = '';
  document.getElementById('seatPreview').style.display = 'none';
  document.getElementById('imagePreview').innerHTML = '';
  selectedImages = [];
  editingId = null;
}

// 防重复提交标志
let isSubmitting = false;

// 处理表单提交
async function handleFormSubmit(e) {
  e.preventDefault();
  
  // 防止重复点击
  if (isSubmitting) return;
  isSubmitting = true;
  
  const btnSaveText = document.getElementById('btnSaveText');
  const originalText = btnSaveText?.textContent || '保存';
  btnSaveText && (btnSaveText.textContent = '保存中...');
  
  // 使用 FormData 发送包含文件的数据
  const formData = new FormData();
  formData.append('address', document.getElementById('address').value.trim());
  formData.append('building', document.getElementById('building').value.trim());
  formData.append('roomNumber', document.getElementById('roomNumber').value.trim());
  formData.append('seatRow', document.getElementById('seatRow').value.trim());
  formData.append('seatColumn', document.getElementById('seatColumn').value.trim());
  formData.append('deviceType', document.getElementById('deviceType').value.trim());
  formData.append('deviceName', document.getElementById('deviceName').value.trim());
  formData.append('deviceConfig', document.getElementById('deviceConfig').value.trim());
  formData.append('remark', document.getElementById('remark').value.trim());
  formData.append('updateTime', new Date().toISOString());
  
  // 添加图片文件
  if (editingId) {
    // 编辑时：获取仍保留的现有图片
    const existingImages = selectedImages
      .filter(img => img.isExisting)
      .map(img => img.path);
    if (existingImages.length > 0) {
      formData.append('existingImages', JSON.stringify(existingImages));
    }
  }
  
  // 添加新选择的图片
  selectedImages.forEach((item) => {
    if (!item.isExisting) {
      formData.append('images', item);
    }
  });
  
  try {
    let response;
    if (editingId) {
      response = await fetch(`${API_URL}/devices/${editingId}`, {
        method: 'PUT',
        body: formData
      });
    } else {
      response = await fetch(`${API_URL}/devices`, {
        method: 'POST',
        body: formData
      });
    }
    
    if (!response.ok) throw new Error('操作失败');
    
    await loadDevices();
    renderLevel(currentLevel, currentFilters);
    hideModal();
    showMessage(editingId ? '设备更新成功' : '设备添加成功', 'success');
  } catch (error) {
    showMessage('操作失败：' + error.message, 'error');
  } finally {
    // 重置防重复提交标志
    isSubmitting = false;
    const btnSaveText = document.getElementById('btnSaveText');
    btnSaveText && (btnSaveText.textContent = originalText);
  }
}

// 显示确认弹窗
function showConfirmModal(message, onConfirm, confirmText = '确认') {
  document.getElementById('confirmMessage').innerHTML = message;
  document.getElementById('btnConfirmOk').textContent = confirmText;
  document.getElementById('confirmModal').classList.add('show');
  deleteConfirmCallback = onConfirm;
}

// 隐藏确认弹窗
function hideConfirmModal() {
  document.getElementById('confirmModal').classList.remove('show');
  deleteConfirmCallback = null;
}

// 系统设置相关函数
function showSettings() {
  // 隐藏其他视图
  document.getElementById('listView').style.display = 'none';
  document.getElementById('tableView').style.display = 'none';
  document.getElementById('cardView').style.display = 'none';
  document.getElementById('profileView').style.display = 'none';
  
  // 显示设置视图
  document.getElementById('settingsView').style.display = 'block';
  
  // 隐藏返回按钮和工具栏
  document.getElementById('btnBack').style.display = 'none';
  document.getElementById('btnBack').closest('.nav-row').style.display = 'none';
  document.getElementById('searchInput').closest('.toolbar').style.display = 'none';
  
  // 更新标签页激活状态
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.remove('active');
    if (tab.getAttribute('data-view') === 'settings') {
      tab.classList.add('active');
    }
  });
  
  // 加载备份列表
  refreshBackupList();
}

// 保存设置
function saveSettings() {
  const themeColor = document.getElementById('themeColor').value;
  const sidebarWidth = document.getElementById('sidebarWidth').value;
  const enableNotification = document.getElementById('enableNotification').checked;
  
  // 保存到 localStorage
  localStorage.setItem('themeColor', themeColor);
  localStorage.setItem('sidebarWidth', sidebarWidth);
  localStorage.setItem('enableNotification', enableNotification);
  
  // 应用设置
  applySettings();
  
  showMessage('设置保存成功', 'success');
}

// 刷新备份列表
async function refreshBackupList() {
  console.log('[备份] 开始刷新备份列表');
  try {
    const backupList = document.getElementById('backupList');
    console.log('[备份] backupList 元素:', backupList);
    
    const response = await fetch(`${API_URL}/backups`);
    console.log('[备份] 请求状态:', response.status);
    
    if (!response.ok) throw new Error('获取备份列表失败');
    
    const backups = await response.json();
    console.log('[备份] 获取到的备份列表:', backups);
    
    if (backups.length === 0) {
      backupList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-folder-open"></i>
          <p>暂无备份文件</p>
        </div>
      `;
      return;
    }
    
    backupList.innerHTML = backups.map(backup => `
      <div class="backup-item">
        <div class="backup-info">
          <i class="fas fa-archive"></i>
          <div>
            <div class="backup-name">${escapeHtml(backup.filename)}</div>
            <div class="backup-time">${backup.createdAt}</div>
          </div>
        </div>
        <div class="backup-size">${backup.size}</div>
        <div class="backup-actions">
          <button class="btn btn-sm btn-success" onclick="showRestoreModal('${backup.filename}')" title="还原">
            <i class="fas fa-upload"></i>
          </button>
          <button class="btn btn-sm btn-primary" onclick="downloadBackup('${backup.filename}')" title="下载">
            <i class="fas fa-download"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteBackup('${backup.filename}')" title="删除">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('[备份] 刷新备份列表失败:', error);
    showMessage('获取备份列表失败：' + error.message, 'error');
  }
}

// 创建手动备份
async function createBackup() {
  try {
    const btn = document.getElementById('btnCreateBackup');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 备份中...';
    btn.disabled = true;
    
    const response = await fetch(`${API_URL}/backups`, { method: 'POST' });
    if (!response.ok) throw new Error('备份失败');
    
    const result = await response.json();
    const attachmentInfo = result.attachmentCount ? `，包含 ${result.attachmentCount} 个附件` : '';
    showMessage(`备份创建成功：${result.filename}${attachmentInfo}`, 'success');
    await refreshBackupList();
  } catch (error) {
    console.error('创建备份失败:', error);
    showMessage('备份失败：' + error.message, 'error');
  } finally {
    const btn = document.getElementById('btnCreateBackup');
    btn.innerHTML = '<i class="fas fa-plus"></i> 立即备份';
    btn.disabled = false;
  }
}

// 下载备份
async function downloadBackup(filename) {
  try {
    const response = await fetch(`${API_URL}/backups/${filename}`);
    if (!response.ok) throw new Error('下载失败');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('下载备份失败:', error);
    showMessage('下载失败：' + error.message, 'error');
  }
}

// 删除备份
async function deleteBackup(filename) {
  try {
    showConfirmModal(`确定要删除备份文件 "${filename}" 吗？`, async () => {
      const response = await fetch(`${API_URL}/backups/${filename}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除失败');
      
      showMessage('备份删除成功', 'success');
      await refreshBackupList();
    });
  } catch (error) {
    console.error('[备份] 删除备份失败:', error);
    showMessage('删除失败：' + error.message, 'error');
  }
}

// 当前要还原的备份文件名
let currentRestoreFilename = null;

// 显示还原模态框
function showRestoreModal(filename) {
  currentRestoreFilename = filename;
  document.getElementById('restoreFilename').querySelector('span').textContent = filename;
  document.getElementById('restoreModal').classList.add('show');
}

// 隐藏还原模态框
function hideRestoreModal() {
  document.getElementById('restoreModal').classList.remove('show');
  currentRestoreFilename = null;
}

// 执行还原操作
async function performRestore() {
  if (!currentRestoreFilename) return;
  
  const mode = document.querySelector('input[name="restoreMode"]:checked').value;
  
  try {
    const btn = document.getElementById('btnRestoreOk');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 还原中...';
    btn.disabled = true;
    
    const response = await fetch(`${API_URL}/backups/${currentRestoreFilename}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode })
    });
    
    if (!response.ok) throw new Error('还原失败');
    
    const result = await response.json();
    hideRestoreModal();
    showMessage(`还原成功！${result.message}`, 'success');
    
    // 重新加载设备列表
    await loadDevices();
    await refreshBackupList();
  } catch (error) {
    console.error('[备份] 还原失败:', error);
    showMessage('还原失败：' + error.message, 'error');
  } finally {
    const btn = document.getElementById('btnRestoreOk');
    btn.innerHTML = '确认还原';
    btn.disabled = false;
  }
}

// 重置设置
function resetSettings() {
  const themeColorEl = document.getElementById('themeColor');
  const sidebarWidthEl = document.getElementById('sidebarWidth');
  const sidebarWidthValueEl = document.getElementById('sidebarWidthValue');
  const enableNotificationEl = document.getElementById('enableNotification');
  
  if (themeColorEl) themeColorEl.value = 'blue';
  if (sidebarWidthEl) sidebarWidthEl.value = '240';
  if (sidebarWidthValueEl) sidebarWidthValueEl.textContent = '240px';
  if (enableNotificationEl) enableNotificationEl.checked = true;
  
  showMessage('设置已重置', 'success');
}

// 应用设置
function applySettings() {
  const themeColor = localStorage.getItem('themeColor') || 'blue';
  const sidebarWidth = localStorage.getItem('sidebarWidth') || '240';
  const enableNotification = localStorage.getItem('enableNotification') !== 'false';
  
  const themeColorEl = document.getElementById('themeColor');
  const sidebarWidthEl = document.getElementById('sidebarWidth');
  const sidebarWidthValueEl = document.getElementById('sidebarWidthValue');
  const enableNotificationEl = document.getElementById('enableNotification');
  
  if (themeColorEl) themeColorEl.value = themeColor;
  if (sidebarWidthEl) sidebarWidthEl.value = sidebarWidth;
  if (sidebarWidthValueEl) sidebarWidthValueEl.textContent = sidebarWidth + 'px';
  if (enableNotificationEl) enableNotificationEl.checked = enableNotification;
  
  // 应用侧边栏宽度
  document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
}

// 备份数据
function backupData() {
  const dataStr = JSON.stringify(devices, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `devices_backup_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showMessage('数据导出成功', 'success');
}

// 导入数据
function restoreData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!Array.isArray(data)) {
        throw new Error('文件格式不正确');
      }
      
      showConfirmModal(`确定要导入 ${data.length} 条设备数据吗？当前数据将被覆盖。`, async () => {
        try {
          await fetch(`${API_URL}/devices/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          await loadDevices();
          showMessage('数据导入成功', 'success');
        } catch (error) {
          showMessage('数据导入失败：' + error.message, 'error');
        }
      });
    } catch (error) {
      showMessage('文件读取失败：' + error.message, 'error');
    }
  };
  input.click();
}

// 清空数据
function clearData() {
  showConfirmModal('确定要清空所有设备数据吗？此操作不可恢复！', async () => {
    try {
      await fetch(`${API_URL}/devices/clear`, { method: 'DELETE' });
      await loadDevices();
      showMessage('数据已清空', 'success');
    } catch (error) {
      showMessage('清空数据失败：' + error.message, 'error');
    }
  });
}

// 设备类型管理
async function getDeviceTypes() {
  if (deviceTypesCache.length > 0) {
    return deviceTypesCache;
  }
  try {
    const response = await fetch(`${API_URL}/device-types`);
    if (!response.ok) throw new Error('获取设备类型失败');
    deviceTypesCache = await response.json();
    return deviceTypesCache;
  } catch (error) {
    console.error('获取设备类型失败:', error);
    return [];
  }
}

// 获取设备图标
function getDeviceIcon(type) {
  if (deviceTypesCache.length > 0) {
    const found = deviceTypesCache.find(t => t.type === type);
    if (found) return found.icon;
  }
  return DEFAULT_ICON_MAP[type] || 'fa-desktop';
}

async function loadDeviceTypes() {
  await renderDeviceTypeList();
}

async function saveDeviceTypes(types) {
  try {
    const response = await fetch(`${API_URL}/device-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(types)
    });
    if (!response.ok) throw new Error('保存设备类型失败');
    deviceTypesCache = types;
    return true;
  } catch (error) {
    console.error('保存设备类型失败:', error);
    return false;
  }
}

async function renderDeviceTypeList() {
  const deviceTypes = await getDeviceTypes();
  const list = document.getElementById('deviceTypeList');
  
  if (!list) return;
  
  list.innerHTML = deviceTypes.map((item, index) => {
    return `
      <div class="device-type-tag tag-removable" draggable="true" data-index="${index}">
        <i class="fas fa-grip-vertical drag-handle"></i>
        <i class="fas ${item.icon} tag-icon"></i>
        <span>${item.type}</span>
        <i class="fas fa-times tag-remove" onclick="removeDeviceType(${index})"></i>
      </div>
    `;
  }).join('');
  
  // 添加拖拽事件监听
  setupTypeDragAndDrop();
}

// 设备类型拖拽
function setupTypeDragAndDrop() {
  const list = document.getElementById('deviceTypeList');
  if (!list) return;

  let draggedItem = null;
  let originalOrder = [];

  list.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('device-type-tag')) {
      draggedItem = e.target;
      e.target.classList.add('dragging');
      originalOrder = Array.from(list.querySelectorAll('.device-type-tag')).map(item => item.getAttribute('data-index'));
    }
  });

  list.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('device-type-tag')) {
      e.target.classList.remove('dragging');

      const newOrder = Array.from(list.querySelectorAll('.device-type-tag')).map(item => item.getAttribute('data-index'));

      if (JSON.stringify(originalOrder) !== JSON.stringify(newOrder)) {
        saveNewOrder(newOrder);
      }

      draggedItem = null;
      originalOrder = [];
    }
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem) return;

    draggedItem.style.display = 'none';
    const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
    draggedItem.style.display = '';

    const itemBelow = elementBelow?.closest('.device-type-tag');

    if (itemBelow && itemBelow !== draggedItem) {
      const rect = itemBelow.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;

      if (e.clientX < midX) {
        list.insertBefore(draggedItem, itemBelow);
      } else {
        list.insertBefore(draggedItem, itemBelow.nextSibling);
      }
    } else {
      list.appendChild(draggedItem);
    }
  });

  list.addEventListener('dragenter', (e) => {
    e.preventDefault();
  });
}

async function saveNewOrder(newOrder) {
  const deviceTypes = await getDeviceTypes();
  const reordered = [];
  newOrder.forEach(oldIndex => {
    if (deviceTypes[oldIndex]) {
      reordered.push(deviceTypes[oldIndex]);
    }
  });

  if (reordered.length === deviceTypes.length) {
    await saveDeviceTypes(reordered);
    await renderDeviceTypeList();
    showMessage('设备类型顺序已更新', 'success');
  }
}

// 防重复添加设备类型标志
let isAddingDeviceType = false;

async function addDeviceType() {
  // 防止重复点击
  if (isAddingDeviceType) return;
  isAddingDeviceType = true;
  
  const btnAddDeviceType = document.getElementById('btnAddDeviceType');
  const originalText = btnAddDeviceType?.textContent || '添加';
  btnAddDeviceType && (btnAddDeviceType.textContent = '添加中...');
  
  const input = document.getElementById('newDeviceType');
  const typeName = input.value.trim();
  
  if (!typeName) {
    showMessage('请输入设备类型名称', 'error');
    isAddingDeviceType = false;
    btnAddDeviceType && (btnAddDeviceType.textContent = originalText);
    return;
  }
  
  try {
    const deviceTypes = await getDeviceTypes();
    
    if (deviceTypes.some(t => t.type === typeName)) {
      showMessage('该设备类型已存在', 'error');
      return;
    }
    
    deviceTypes.push({
      type: typeName,
      icon: 'fa-box'
    });
    
    const success = await saveDeviceTypes(deviceTypes);
    
    if (success) {
      await renderDeviceTypeList();
      input.value = '';
      showMessage('设备类型添加成功', 'success');
    } else {
      showMessage('保存失败', 'error');
    }
  } catch (error) {
    showMessage('添加失败：' + error.message, 'error');
  } finally {
    // 重置防重复添加标志
    isAddingDeviceType = false;
    btnAddDeviceType && (btnAddDeviceType.textContent = originalText);
  }
}

async function removeDeviceType(index) {
  const deviceTypes = await getDeviceTypes();
  const removedType = deviceTypes[index];
  
  showConfirmModal(`确定要删除设备类型"${removedType.type}"吗？`, async () => {
    deviceTypes.splice(index, 1);
    const success = await saveDeviceTypes(deviceTypes);
    
    if (success) {
      await renderDeviceTypeList();
      showMessage('设备类型已删除', 'success');
    } else {
      showMessage('删除失败', 'error');
    }
  });
}

// 搜索设备 - 创建独立的搜索选项卡
function searchDevices() {
  const searchTerm = document.getElementById('searchInput').value.trim();
  
  if (!searchTerm) {
    return;
  }
  
  // 创建搜索标签页
  ensureTabExists('search', 'fas fa-search', '搜索结果');
  
  // 设置搜索关键词到搜索视图
  document.getElementById('searchKeyword').value = searchTerm;
  
  // 切换到搜索视图
  switchTab('search');
}

// 在搜索视图中执行搜索
function performSearch(searchTerm) {
  if (!searchTerm) {
    searchTerm = document.getElementById('searchKeyword').value.trim();
  }
  
  // 显示当前搜索关键字
  const keywordEl = document.getElementById('currentSearchKeyword');
  if (keywordEl) {
    keywordEl.textContent = searchTerm || '(空)';
  }
  
  const keyword = searchTerm.toLowerCase();
  
  const filtered = devices.filter(device => {
    return (
      (device.address && device.address.toLowerCase().includes(keyword)) ||
      (device.building && device.building.toLowerCase().includes(keyword)) ||
      (device.roomNumber && device.roomNumber.toLowerCase().includes(keyword)) ||
      (device.deviceName && device.deviceName.toLowerCase().includes(keyword)) ||
      (device.deviceType && device.deviceType.toLowerCase().includes(keyword))
    );
  });
  
  // 更新搜索结果数量
  document.getElementById('searchResultCount').textContent = filtered.length;
  
  // 渲染搜索结果表格
  const tbody = document.getElementById('searchResultTableBody');
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          <p>没有找到匹配的设备</p>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filtered.map(device => `
    <tr>
      <td><input type="checkbox" class="search-device-checkbox" value="${device.id}" onchange="updateSearchBatchDeleteButton()"></td>
      <td>${escapeHtml(device.address || '-')}</td>
      <td>${escapeHtml(device.building || '-')}</td>
      <td>${escapeHtml(device.roomNumber || '-')}</td>
      <td>${escapeHtml(device.deviceType || '-')}</td>
      <td>${escapeHtml(device.deviceName || '-')}</td>
      <td>${escapeHtml(device.deviceConfig || '-')}</td>
      <td>${formatUpdateTime(device.updateTime)}</td>
      <td>
        <button class="btn btn-sm btn-info" onclick="viewDevice('${device.id}')">查看</button>
        <button class="btn btn-sm btn-warning" onclick="editDevice('${device.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDevice('${device.id}')">删除</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('searchSelectAll').checked = false;
  updateSearchBatchDeleteButton();
}

function toggleSearchSelectAll() {
  const selectAll = document.getElementById('searchSelectAll');
  const checkboxes = document.querySelectorAll('.search-device-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
  updateSearchBatchDeleteButton();
}

function updateSearchBatchDeleteButton() {
  const checked = document.querySelectorAll('.search-device-checkbox:checked');
  const btn = document.getElementById('btnBatchDeleteSearch');
  btn.style.display = checked.length > 0 ? 'inline-block' : 'none';
  btn.textContent = `批量删除 (${checked.length})`;
}

function batchDeleteSearchDevices() {
  const checked = document.querySelectorAll('.search-device-checkbox:checked');
  if (checked.length === 0) return;

  const ids = Array.from(checked).map(cb => cb.value);
  const count = ids.length;

  showConfirmModal(`确定要删除选中的 <strong>${count}</strong> 个设备吗？此操作不可恢复。`, async () => {
    try {
      for (const id of ids) {
        await fetch(`${API_URL}/devices/${id}`, { method: 'DELETE' });
      }
      await loadDevices();
      renderSearchResults();
      showMessage(`已删除 ${count} 个设备`, 'success');
    } catch (error) {
      showMessage('批量删除失败：' + error.message, 'error');
    }
  });
}

// 清除搜索（返回设备管理视图）
function clearSearch() {
  document.getElementById('searchInput').value = '';
  
  // 隐藏搜索视图，显示设备管理视图
  const listView = document.getElementById('listView');
  const tableView = document.getElementById('tableView');
  const cardView = document.getElementById('cardView');
  const searchView = document.getElementById('searchView');
  
  searchView.style.display = 'none';
  
  // 根据当前视图模式显示对应视图
  renderLevel(currentLevel, currentFilters);
}

// 清空搜索视图并关闭标签页
function clearSearchView() {
  document.getElementById('searchKeyword').value = '';
  document.getElementById('searchResultCount').textContent = '0';
  document.getElementById('searchResultTableBody').innerHTML = '';
  // 关闭搜索标签页
  closeTab('search');
}

// 转义HTML文本
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 转义 HTML 属性值
function escapeHtmlAttr(text) {
  if (!text) return '';
  return text.replace(/"/g, '&quot;');
}

// 格式化更新时间（自动处理时区转换）
function formatUpdateTime(updateTime) {
  if (!updateTime) return '-';
  try {
    const date = new Date(updateTime);
    if (isNaN(date.getTime())) return '-';
    
    // 使用本地时间格式化，自动处理时区转换
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return '-';
  }
}

// 显示消息
function showMessage(message, type = 'info') {
  const colors = {
    success: '#28a745',
    error: '#dc3545',
    info: '#17a2b8',
    warning: '#ffc107'
  };
  
  const messageDiv = document.createElement('div');
  messageDiv.textContent = message;
  messageDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    background: ${colors[type]};
    color: white;
    border-radius: 5px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 2000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(messageDiv);
  
  setTimeout(() => {
    messageDiv.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => messageDiv.remove(), 300);
  }, 3000);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes fadeOut {
    from {
      transform: translateX(400px);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 统计报表颜色配置
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
];

// 渲染统计报表
function renderReports() {
  populateReportFilters();
  updateReportStats();
  renderTypeDistribution();
  renderAddressChart();
  renderReportTable();
  
  // 添加事件监听
  document.getElementById('reportAddressFilter')?.addEventListener('change', renderReports);
  document.getElementById('reportBuildingFilter')?.addEventListener('change', renderReports);
  document.getElementById('btnRefreshReport')?.addEventListener('click', renderReports);
}

// 获取过滤后的设备数据
function getFilteredDevices() {
  let filtered = [...devices];
  
  const addressFilter = document.getElementById('reportAddressFilter')?.value;
  const buildingFilter = document.getElementById('reportBuildingFilter')?.value;
  
  if (addressFilter) {
    filtered = filtered.filter(d => d.address === addressFilter);
  }
  if (buildingFilter) {
    filtered = filtered.filter(d => d.building === buildingFilter);
  }
  
  return filtered;
}

// 填充报表筛选器
function populateReportFilters() {
  const addressFilter = document.getElementById('reportAddressFilter');
  const buildingFilter = document.getElementById('reportBuildingFilter');
  
  if (!addressFilter || !buildingFilter) return;
  
  const addresses = [...new Set(devices.map(d => d.address))].sort();
  const selectedAddress = addressFilter.value;
  
  addressFilter.innerHTML = '<option value="">全部地址</option>' +
    addresses.map(addr => `<option value="${escapeHtmlAttr(addr)}">${escapeHtml(addr)}</option>`).join('');
  
  addressFilter.value = selectedAddress;
  
  const selectedBuilding = buildingFilter.value;
  const filteredAddresses = selectedAddress ? [selectedAddress] : addresses;
  const buildings = [...new Set(devices.filter(d => filteredAddresses.includes(d.address)).map(d => d.building))].sort();
  
  buildingFilter.innerHTML = '<option value="">全部楼宇</option>' +
    buildings.map(bld => `<option value="${escapeHtmlAttr(bld)}">${escapeHtml(bld)}</option>`).join('');
  
  buildingFilter.value = selectedBuilding;
}

// 更新统计数据
function updateReportStats() {
  const filteredDevices = getFilteredDevices();
  
  // 设备总数
  const totalDevicesEl = document.getElementById('totalDevices');
  if (totalDevicesEl) totalDevicesEl.textContent = filteredDevices.length;
  
  // 设备类型数量
  const types = new Set(filteredDevices.map(d => d.deviceType));
  const totalTypesEl = document.getElementById('totalTypes');
  if (totalTypesEl) totalTypesEl.textContent = types.size;
  
  // 位置数量（地址数）
  const addresses = new Set(filteredDevices.map(d => d.address));
  const totalLocationsEl = document.getElementById('totalLocations');
  if (totalLocationsEl) totalLocationsEl.textContent = addresses.size;
  
  // 楼宇数量
  const buildings = new Set(filteredDevices.map(d => d.building));
  const totalBuildingsEl = document.getElementById('totalBuildings');
  if (totalBuildingsEl) totalBuildingsEl.textContent = buildings.size;
  
  // 更新饼图中心数字
  const pieTotalEl = document.getElementById('pieTotal');
  if (pieTotalEl) pieTotalEl.textContent = filteredDevices.length;
}

// 渲染设备类型分布饼图
function renderTypeDistribution() {
  const filteredDevices = getFilteredDevices();
  const typeLegend = document.getElementById('typeLegend');
  const pieChart = document.querySelector('.pie-chart svg');
  
  if (!typeLegend || !pieChart) return;
  
  // 统计各类型设备数量
  const typeCounts = filteredDevices.reduce((acc, device) => {
    const type = device.deviceType || '未分类';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  
  const total = filteredDevices.length;
  
  // 清空现有切片
  while (pieChart.children.length > 1) {
    pieChart.removeChild(pieChart.lastChild);
  }
  
  // 计算饼图数据
  let cumulativeOffset = 0;
  const circumference = 2 * Math.PI * 80;
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  
  // 创建饼图切片
  sortedTypes.forEach(([type, count], index) => {
    const percentage = count / total;
    const dashArray = `${percentage * circumference} ${circumference}`;
    const dashOffset = -cumulativeOffset;
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '100');
    circle.setAttribute('cy', '100');
    circle.setAttribute('r', '80');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', CHART_COLORS[index % CHART_COLORS.length]);
    circle.setAttribute('stroke-width', '20');
    circle.setAttribute('stroke-dasharray', dashArray);
    circle.setAttribute('stroke-dashoffset', dashOffset);
    circle.setAttribute('class', 'pie-slice');
    circle.setAttribute('style', `transition: stroke-dasharray 0.5s ease ${index * 0.1}s`);
    
    pieChart.appendChild(circle);
    cumulativeOffset += percentage * circumference;
  });
  
  // 创建图例
  typeLegend.innerHTML = sortedTypes.map(([type, count], index) => {
    const percentage = ((count / total) * 100).toFixed(1);
    return `
      <div class="legend-item">
        <div class="legend-color" style="background: ${CHART_COLORS[index % CHART_COLORS.length]}"></div>
        <span class="legend-text">${escapeHtml(type)}</span>
        <span class="legend-value">${count}</span>
        <span class="legend-percent">${percentage}%</span>
      </div>
    `;
  }).join('');
}

// 渲染地址分布柱状图
function renderAddressChart() {
  const filteredDevices = getFilteredDevices();
  const addressChart = document.getElementById('addressChart');
  
  if (!addressChart) return;
  
  // 统计各地址设备数量
  const addressCounts = filteredDevices.reduce((acc, device) => {
    const addr = device.address || '未分类';
    acc[addr] = (acc[addr] || 0) + 1;
    return acc;
  }, {});
  
  const maxCount = Math.max(...Object.values(addressCounts), 1);
  const sortedAddresses = Object.entries(addressCounts).sort((a, b) => b[1] - a[1]);
  
  addressChart.innerHTML = sortedAddresses.map(([address, count]) => {
    const percentage = (count / maxCount) * 100;
    return `
      <div class="bar-item">
        <span class="bar-label">${escapeHtml(address.length > 6 ? address.substring(0, 6) + '...' : address)}</span>
        <div class="bar-wrapper">
          <div class="bar-fill" style="width: ${percentage}%">
            <span class="bar-value">${count}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 渲染报表表格
function renderReportTable() {
  const filteredDevices = getFilteredDevices();
  const tbody = document.getElementById('reportTableBody');
  
  if (!tbody) return;
  
  if (filteredDevices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <p>暂无设备数据</p>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filteredDevices.map(device => `
    <tr>
      <td>${escapeHtml(device.address || '-')}</td>
      <td>${escapeHtml(device.building || '-')}</td>
      <td>${escapeHtml(device.roomNumber || '-')}</td>
      <td>${escapeHtml(device.deviceType || '-')}</td>
      <td>${escapeHtml(device.deviceName || '-')}</td>
      <td>${escapeHtml(device.deviceConfig || '-')}</td>
      <td>${escapeHtml(device.remark || '-')}</td>
      <td>${formatUpdateTime(device.updateTime)}</td>
    </tr>
  `).join('');
}

// 用户管理相关变量
let users = [];

// 渲染用户管理页面
function renderUsers() {
  loadUsers();
  
  // 添加事件监听
  document.getElementById('btnAddUser')?.addEventListener('click', showAddUserModal);
  document.getElementById('btnUserSearch')?.addEventListener('click', searchUsers);
  document.getElementById('userSearchInput')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') searchUsers();
  });
}

// 加载用户数据
async function loadUsers() {
  try {
    const response = await fetch(`${API_URL}/users`);
    if (!response.ok) throw new Error('加载失败');
    users = await response.json();
    updateUserStats();
    renderUserTable();
  } catch (error) {
    showMessage('加载用户数据失败：' + error.message, 'error');
  }
}

// 更新用户统计数据
function updateUserStats() {
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active').length;
  const inactiveUsers = users.filter(u => u.status === 'inactive').length;
  
  const totalUsersEl = document.getElementById('totalUsers');
  if (totalUsersEl) totalUsersEl.textContent = totalUsers;
  
  const activeUsersEl = document.getElementById('activeUsers');
  if (activeUsersEl) activeUsersEl.textContent = activeUsers;
  
  const inactiveUsersEl = document.getElementById('inactiveUsers');
  if (inactiveUsersEl) inactiveUsersEl.textContent = inactiveUsers;
}

// 渲染用户表格
function renderUserTable(filteredUsers = null) {
  const displayUsers = filteredUsers || users;
  const tbody = document.getElementById('userTableBody');
  
  if (!tbody) return;
  
  if (displayUsers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <p>暂无用户数据</p>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = displayUsers.map(user => `
    <tr>
      <td>${escapeHtml(user.username || '-')}</td>
      <td>${escapeHtml(user.fullName || '-')}</td>
      <td>${escapeHtml(user.email || '-')}</td>
      <td>${escapeHtml(user.phone || '-')}</td>
      <td>${escapeHtml(user.department || '-')}</td>
      <td><span class="role-badge ${user.role}">${getRoleLabel(user.role)}</span></td>
      <td><span class="status-badge ${user.status}">${user.status === 'active' ? '活跃' : '非活跃'}</span></td>
      <td>
        <button class="btn btn-sm btn-info" onclick="showEditUserModal('${user.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser('${user.id}')">删除</button>
      </td>
    </tr>
  `).join('');
}

// 获取角色标签
function getRoleLabel(role) {
  const roles = {
    admin: '系统管理员',
    manager: '设备管理员',
    user: '普通用户'
  };
  return roles[role] || role;
}

// 搜索用户
function searchUsers() {
  const searchTerm = document.getElementById('userSearchInput').value.trim().toLowerCase();
  
  if (!searchTerm) {
    renderUserTable();
    return;
  }
  
  const filtered = users.filter(user => {
    return (
      (user.username && user.username.toLowerCase().includes(searchTerm)) ||
      (user.fullName && user.fullName.toLowerCase().includes(searchTerm)) ||
      (user.email && user.email.toLowerCase().includes(searchTerm)) ||
      (user.department && user.department.toLowerCase().includes(searchTerm))
    );
  });
  
  renderUserTable(filtered);
}

// 显示添加用户弹窗
function showAddUserModal() {
  document.getElementById('userId').value = '';
  document.getElementById('username').value = '';
  document.getElementById('fullName').value = '';
  document.getElementById('email').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('department').value = '';
  document.getElementById('role').value = 'user';
  document.getElementById('status').value = 'active';
  document.getElementById('password').value = '';
  document.getElementById('userModalTitleText').textContent = '添加用户';
  document.querySelector('#userModal .modal-icon i').className = 'fas fa-user-plus';
  document.getElementById('userModal').classList.add('show');
}

// 显示编辑用户弹窗
async function showEditUserModal(id) {
  try {
    const response = await fetch(`${API_URL}/users/${id}`);
    if (!response.ok) throw new Error('获取用户信息失败');
    const user = await response.json();
    
    document.getElementById('userId').value = user.id;
    document.getElementById('username').value = user.username;
    document.getElementById('fullName').value = user.fullName;
    document.getElementById('email').value = user.email || '';
    document.getElementById('phone').value = user.phone || '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('role').value = user.role;
    document.getElementById('status').value = user.status;
    document.getElementById('password').value = '';
    document.getElementById('userModalTitleText').textContent = '编辑用户';
    document.querySelector('#userModal .modal-icon i').className = 'fas fa-user-edit';
    document.getElementById('userModal').classList.add('show');
  } catch (error) {
    showMessage('获取用户信息失败：' + error.message, 'error');
  }
}

// 关闭用户弹窗
function closeUserModal() {
  document.getElementById('userModal').classList.remove('show');
}

// 保存用户
// 防重复保存用户标志
let isSavingUser = false;

async function saveUser() {
  // 防止重复点击
  if (isSavingUser) return;
  isSavingUser = true;
  
  const btnSaveUser = document.getElementById('btnSaveUser');
  const originalText = btnSaveUser?.textContent || '保存';
  btnSaveUser && (btnSaveUser.textContent = '保存中...');
  
  const id = document.getElementById('userId').value;
  const username = document.getElementById('username').value.trim();
  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const department = document.getElementById('department').value.trim();
  const role = document.getElementById('role').value;
  const status = document.getElementById('status').value;
  const password = document.getElementById('password').value.trim();
  
  if (!username || !fullName) {
    showMessage('请填写用户名和姓名', 'error');
    isSavingUser = false;
    btnSaveUser && (btnSaveUser.textContent = originalText);
    return;
  }
  
  try {
    const userData = { username, fullName, email, phone, department, role, status };
    if (password) {
      userData.password = password;
    }
    
    let response;
    if (id) {
      // 更新用户
      response = await fetch(`${API_URL}/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
    } else {
      // 添加用户
      response = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
    }
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || '保存失败');
    }
    
    const result = await response.json();
    showMessage(result.message, 'success');
    closeUserModal();
    loadUsers();
  } catch (error) {
    showMessage('保存失败：' + error.message, 'error');
  } finally {
    // 重置防重复提交标志
    isSavingUser = false;
    const btnSaveUser = document.getElementById('btnSaveUser');
    btnSaveUser && (btnSaveUser.textContent = originalText);
  }
}

// 删除用户
function deleteUser(id) {
  const user = users.find(u => u.id === id);
  const userName = user ? user.fullName || user.username : '此用户';
  
  showConfirmModal(`确定要删除用户"${userName}"吗？\n此操作不可恢复！`, async () => {
    try {
      const response = await fetch(`${API_URL}/users/${id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '删除失败');
      }
      
      const result = await response.json();
      showMessage(result.message, 'success');
      loadUsers();
    } catch (error) {
      showMessage('删除失败：' + error.message, 'error');
    }
  });
}
