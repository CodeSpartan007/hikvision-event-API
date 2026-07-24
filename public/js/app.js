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
  webhooks: [],
  hydrationReqId: 0,
  isHydratingTelemetry: false,
  bufferedTelemetryEvents: []
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkResetTokenInUrl();
  initLiveValidation();
  if (state.token) {
    showPortalView();
  } else {
    showAuthView();
  }
});

function checkResetTokenInUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('resetToken') || urlParams.get('token');
  if (resetToken) {
    showAuthSubView('reset', null, resetToken);
  }
}

// Global listeners for profile dropdown & modals
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('profileDropdownWindow');
  const btn = document.getElementById('profileIconBtn');
  if (dropdown && dropdown.classList.contains('show')) {
    if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
      dropdown.classList.remove('show');
    }
  }

  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('active');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const dropdown = document.getElementById('profileDropdownWindow');
    if (dropdown && dropdown.classList.contains('show')) {
      dropdown.classList.remove('show');
    }
    document.querySelectorAll('.modal-backdrop.active').forEach(modal => {
      modal.classList.remove('active');
    });
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
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';
  if (type === 'info') icon = 'fa-circle-info';
  if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${escapeHtml(message)}</span>
    <button type="button" class="toast-close-btn" onclick="this.parentElement.remove()" title="Close notification">&times;</button>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4500);
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
    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      data = {};
    }
    
    if (!response.ok) {
      if (response.status === 401 && !endpoint.includes('/login')) {
        handleLogout();
        showToast('Session expired. Please log in again.', 'error');
        return null;
      }
      const errorMsg = data.message || (data.error ? `${data.error}: API request failed` : 'API request failed');
      const err = new Error(errorMsg);
      err.data = data;
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (!err.data) {
      showToast(err.message || 'Network request failed', 'error');
    }
    throw err;
  }
}

// Validation & Form Error Helpers
function setFieldError(fieldInputOrId, errorMessage) {
  let input = typeof fieldInputOrId === 'string' ? document.getElementById(fieldInputOrId) : fieldInputOrId;
  let errorEl = null;
  
  if (typeof fieldInputOrId === 'string' && fieldInputOrId.endsWith('Error')) {
    errorEl = document.getElementById(fieldInputOrId);
  } else if (input) {
    errorEl = document.getElementById(`${input.id}Error`);
  }

  if (input && input.classList) {
    input.classList.add('is-invalid');
    input.classList.remove('is-valid');
  }

  if (errorEl) {
    const span = errorEl.querySelector('span');
    if (span) span.textContent = errorMessage;
    else errorEl.textContent = errorMessage;
    errorEl.classList.add('show');
  }
}

function setFieldValid(fieldInputOrId) {
  let input = typeof fieldInputOrId === 'string' ? document.getElementById(fieldInputOrId) : fieldInputOrId;
  let errorEl = input ? document.getElementById(`${input.id}Error`) : null;

  if (input && input.classList) {
    input.classList.remove('is-invalid');
    input.classList.add('is-valid');
  }

  if (errorEl) {
    errorEl.classList.remove('show');
    const span = errorEl.querySelector('span');
    if (span) span.textContent = '';
  }
}

function clearFieldError(fieldInputOrId) {
  let input = typeof fieldInputOrId === 'string' ? document.getElementById(fieldInputOrId) : fieldInputOrId;
  let errorEl = input ? document.getElementById(`${input.id}Error`) : null;

  if (input && input.classList) {
    input.classList.remove('is-invalid', 'is-valid');
  }

  if (errorEl) {
    errorEl.classList.remove('show');
    const span = errorEl.querySelector('span');
    if (span) span.textContent = '';
  }
}

function clearFormErrors(formElement) {
  if (!formElement) return;
  const inputs = formElement.querySelectorAll('.form-control');
  inputs.forEach(input => clearFieldError(input));
  const errors = formElement.querySelectorAll('.field-error');
  errors.forEach(err => {
    err.classList.remove('show');
    const span = err.querySelector('span');
    if (span) span.textContent = '';
  });
}

function clearAuthForms() {
  const forms = ['loginForm', 'registerForm', 'forgotForm', 'resetForm'];
  forms.forEach(id => {
    const form = document.getElementById(id);
    if (form) {
      form.reset();
      clearFormErrors(form);

      form.querySelectorAll('.input-password-wrapper input').forEach(input => {
        input.type = 'password';
      });
      form.querySelectorAll('.password-toggle-btn i').forEach(icon => {
        icon.className = 'fa-solid fa-eye';
      });
    }
  });

  checkPasswordStrength('', 'reg');
  checkPasswordStrength('', 'reset');
  const badge = document.getElementById('resetMatchBadge');
  if (badge) badge.innerHTML = '';
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye';
  }
}

function setButtonLoading(btnOrId, loadingText) {
  const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
  if (!btn) return;
  btn.dataset.origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
}

function resetButtonLoading(btnOrId) {
  const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('loading');
  if (btn.dataset.origHtml) {
    btn.innerHTML = btn.dataset.origHtml;
  }
}

function checkPasswordStrength(password, prefix = 'reg') {
  const container = document.getElementById(`${prefix}PasswordStrength`);
  const label = document.getElementById(`${prefix}StrengthLabel`);
  const fill = document.getElementById(`${prefix}StrengthFill`);
  const reqLength = document.getElementById(`${prefix}ReqLength`);
  const reqNum = document.getElementById(`${prefix}ReqNum`);

  if (!container) return;

  if (!password) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const hasLength = password.length >= 6;
  const hasNumOrSymbol = /[0-9!@#$%^&*(),.?":{}|<>]/.test(password);

  if (reqLength) {
    reqLength.className = `req-item ${hasLength ? 'valid' : 'invalid'}`;
    reqLength.innerHTML = `<i class="fa-solid ${hasLength ? 'fa-check' : 'fa-circle-xmark'}"></i> At least 6 chars`;
  }

  if (reqNum) {
    reqNum.className = `req-item ${hasNumOrSymbol ? 'valid' : 'invalid'}`;
    reqNum.innerHTML = `<i class="fa-solid ${hasNumOrSymbol ? 'fa-check' : 'fa-circle-xmark'}"></i> Contains number or symbol`;
  }

  let score = 0;
  if (hasLength) score++;
  if (hasNumOrSymbol) score++;
  if (password.length >= 10 && /[A-Z]/.test(password) && /[a-z]/.test(password)) score++;

  if (score <= 1) {
    if (fill) fill.className = 'password-strength-fill weak';
    if (label) { label.textContent = 'Weak'; label.style.color = 'var(--danger)'; }
  } else if (score === 2) {
    if (fill) fill.className = 'password-strength-fill medium';
    if (label) { label.textContent = 'Medium'; label.style.color = 'var(--warning)'; }
  } else {
    if (fill) fill.className = 'password-strength-fill strong';
    if (label) { label.textContent = 'Strong'; label.style.color = 'var(--success)'; }
  }
}

function checkPasswordMatch() {
  const newPass = document.getElementById('resetNewPassword')?.value || '';
  const confirmPass = document.getElementById('resetConfirmPassword')?.value || '';
  const badge = document.getElementById('resetMatchBadge');
  const confirmInput = document.getElementById('resetConfirmPassword');

  if (!confirmPass) {
    if (badge) badge.innerHTML = '';
    if (confirmInput) clearFieldError(confirmInput);
    return;
  }

  if (newPass === confirmPass) {
    if (badge) badge.innerHTML = `<span class="match-badge matched"><i class="fa-solid fa-check"></i> Passwords Match</span>`;
    if (confirmInput) setFieldValid(confirmInput);
  } else {
    if (badge) badge.innerHTML = `<span class="match-badge mismatched"><i class="fa-solid fa-xmark"></i> Do Not Match</span>`;
    if (confirmInput) setFieldError(confirmInput, 'Passwords do not match');
  }
}

function mapServerErrorsToForm(formElement, errData) {
  if (!formElement || !errData) return false;
  let mappedAny = false;

  if (errData.errors && typeof errData.errors === 'object') {
    Object.keys(errData.errors).forEach(fieldName => {
      const rawErr = errData.errors[fieldName];
      const errorMsg = Array.isArray(rawErr) ? rawErr.join(', ') : String(rawErr);

      const input = formElement.querySelector(`#${fieldName}`) ||
                    formElement.querySelector(`[name="${fieldName}"]`) ||
                    formElement.querySelector(`[id$="${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}"]`) ||
                    formElement.querySelector(`[id*="${fieldName}"]`);

      if (input) {
        setFieldError(input, errorMsg);
        mappedAny = true;
      }
    });
  }

  if (errData.message) {
    const msg = errData.message;
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes('email')) {
      const emailInput = formElement.querySelector('input[type="email"]');
      if (emailInput) {
        setFieldError(emailInput, msg);
        mappedAny = true;
      }
    } else if (lowerMsg.includes('password')) {
      const passInput = formElement.querySelector('input[type="password"]');
      if (passInput) {
        setFieldError(passInput, msg);
        mappedAny = true;
      }
    } else if (lowerMsg.includes('url')) {
      const urlInput = formElement.querySelector('input[type="url"]');
      if (urlInput) {
        setFieldError(urlInput, msg);
        mappedAny = true;
      }
    } else if (lowerMsg.includes('serial') || lowerMsg.includes('device')) {
      const devInput = formElement.querySelector('#devIdInput');
      if (devInput) {
        setFieldError(devInput, msg);
        mappedAny = true;
      }
    }
  }

  return mappedAny;
}

function initLiveValidation() {
  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', () => {
      if (el.classList.contains('is-invalid')) {
        clearFieldError(el);
      }
    });
  });

  const regPassword = document.getElementById('regPassword');
  if (regPassword) {
    regPassword.addEventListener('input', (e) => {
      checkPasswordStrength(e.target.value, 'reg');
    });
  }

  const resetNewPassword = document.getElementById('resetNewPassword');
  if (resetNewPassword) {
    resetNewPassword.addEventListener('input', (e) => {
      checkPasswordStrength(e.target.value, 'reset');
      checkPasswordMatch();
    });
  }

  const resetConfirmPassword = document.getElementById('resetConfirmPassword');
  if (resetConfirmPassword) {
    resetConfirmPassword.addEventListener('input', checkPasswordMatch);
  }

  const deleteConfirmInput = document.getElementById('deleteConfirmInput');
  if (deleteConfirmInput) {
    deleteConfirmInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val === 'DELETE') {
        setFieldValid(deleteConfirmInput);
      } else if (val.length >= 6 && val !== 'DELETE') {
        setFieldError(deleteConfirmInput, 'Must match DELETE in capital letters');
      }
    });
  }
}

// Auth UI Switches
function showAuthView() {
  clearAuthForms();
  document.getElementById('authView').style.display = 'block';
  document.getElementById('portalView').style.display = 'none';
  document.getElementById('userProfileArea').innerHTML = '';
}

function showPortalView() {
  document.getElementById('authView').style.display = 'none';
  document.getElementById('portalView').style.display = 'flex';
  
  // Clear any residual telemetry state from previous sessions
  state.eventsMap.clear();
  state.events = [];
  state.devices = [];
  state.apiKeys = [];
  state.webhooks = [];
  state.eventCount = 0;

  const eventCounterTag = document.getElementById('eventCounterTag');
  if (eventCounterTag) eventCounterTag.textContent = '0 Events Streamed';

  const telemetryList = document.getElementById('telemetryStreamList');
  if (telemetryList) {
    telemetryList.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        <i class="fa-solid fa-satellite-dish" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--border-color);"></i>
        <p>Listening for real-time Hikvision event telemetry...</p>
      </div>
    `;
  }

  renderUserProfile();

  loadTenantProfile();
  loadDashboardData();
  hydrateTelemetryStream();
  initWebSocket();
}

function renderUserProfile() {
  const userArea = document.getElementById('userProfileArea');
  if (!userArea) return;
  
  const name = state.tenant ? state.tenant.name : 'Tenant Admin';
  const email = state.tenant ? state.tenant.email : 'admin@organization.com';
  
  userArea.innerHTML = `
    <div class="profile-menu-container">
      <button class="profile-icon-btn" id="profileIconBtn" onclick="toggleProfileMenu(event)" title="Account Profile" aria-label="Account Profile">
        <i class="fa-solid fa-circle-user"></i>
      </button>
      <div class="profile-dropdown-window" id="profileDropdownWindow">
        <div class="profile-window-header">
          <div class="profile-avatar-large">
            <i class="fa-solid fa-user"></i>
          </div>
          <div class="profile-details">
            <div class="profile-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="profile-email" title="${escapeHtml(email)}">${escapeHtml(email)}</div>
          </div>
        </div>
        <div class="profile-window-divider"></div>
        <button class="profile-logout-btn" onclick="handleLogout()" style="margin-bottom: 0.5rem;">
          <i class="fa-solid fa-right-from-bracket"></i> Logout
        </button>
        <button class="profile-delete-btn" onclick="openDeleteAccountModal(event)">
          <i class="fa-solid fa-trash-can"></i> Delete Account
        </button>
      </div>
    </div>
  `;
}

function toggleProfileMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('profileDropdownWindow');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

function openDeleteAccountModal(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('profileDropdownWindow');
  if (dropdown) dropdown.classList.remove('show');
  const confirmInput = document.getElementById('deleteConfirmInput');
  if (confirmInput) {
    confirmInput.value = '';
    clearFieldError(confirmInput);
  }
  openModal('deleteAccountModal');
}

async function handleDeleteAccount(e) {
  e.preventDefault();
  const form = e.target;
  clearFormErrors(form);

  const confirmInput = document.getElementById('deleteConfirmInput');
  const confirmText = confirmInput.value.trim();

  if (confirmText !== 'DELETE') {
    setFieldError(confirmInput, 'You must type DELETE in all capital letters to confirm account deletion');
    return;
  }

  setButtonLoading('deleteAccountSubmitBtn', 'Deleting Account...');

  try {
    const data = await apiFetch('/api/tenant/me', {
      method: 'DELETE'
    });

    if (data && data.message) {
      closeModal('deleteAccountModal');
      showToast(data.message, 'success');
      state.token = null;
      state.tenant = null;
      localStorage.removeItem('tenantToken');
      localStorage.removeItem('tenantData');
      if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
      }
      setTimeout(() => {
        showAuthView();
      }, 1000);
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to delete account', 'error');
    }
  } finally {
    resetButtonLoading('deleteAccountSubmitBtn');
  }
}

function showAuthSubView(subView, event, token) {
  if (event) event.preventDefault();
  clearAuthForms();

  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotForm');
  const resetForm = document.getElementById('resetForm');
  const authTabsHeader = document.getElementById('authTabsHeader');

  if (loginForm) loginForm.style.display = 'none';
  if (regForm) regForm.style.display = 'none';
  if (forgotForm) forgotForm.style.display = 'none';
  if (resetForm) resetForm.style.display = 'none';

  if (subView === 'forgot') {
    if (authTabsHeader) authTabsHeader.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'block';
  } else if (subView === 'reset') {
    if (authTabsHeader) authTabsHeader.style.display = 'none';
    if (resetForm) resetForm.style.display = 'block';
    if (token) {
      const tokenInput = document.getElementById('resetTokenInput');
      if (tokenInput) tokenInput.value = token;
    }
  }
}

function switchAuthTab(type, event) {
  if (event) event.preventDefault();
  clearAuthForms();

  const loginTab = document.getElementById('tabSelectLogin');
  const regTab = document.getElementById('tabSelectRegister');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotForm');
  const resetForm = document.getElementById('resetForm');
  const authTabsHeader = document.getElementById('authTabsHeader');

  if (authTabsHeader) authTabsHeader.style.display = 'flex';
  if (forgotForm) forgotForm.style.display = 'none';
  if (resetForm) resetForm.style.display = 'none';

  if (type === 'login') {
    if (loginTab) loginTab.classList.add('active');
    if (regTab) regTab.classList.remove('active');
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
  } else {
    if (regTab) regTab.classList.add('active');
    if (loginTab) loginTab.classList.remove('active');
    if (regForm) regForm.style.display = 'block';
    if (loginForm) loginForm.style.display = 'none';
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const form = document.getElementById('forgotForm');
  clearFormErrors(form);

  const emailInput = document.getElementById('forgotEmail');
  const email = emailInput.value.trim();

  if (!email) {
    setFieldError(emailInput, 'Email address is required');
    return;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, 'Please enter a valid email address');
    return;
  }

  setButtonLoading('forgotSubmitBtn', 'Sending Reset Link...');

  try {
    const data = await apiFetch('/api/tenant/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });

    if (data && data.message) {
      showToast(data.message, 'success');
      emailInput.value = '';
      setTimeout(() => switchAuthTab('login'), 3000);
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to process password reset request', 'error');
    }
  } finally {
    resetButtonLoading('forgotSubmitBtn');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const form = document.getElementById('resetForm');
  clearFormErrors(form);

  const tokenInput = document.getElementById('resetTokenInput');
  const newPassInput = document.getElementById('resetNewPassword');
  const confirmPassInput = document.getElementById('resetConfirmPassword');

  const token = tokenInput.value;
  const newPassword = newPassInput.value;
  const confirmPassword = confirmPassInput.value;

  let isValid = true;
  if (!token) {
    setFieldError('resetTokenInputError', 'Reset token is missing or invalid. Please click the link in your email.');
    isValid = false;
  }

  if (!newPassword) {
    setFieldError(newPassInput, 'New password is required');
    isValid = false;
  } else if (newPassword.length < 6) {
    setFieldError(newPassInput, 'New password must be at least 6 characters long');
    isValid = false;
  }

  if (newPassword !== confirmPassword) {
    setFieldError(confirmPassInput, 'Passwords do not match');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('resetSubmitBtn', 'Updating Password...');

  try {
    const data = await apiFetch('/api/tenant/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword })
    });

    if (data && data.message) {
      showToast(data.message, 'success');
      newPassInput.value = '';
      confirmPassInput.value = '';
      window.history.replaceState({}, document.title, window.location.pathname);
      switchAuthTab('login');
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to reset password. The link may have expired.', 'error');
    }
  } finally {
    resetButtonLoading('resetSubmitBtn');
  }
}

// Auth Handlers
async function handleLogin(e) {
  e.preventDefault();
  const form = document.getElementById('loginForm');
  clearFormErrors(form);

  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  let isValid = true;
  if (!email) {
    setFieldError(emailInput, 'Email address is required');
    isValid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, 'Please enter a valid email address (e.g. user@organization.com)');
    isValid = false;
  }

  if (!password) {
    setFieldError(passwordInput, 'Password is required');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('loginSubmitBtn', 'Signing In...');

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
      clearAuthForms();
      showToast('Logged in successfully!', 'success');
      showPortalView();
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Login failed. Invalid email or password.', 'error');
    }
  } finally {
    resetButtonLoading('loginSubmitBtn');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const form = document.getElementById('registerForm');
  clearFormErrors(form);

  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const passwordInput = document.getElementById('regPassword');

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  let isValid = true;
  if (!name) {
    setFieldError(nameInput, 'Organization name is required');
    isValid = false;
  }

  if (!email) {
    setFieldError(emailInput, 'Work email address is required');
    isValid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, 'Please enter a valid work email address');
    isValid = false;
  }

  if (!password) {
    setFieldError(passwordInput, 'Password is required');
    isValid = false;
  } else if (password.length < 6) {
    setFieldError(passwordInput, 'Password must be at least 6 characters long');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('registerSubmitBtn', 'Creating Account...');

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
      clearAuthForms();
      showToast('Tenant account created successfully!', 'success');
      showPortalView();
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Registration failed. Please check input fields.', 'error');
    }
  } finally {
    resetButtonLoading('registerSubmitBtn');
  }
}

function handleLogout() {
  state.token = null;
  state.tenant = null;
  state.eventsMap.clear();
  state.events = [];
  state.devices = [];
  state.apiKeys = [];
  state.webhooks = [];
  state.eventCount = 0;

  localStorage.removeItem('tenantToken');
  localStorage.removeItem('tenantData');

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  clearAuthForms();
  // Initiate page reload to ensure 100% clean environment for subsequent logins
  window.location.href = window.location.origin + window.location.pathname;
}

// Tab Navigation
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }
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
    if (data && data.tenant) {
      state.tenant = data.tenant;
      localStorage.setItem('tenantData', JSON.stringify(data.tenant));
      renderUserProfile();
    }
    if (data && data.ingestionUrl) {
      let url = data.ingestionUrl
        .replace(/localhost(:\d+)?/g, 'hikvision-events.duckdns.org')
        .replace(/127\.0\.0\.1(:\d+)?/g, 'hikvision-events.duckdns.org');
      state.ingestionUrl = url;
      const input = document.getElementById('ingestionUrlInput');
      if (input) input.value = url;
    }
  } catch (err) {}
}

function copyIngestionUrl() {
  const input = document.getElementById('ingestionUrlInput');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Ingestion Webhook URL copied to clipboard!', 'success');
  
  const btn = window.event?.currentTarget || document.querySelector('#ingestionUrlInput ~ button');
  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
    setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
  }
}

// Dashboard Overview Data
async function loadDashboardData() {
  const tbody = document.getElementById('overviewEventsTable');
  try {
    const [devicesRes, eventsData] = await Promise.all([
      apiFetch('/api/devices'),
      apiFetch('/api/events?limit=10')
    ]);

    if (devicesRes) {
      const devices = Array.isArray(devicesRes) ? devicesRes : (devicesRes.data || []);
      state.devices = devices;
      const total = devices.length;
      const online = devices.filter(d => d.status === 'ONLINE').length;
      const offline = total - online;
      
      document.getElementById('statTotalDevices').textContent = total;
      document.getElementById('statOnlineDevices').textContent = online;
      document.getElementById('statOfflineDevices').textContent = offline;
    }

    if (eventsData && eventsData.data) {
      document.getElementById('statTotalEvents').textContent = eventsData.pagination?.total ?? eventsData.total ?? eventsData.data.length;
      renderOverviewEventsTable(eventsData.data);
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--danger); padding: 1.5rem;">
            <i class="fa-solid fa-triangle-exclamation"></i> Unable to load recent events. ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }
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
  const statusFilter = document.getElementById('deviceStatusFilter')?.value || '';
  let url = '/api/devices';
  if (statusFilter) url += `?status=${statusFilter}`;

  const tbody = document.getElementById('devicesTableBody');
  try {
    const res = await apiFetch(url);
    if (res) {
      const devices = Array.isArray(res) ? res : (res.data || []);
      state.devices = devices;
      renderDevicesTable(devices);
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
            <p>Failed to load hardware devices. ${escapeHtml(err.message)}</p>
            <button class="btn btn-secondary btn-sm" onclick="loadDevices()" style="margin-top: 0.75rem;"><i class="fa-solid fa-rotate"></i> Retry Loading</button>
          </td>
        </tr>
      `;
    }
  }
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  const deviceList = Array.isArray(devices) ? devices : (devices?.data || []);
  if (!deviceList || deviceList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No devices found. Configure your Hikvision device or add one manually.</td></tr>`;
    return;
  }

  tbody.innerHTML = deviceList.map(d => `
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
  const form = e.target;
  clearFormErrors(form);

  const devIdInput = document.getElementById('devIdInput');
  const devNameInput = document.getElementById('devNameInput');
  const devTypeInput = document.getElementById('devTypeInput');
  const devFirmwareInput = document.getElementById('devFirmwareInput');

  const id = devIdInput.value.trim();
  const name = devNameInput.value.trim();
  const type = devTypeInput.value;
  const firmwareVersion = devFirmwareInput.value.trim();

  let isValid = true;
  if (!id) {
    setFieldError(devIdInput, 'Device serial number / ID is required');
    isValid = false;
  }
  if (!name) {
    setFieldError(devNameInput, 'Device name is required');
    isValid = false;
  }
  if (!type) {
    setFieldError(devTypeInput, 'Please select a device type');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('saveDeviceSubmitBtn', 'Saving Device...');

  try {
    await apiFetch('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ id, name, type, firmwareVersion })
    });
    showToast(`Device ${id} registered successfully`, 'success');
    closeModal('registerDeviceModal');
    form.reset();
    loadDevices();
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to register device', 'error');
    }
  } finally {
    resetButtonLoading('saveDeviceSubmitBtn');
  }
}

function openEditDeviceModal(id, name, type, status) {
  const form = document.querySelector('#editDeviceModal form');
  clearFormErrors(form);

  document.getElementById('editDeviceId').value = id;
  document.getElementById('editDevName').value = name;
  document.getElementById('editDevType').value = type;
  document.getElementById('editDevStatus').value = status;
  openModal('editDeviceModal');
}

async function handleUpdateDevice(e) {
  e.preventDefault();
  const form = e.target;
  clearFormErrors(form);

  const id = document.getElementById('editDeviceId').value;
  const devNameInput = document.getElementById('editDevName');
  const devTypeInput = document.getElementById('editDevType');
  const devStatusInput = document.getElementById('editDevStatus');

  const name = devNameInput.value.trim();
  const type = devTypeInput.value;
  const status = devStatusInput.value;

  let isValid = true;
  if (!name) {
    setFieldError(devNameInput, 'Device name is required');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('updateDeviceSubmitBtn', 'Updating...');

  try {
    await apiFetch(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, type, status })
    });
    showToast(`Device ${id} updated successfully`, 'success');
    closeModal('editDeviceModal');
    loadDevices();
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to update device', 'error');
    }
  } finally {
    resetButtonLoading('updateDeviceSubmitBtn');
  }
}

async function handleDeleteDevice(id) {
  if (!confirm(`Are you sure you want to remove device ${id}?`)) return;
  try {
    await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
    showToast(`Device ${id} deleted successfully`, 'success');
    loadDevices();
  } catch (err) {}
}

// API Keys Management
async function loadApiKeys() {
  const tbody = document.getElementById('apiKeysTableBody');
  try {
    const res = await apiFetch('/api/api-keys');
    if (res && res.data) {
      state.apiKeys = res.data;
      renderApiKeysTable(res.data);
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--danger); padding: 2rem;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
            <p>Failed to load API keys. ${escapeHtml(err.message)}</p>
            <button class="btn btn-secondary btn-sm" onclick="loadApiKeys()" style="margin-top: 0.75rem;"><i class="fa-solid fa-rotate"></i> Retry Loading</button>
          </td>
        </tr>
      `;
    }
  }
}

function renderApiKeysTable(keys) {
  const tbody = document.getElementById('apiKeysTableBody');
  if (!keys || keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No API keys generated yet.</td></tr>`;
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
  const form = e.target;
  clearFormErrors(form);

  const nameInput = document.getElementById('apiKeyNameInput');
  const expiresAtVal = document.getElementById('apiKeyExpInput').value;
  const name = nameInput.value.trim();
  const expiresAt = expiresAtVal ? new Date(expiresAtVal).toISOString() : undefined;

  if (!name) {
    setFieldError(nameInput, 'Key description / name is required');
    return;
  }

  setButtonLoading('createApiKeySubmitBtn', 'Generating Key...');

  try {
    const data = await apiFetch('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, expiresAt })
    });

    closeModal('createApiKeyModal');
    form.reset();
    if (data && data.apiKey) {
      document.getElementById('revealedKeySecret').value = data.apiKey;
      openModal('revealKeyModal');
      loadApiKeys();
    }
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to generate API Key', 'error');
    }
  } finally {
    resetButtonLoading('createApiKeySubmitBtn');
  }
}

function copySecretKey() {
  const input = document.getElementById('revealedKeySecret');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('API Key copied to clipboard!', 'success');

  const btn = document.getElementById('copySecretKeyBtn');
  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
    setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
  }
}

async function handleDeleteApiKey(id) {
  if (!confirm('Revoke this API Key?')) return;
  try {
    await apiFetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    showToast('API Key revoked successfully', 'success');
    loadApiKeys();
  } catch (err) {}
}

// Webhooks Management
async function loadWebhooks() {
  const tbody = document.getElementById('webhooksTableBody');
  try {
    const res = await apiFetch('/api/webhooks/subscriptions');
    if (res && res.data) {
      state.webhooks = res.data;
      renderWebhooksTable(res.data);
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--danger); padding: 2rem;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
            <p>Failed to load webhook subscriptions. ${escapeHtml(err.message)}</p>
            <button class="btn btn-secondary btn-sm" onclick="loadWebhooks()" style="margin-top: 0.75rem;"><i class="fa-solid fa-rotate"></i> Retry Loading</button>
          </td>
        </tr>
      `;
    }
  }
}

function renderWebhooksTable(subs) {
  const tbody = document.getElementById('webhooksTableBody');
  if (!subs || subs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No outbound webhook subscriptions.</td></tr>`;
    return;
  }

  tbody.innerHTML = subs.map(s => `
    <tr>
      <td><code style="color: var(--accent);">${escapeHtml(s.url)}</code></td>
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
  const form = e.target;
  clearFormErrors(form);

  const urlInput = document.getElementById('webhookUrlInput');
  const url = urlInput.value.trim();
  const checkboxes = document.querySelectorAll('input[name="whEvent"]:checked');
  const eventTypes = Array.from(checkboxes).map(c => c.value);

  let isValid = true;
  if (!url) {
    setFieldError(urlInput, 'Endpoint target URL is required');
    isValid = false;
  } else if (!/^https?:\/\/.+/i.test(url)) {
    setFieldError(urlInput, 'Webhook URL must start with http:// or https://');
    isValid = false;
  }

  if (eventTypes.length === 0) {
    setFieldError('whEventsError', 'Please select at least one event type');
    isValid = false;
  }

  if (!isValid) return;

  setButtonLoading('createWebhookSubmitBtn', 'Creating Subscription...');

  try {
    await apiFetch('/api/webhooks/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ url, eventTypes })
    });
    showToast('Webhook subscription added successfully', 'success');
    closeModal('createWebhookModal');
    form.reset();
    loadWebhooks();
  } catch (err) {
    if (!mapServerErrorsToForm(form, err.data)) {
      showToast(err.message || 'Failed to create webhook subscription', 'error');
    }
  } finally {
    resetButtonLoading('createWebhookSubmitBtn');
  }
}

async function handleDeleteWebhook(id) {
  if (!confirm('Delete this webhook subscription?')) return;
  try {
    await apiFetch(`/api/webhooks/subscriptions/${id}`, { method: 'DELETE' });
    showToast('Webhook subscription deleted successfully', 'success');
    loadWebhooks();
  } catch (err) {}
}

// Socket.IO Real-Time Telemetry Connection
async function hydrateTelemetryStream() {
  const container = document.getElementById('telemetryStreamList');
  if (!container) return;

  const filterSelect = document.getElementById('eventTypeFilter');
  if (filterSelect && !filterSelect.dataset.listenerAttached) {
    filterSelect.dataset.listenerAttached = 'true';
    filterSelect.addEventListener('change', () => {
      hydrateTelemetryStream();
    });
  }

  const currentReqId = ++state.hydrationReqId;
  state.isHydratingTelemetry = true;
  state.bufferedTelemetryEvents = [];

  const filter = filterSelect?.value || 'ALL';
  let url = '/api/events?limit=20';
  if (filter !== 'ALL') {
    url += `&eventType=${encodeURIComponent(filter)}`;
  }

  try {
    const res = await apiFetch(url);
    if (currentReqId !== state.hydrationReqId) return;

    if (res && res.data) {
      container.innerHTML = '';
      const historicalEvents = [...res.data].reverse();
      const bufferedEvents = [...state.bufferedTelemetryEvents];

      const seenIds = new Set();
      const combined = [];

      historicalEvents.forEach(e => {
        const eventId = String(e.id || `evt_${e.timestamp}_${e.eventType}`);
        seenIds.add(eventId);
        combined.push({ event: e, isHydration: true });
      });

      bufferedEvents.forEach(e => {
        if (filter !== 'ALL' && e.eventType !== filter) return;
        const eventId = String(e.id || `evt_${e.timestamp}_${e.eventType}`);
        if (!seenIds.has(eventId)) {
          seenIds.add(eventId);
          combined.push({ event: e, isHydration: false });
        }
      });

      if (combined.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
            <i class="fa-solid fa-satellite-dish" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--border-color);"></i>
            <p>No historical events match filter. Listening for real-time telemetry...</p>
          </div>
        `;
      } else {
        combined.forEach(item => {
          appendTelemetryItem(item.event, item.isHydration);
        });
      }
    }
  } catch (err) {
    if (currentReqId === state.hydrationReqId) {
      console.error('Failed to hydrate real-time telemetry stream:', err);
    }
  } finally {
    if (currentReqId === state.hydrationReqId) {
      state.isHydratingTelemetry = false;
      state.bufferedTelemetryEvents = [];
    }
  }
}

function initWebSocket() {
  if (state.socket) state.socket.disconnect();

  const socket = io({
    auth: { token: state.token }
  });

  state.socket = socket;

  socket.on('connect', () => {
    const dot = document.getElementById('socketDot');
    if (dot) {
      dot.className = 'status-dot-pulse';
      dot.style.background = 'var(--success)';
      dot.style.boxShadow = '0 0 8px var(--success)';
    }
    document.getElementById('socketText').textContent = 'Connected to Real-Time Room';
  });

  socket.on('disconnect', () => {
    const dot = document.getElementById('socketDot');
    if (dot) {
      dot.className = 'status-dot-pulse';
      dot.style.background = 'var(--danger)';
      dot.style.boxShadow = '0 0 8px var(--danger)';
    }
    document.getElementById('socketText').textContent = 'Disconnected';
  });

  socket.on('new_event', (event) => {
    if (state.isStreamPaused) return;

    state.eventCount++;
    document.getElementById('eventCounterTag').textContent = `${state.eventCount} Events Streamed`;

    if (state.isHydratingTelemetry) {
      state.bufferedTelemetryEvents.push(event);
    }
    appendTelemetryItem(event);
    loadDashboardData(); // Update overview metrics
  });

  socket.on('device_update', (device) => {
    loadDevices();
  });
}

function appendTelemetryItem(event, isHydration = false) {
  const container = document.getElementById('telemetryStreamList');
  if (!container) return;
  const filter = document.getElementById('eventTypeFilter')?.value || 'ALL';

  if (filter !== 'ALL' && event.eventType !== filter) return;

  const eventId = String(event.id || `evt_${Date.now()}_${Math.random()}`);
  state.eventsMap.set(eventId, event);

  // Clear placeholder if present
  if (container.children.length === 1 && (container.children[0].innerText.includes('Listening') || container.children[0].innerText.includes('cleared') || container.children[0].innerText.includes('No historical'))) {
    container.innerHTML = '';
  }

  const div = document.createElement('div');
  div.className = `stream-item ${event.eventType}`;
  
  let icon = 'fa-fingerprint';
  if (event.eventType === 'CHECK_IN') icon = 'fa-right-to-bracket';
  if (event.eventType === 'CHECK_OUT') icon = 'fa-right-from-bracket';
  if (event.eventType === 'DOOR_OPEN') icon = 'fa-door-open';
  if (event.eventType === 'DOOR_FORCED') icon = 'fa-triangle-exclamation';

  const historyBadge = isHydration
    ? `<span style="font-weight: normal; opacity: 0.65; font-size: 0.75rem; margin-left: 0.5rem; background: var(--bg-card); padding: 0.1rem 0.4rem; border-radius: 4px; border: 1px solid var(--border-color);"><i class="fa-solid fa-clock-rotate-left"></i> History</span>`
    : '';

  div.innerHTML = `
    <div class="stream-main">
      <div class="stream-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="stream-details">
        <h4>${escapeHtml(event.eventType)} - ${escapeHtml(event.employeeName || event.employeeId || 'Terminal Event')} ${historyBadge}</h4>
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

async function copyJsonInspectorContent() {
  const content = document.getElementById('jsonViewerContent')?.textContent;
  if (!content || content === 'Loading...') return;

  if (!navigator.clipboard?.writeText) {
    showToast('Clipboard API unavailable in this browser context', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    showToast('Raw JSON copied to clipboard!', 'success');
  } catch (err) {
    showToast('Failed to copy JSON: ' + (err.message || err), 'error');
  }
}

// Modal Helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    const firstInput = modal.querySelector('input:not([type="hidden"]), select');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    const form = modal.querySelector('form');
    if (form) clearFormErrors(form);
  }
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
