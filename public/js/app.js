// Developer Portal SPA Application Logic
let state = {
  token: localStorage.getItem('tenantToken') || null,
  tenant: JSON.parse(localStorage.getItem('tenantData') || 'null'),
  ingestionUrl: '',
  socket: null,
  isStreamPaused: false,
  eventCount: 0,
  devices: [],
  events: [],
  eventsMap: new Map(),
  apiKeys: [],
  webhooks: []
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (state.token) {
    showPortalView();
  } else {
    showAuthView();
  }
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('portalTheme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('portalTheme', theme);
  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  if (icon && text) {
    if (theme === 'light') {
      icon.className = 'fa-solid fa-moon';
      text.textContent = 'Dark Mode';
    } else {
      icon.className = 'fa-solid fa-sun';
      text.textContent = 'Light Mode';
    }
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// API Helper
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
    ...options.headers
  };

  try {
    const response = await fetch(endpoint, { ...options, headers });
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401 && !endpoint.includes('/login')) {
        handleLogout();
        showToast('Session expired. Please log in again.', 'error');
        return null;
      }
      throw new Error(data.message || 'API request failed');
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// Auth UI Switches
function showAuthView() {
  document.getElementById('authView').style.display = 'block';
  document.getElementById('portalView').style.display = 'none';
  document.getElementById('userProfileArea').innerHTML = '';
}

function showPortalView() {
  document.getElementById('authView').style.display = 'none';
  document.getElementById('portalView').style.display = 'flex';
  
  // Render user profile pill
  const userArea = document.getElementById('userProfileArea');
  const name = state.tenant ? state.tenant.name : 'Tenant Admin';
  const email = state.tenant ? state.tenant.email : '';
  
  userArea.innerHTML = `
    <div class="tenant-pill">
      <span class="tenant-dot"></span>
      <span><strong>${escapeHtml(name)}</strong> <small style="color: var(--text-muted);">(${escapeHtml(email)})</small></span>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
  `;

  loadTenantProfile();
  loadDashboardData();
  initWebSocket();
}

function switchAuthTab(type) {
  const loginTab = document.getElementById('tabSelectLogin');
  const regTab = document.getElementById('tabSelectRegister');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');

  if (type === 'login') {
    loginTab.classList.add('active');
    regTab.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
  } else {
    regTab.classList.add('active');
    loginTab.classList.remove('active');
    regForm.style.display = 'block';
    loginForm.style.display = 'none';
  }
}

// Auth Handlers
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const data = await apiFetch('/api/tenant/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (data && data.token) {
      state.token = data.token;
      state.tenant = data.tenant;
      localStorage.setItem('tenantToken', data.token);
      localStorage.setItem('tenantData', JSON.stringify(data.tenant));
      showToast('Logged in successfully!');
      showPortalView();
    }
  } catch (err) {
    // Error handled in apiFetch
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  try {
    const data = await apiFetch('/api/tenant/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });

    if (data && data.token) {
      state.token = data.token;
      state.tenant = data.tenant;
      localStorage.setItem('tenantToken', data.token);
      localStorage.setItem('tenantData', JSON.stringify(data.tenant));
      showToast('Tenant account created successfully!');
      showPortalView();
    }
  } catch (err) {
    // Error handled in apiFetch
  }
}

function handleLogout() {
  state.token = null;
  state.tenant = null;
  localStorage.removeItem('tenantToken');
  localStorage.removeItem('tenantData');
  if (state.socket) {
    state.socket.disconnect();
  }
  showAuthView();
}

// Tab Navigation
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  event.currentTarget.classList.add('active');
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.add('active');

  // Trigger tab data refreshes
  if (tabId === 'overview') loadDashboardData();
  if (tabId === 'devices') loadDevices();
  if (tabId === 'apikeys') loadApiKeys();
  if (tabId === 'webhooks') loadWebhooks();
}

// Profile & Ingestion URL
async function loadTenantProfile() {
  try {
    const data = await apiFetch('/api/tenant/me');
    if (data) {
      state.ingestionUrl = data.ingestionUrl;
      const input = document.getElementById('ingestionUrlInput');
      if (input) input.value = data.ingestionUrl;
    }
  } catch (err) {}
}

function copyIngestionUrl() {
  const input = document.getElementById('ingestionUrlInput');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Ingestion Webhook URL copied to clipboard!');
}

// Dashboard Overview Data
async function loadDashboardData() {
  try {
    const [devices, eventsData] = await Promise.all([
      apiFetch('/api/devices'),
      apiFetch('/api/events?limit=10')
    ]);

    if (devices) {
      state.devices = devices;
      const total = devices.length;
      const online = devices.filter(d => d.status === 'ONLINE').length;
      const offline = total - online;
      
      document.getElementById('statTotalDevices').textContent = total;
      document.getElementById('statOnlineDevices').textContent = online;
      document.getElementById('statOfflineDevices').textContent = offline;
    }

    if (eventsData && eventsData.data) {
      document.getElementById('statTotalEvents').textContent = eventsData.total || eventsData.data.length;
      renderOverviewEventsTable(eventsData.data);
    }
  } catch (err) {}
}

function renderOverviewEventsTable(events) {
  const tbody = document.getElementById('overviewEventsTable');
  if (!events || events.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No events recorded yet. Connect a Hikvision terminal to begin ingestion!</td></tr>`;
    return;
  }

  events.forEach(e => {
    if (e.id) state.eventsMap.set(String(e.id), e);
  });

  tbody.innerHTML = events.slice(0, 5).map(e => `
    <tr>
      <td><small>${new Date(e.timestamp).toLocaleString()}</small></td>
      <td><code>${escapeHtml(e.deviceId)}</code></td>
      <td><span class="type-tag">${escapeHtml(e.eventType)}</span></td>
      <td>${escapeHtml(e.employeeName || e.employeeId || 'N/A')}</td>
      <td>
        <button class="btn btn-secondary btn-sm btn-inspect-event" data-event-id="${escapeHtml(e.id)}">
          <i class="fa-solid fa-code"></i> Inspect
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-inspect-event').forEach(btn => {
    btn.addEventListener('click', () => {
      const eventId = btn.getAttribute('data-event-id');
      const eventObj = state.eventsMap.get(eventId);
      if (eventObj) {
        viewEventJson(eventObj);
      }
    });
  });
}

// Devices Management
async function loadDevices() {
  const statusFilter = document.getElementById('deviceStatusFilter').value;
  let url = '/api/devices';
  if (statusFilter) url += `?status=${statusFilter}`;

  try {
    const devices = await apiFetch(url);
    if (devices) {
      state.devices = devices;
      renderDevicesTable(devices);
    }
  } catch (err) {}
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!devices || devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No devices found. Configure your Hikvision device or add one manually.</td></tr>`;
    return;
  }

  tbody.innerHTML = devices.map(d => `
    <tr>
      <td><strong>${escapeHtml(d.id)}</strong></td>
      <td>${escapeHtml(d.name)}</td>
      <td><span class="type-tag">${escapeHtml(d.type)}</span></td>
      <td>
        <span class="status-badge ${d.status.toLowerCase()}">
          <span class="${d.status === 'ONLINE' ? 'status-dot-pulse' : ''}"></span> ${d.status}
        </span>
      </td>
      <td><small>${escapeHtml(d.firmwareVersion || 'N/A')}</small></td>
      <td><small>${d.lastEventAt ? new Date(d.lastEventAt).toLocaleString() : 'Never'}</small></td>
      <td>
        <button class="btn btn-secondary btn-sm btn-edit-device" data-device-id="${escapeHtml(d.id)}">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button class="btn btn-danger btn-sm btn-delete-device" data-device-id="${escapeHtml(d.id)}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit-device').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-device-id');
      const dev = state.devices.find(d => String(d.id) === String(id));
      if (dev) {
        openEditDeviceModal(dev.id, dev.name, dev.type, dev.status);
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-device').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-device-id');
      if (id) {
        handleDeleteDevice(id);
      }
    });
  });
}

async function handleCreateDevice(e) {
  e.preventDefault();
  const id = document.getElementById('devIdInput').value;
  const name = document.getElementById('devNameInput').value;
  const type = document.getElementById('devTypeInput').value;
  const firmwareVersion = document.getElementById('devFirmwareInput').value;

  try {
    await apiFetch('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ id, name, type, firmwareVersion })
    });
    showToast(`Device ${id} registered successfully`);
    closeModal('registerDeviceModal');
    loadDevices();
  } catch (err) {}
}

function openEditDeviceModal(id, name, type, status) {
  document.getElementById('editDeviceId').value = id;
  document.getElementById('editDevName').value = name;
  document.getElementById('editDevType').value = type;
  document.getElementById('editDevStatus').value = status;
  openModal('editDeviceModal');
}

async function handleUpdateDevice(e) {
  e.preventDefault();
  const id = document.getElementById('editDeviceId').value;
  const name = document.getElementById('editDevName').value;
  const type = document.getElementById('editDevType').value;
  const status = document.getElementById('editDevStatus').value;

  try {
    await apiFetch(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, type, status })
    });
    showToast(`Device ${id} updated`);
    closeModal('editDeviceModal');
    loadDevices();
  } catch (err) {}
}

async function handleDeleteDevice(id) {
  if (!confirm(`Are you sure you want to remove device ${id}?`)) return;
  try {
    await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
    showToast(`Device ${id} deleted`);
    loadDevices();
  } catch (err) {}
}

// API Keys Management
async function loadApiKeys() {
  try {
    const res = await apiFetch('/api/api-keys');
    if (res && res.data) {
      state.apiKeys = res.data;
      renderApiKeysTable(res.data);
    }
  } catch (err) {}
}

function renderApiKeysTable(keys) {
  const tbody = document.getElementById('apiKeysTableBody');
  if (!keys || keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No API keys generated yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys.map(k => `
    <tr>
      <td><strong>${escapeHtml(k.name)}</strong></td>
      <td><code>${escapeHtml(k.id.slice(0, 8))}...</code></td>
      <td>
        <span class="status-badge ${k.isActive ? 'online' : 'offline'}">
          ${k.isActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
      </td>
      <td><small>${new Date(k.createdAt).toLocaleDateString()}</small></td>
      <td><small>${k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</small></td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="handleDeleteApiKey('${k.id}')">
          <i class="fa-solid fa-ban"></i> Revoke
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleCreateApiKey(e) {
  e.preventDefault();
  const name = document.getElementById('apiKeyNameInput').value;
  const expiresAtVal = document.getElementById('apiKeyExpInput').value;
  const expiresAt = expiresAtVal ? new Date(expiresAtVal).toISOString() : undefined;

  try {
    const data = await apiFetch('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, expiresAt })
    });

    closeModal('createApiKeyModal');
    if (data && data.apiKey) {
      document.getElementById('revealedKeySecret').value = data.apiKey;
      openModal('revealKeyModal');
      loadApiKeys();
    }
  } catch (err) {}
}

function copySecretKey() {
  const input = document.getElementById('revealedKeySecret');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('API Key copied to clipboard!');
}

async function handleDeleteApiKey(id) {
  if (!confirm('Revoke this API Key?')) return;
  try {
    await apiFetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    showToast('API Key revoked');
    loadApiKeys();
  } catch (err) {}
}

// Webhooks Management
async function loadWebhooks() {
  try {
    const res = await apiFetch('/api/webhooks/subscriptions');
    if (res && res.data) {
      state.webhooks = res.data;
      renderWebhooksTable(res.data);
    }
  } catch (err) {}
}

function renderWebhooksTable(subs) {
  const tbody = document.getElementById('webhooksTableBody');
  if (!subs || subs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No outbound webhook subscriptions.</td></tr>`;
    return;
  }

  tbody.innerHTML = subs.map(s => `
    <tr>
      <td><code style="color: var(--accent-cyan);">${escapeHtml(s.url)}</code></td>
      <td>${s.eventTypes.map(t => `<span class="type-tag">${escapeHtml(t)}</span>`).join(' ')}</td>
      <td>
        <span class="status-badge ${s.isActive ? 'online' : 'offline'}">
          ${s.isActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
      </td>
      <td><small>${new Date(s.createdAt).toLocaleDateString()}</small></td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="handleDeleteWebhook('${s.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleCreateWebhook(e) {
  e.preventDefault();
  const url = document.getElementById('webhookUrlInput').value;
  const checkboxes = document.querySelectorAll('input[name="whEvent"]:checked');
  const eventTypes = Array.from(checkboxes).map(c => c.value);

  if (eventTypes.length === 0) {
    showToast('Please select at least one event type', 'error');
    return;
  }

  try {
    await apiFetch('/api/webhooks/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ url, eventTypes })
    });
    showToast('Webhook subscription added');
    closeModal('createWebhookModal');
    loadWebhooks();
  } catch (err) {}
}

async function handleDeleteWebhook(id) {
  if (!confirm('Delete this webhook subscription?')) return;
  try {
    await apiFetch(`/api/webhooks/subscriptions/${id}`, { method: 'DELETE' });
    showToast('Webhook subscription deleted');
    loadWebhooks();
  } catch (err) {}
}

// Socket.IO Real-Time Telemetry Connection
function initWebSocket() {
  if (state.socket) state.socket.disconnect();

  const socket = io({
    auth: { token: state.token }
  });

  state.socket = socket;

  socket.on('connect', () => {
    document.getElementById('socketDot').className = 'status-dot-pulse';
    document.getElementById('socketText').textContent = 'Connected to Real-Time Room';
  });

  socket.on('disconnect', () => {
    document.getElementById('socketDot').className = 'status-dot-pulse';
    document.getElementById('socketDot').style.background = 'var(--danger)';
    document.getElementById('socketText').textContent = 'Disconnected';
  });

  socket.on('new_event', (event) => {
    if (state.isStreamPaused) return;

    state.eventCount++;
    document.getElementById('eventCounterTag').textContent = `${state.eventCount} Events Streamed`;
    
    appendTelemetryItem(event);
    loadDashboardData(); // Update overview metrics
  });

  socket.on('device_update', (device) => {
    loadDevices();
  });
}

function appendTelemetryItem(event) {
  const container = document.getElementById('telemetryStreamList');
  const filter = document.getElementById('eventTypeFilter').value;

  if (filter !== 'ALL' && event.eventType !== filter) return;

  const eventId = String(event.id || `evt_${Date.now()}_${Math.random()}`);
  state.eventsMap.set(eventId, event);

  // Clear placeholder if present
  if (container.children.length === 1 && container.children[0].innerText.includes('Listening')) {
    container.innerHTML = '';
  }

  const div = document.createElement('div');
  div.className = `stream-item ${event.eventType}`;
  
  let icon = 'fa-fingerprint';
  if (event.eventType === 'CHECK_IN') icon = 'fa-right-to-bracket';
  if (event.eventType === 'CHECK_OUT') icon = 'fa-right-from-bracket';
  if (event.eventType === 'DOOR_OPEN') icon = 'fa-door-open';
  if (event.eventType === 'DOOR_FORCED') icon = 'fa-triangle-exclamation';

  div.innerHTML = `
    <div class="stream-main">
      <div class="stream-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="stream-details">
        <h4>${escapeHtml(event.eventType)} - ${escapeHtml(event.employeeName || event.employeeId || 'Terminal Event')}</h4>
        <div class="stream-meta">
          <span><i class="fa-solid fa-microchip"></i> ${escapeHtml(event.deviceId)}</span>
          <span><i class="fa-regular fa-clock"></i> ${new Date(event.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
    <button class="btn btn-secondary btn-sm btn-inspect-event" data-event-id="${escapeHtml(eventId)}">
      <i class="fa-solid fa-code"></i> Inspect Raw
    </button>
  `;

  const inspectBtn = div.querySelector('.btn-inspect-event');
  if (inspectBtn) {
    inspectBtn.addEventListener('click', () => {
      const eventObj = state.eventsMap.get(eventId) || event;
      viewEventJson(eventObj);
    });
  }

  container.insertBefore(div, container.firstChild);
  if (container.children.length > 50) {
    container.removeChild(container.lastChild);
  }
}

function togglePauseStream() {
  state.isStreamPaused = !state.isStreamPaused;
  const btn = document.getElementById('pauseStreamBtn');
  if (state.isStreamPaused) {
    btn.innerHTML = `<i class="fa-solid fa-play"></i> Resume Stream`;
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-secondary');
  } else {
    btn.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Stream`;
    btn.classList.add('btn-secondary');
    btn.classList.remove('btn-primary');
  }
}

function clearTelemetryFeed() {
  document.getElementById('telemetryStreamList').innerHTML = `
    <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
      <i class="fa-solid fa-satellite-dish" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--border-color);"></i>
      <p>Feed cleared. Listening for new incoming events...</p>
    </div>
  `;
}

// JSON Inspector Modal
function viewEventJson(eventInput) {
  let eventObj = eventInput;
  if (typeof eventInput === 'string') {
    eventObj = state.eventsMap.get(eventInput) || eventInput;
  }
  document.getElementById('jsonViewerContent').textContent = JSON.stringify(eventObj, null, 2);
  openModal('jsonInspectorModal');
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Security Helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
