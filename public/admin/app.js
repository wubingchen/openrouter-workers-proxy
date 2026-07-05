const state = {
  csrfToken: '',
  admin: null,
  dashboard: null,
  tokens: [],
  upstreamKeys: [],
  audits: [],
  usage: [],
};

const els = {
  loginCard: document.getElementById('loginCard'),
  dashboardApp: document.getElementById('dashboardApp'),
  loginForm: document.getElementById('loginForm'),
  tokenForm: document.getElementById('tokenForm'),
  upstreamKeyForm: document.getElementById('upstreamKeyForm'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  summaryGrid: document.getElementById('summaryGrid'),
  loginStatus: document.getElementById('loginStatus'),
  tokenList: document.getElementById('tokenList'),
  tokenReveal: document.getElementById('tokenReveal'),
  upstreamKeyList: document.getElementById('upstreamKeyList'),
  auditList: document.getElementById('auditList'),
  usageList: document.getElementById('usageList'),
  toast: document.getElementById('toast'),
};

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.background = isError ? '#b42318' : '#111827';
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (state.csrfToken && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', state.csrfToken);
  }

  const response = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function renderSummary() {
  const summary = state.dashboard?.summary || {
    tokenCount: 0,
    activeUpstreamKeyCount: 0,
    auditLogCount: 0,
    totalTokensUsed: 0,
  };

  els.summaryGrid.innerHTML = [
    ['服务 Token', summary.tokenCount],
    ['可用上游 Key', summary.activeUpstreamKeyCount],
    ['审计日志', summary.auditLogCount],
    ['累计 token 消耗', summary.totalTokensUsed],
  ].map(([label, value]) => `
    <div class="summary-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderTokens() {
  if (!state.tokens.length) {
    els.tokenList.innerHTML = '<div class="item">暂无服务 Token。</div>';
    return;
  }

  els.tokenList.innerHTML = state.tokens.map((token) => {
    const actionLabel = token.status === 'active' ? '停用' : '启用';
    const nextStatus = token.status === 'active' ? 'disabled' : 'active';
    return `
      <div class="item">
        <strong>${token.name}</strong>
        <div class="meta">
          <span>状态：${token.status}</span>
          <span>来源：${token.appName}</span>
          <span>${token.appUrl}</span>
          <span>RPM：${token.rateLimitPerMinute}</span>
          <span>日上限：${token.dailyRequestLimit}</span>
        </div>
        <div class="actions">
          <button data-action="token-status" data-id="${token.id}" data-status="${nextStatus}" class="ghost">${actionLabel}</button>
          <button data-action="token-status" data-id="${token.id}" data-status="revoked" class="ghost danger">撤销</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderUpstreamKeys() {
  if (!state.upstreamKeys.length) {
    els.upstreamKeyList.innerHTML = '<div class="item">暂无上游 Key。</div>';
    return;
  }

  els.upstreamKeyList.innerHTML = state.upstreamKeys.map((item) => {
    const nextStatus = item.status === 'active' ? 'disabled' : 'active';
    return `
      <div class="item">
        <strong>${item.label}</strong>
        <div class="meta">
          <span>状态：${item.status}</span>
          <span>权重：${item.weight}</span>
          <span>失败次数：${item.failureCount}</span>
          <span>最后使用：${item.lastUsedAt || '-'}</span>
        </div>
        <div class="actions">
          <button data-action="upstream-status" data-id="${item.id}" data-status="${nextStatus}" class="ghost">${item.status === 'active' ? '停用' : '启用'}</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(container, columns, rows) {
  if (!rows.length) {
    container.innerHTML = '<div class="item">暂无数据。</div>';
    return;
  }
  const head = columns.map((col) => `<th>${col.label}</th>`).join('');
  const body = rows.map((row) => `
    <tr>
      ${columns.map((col) => `<td>${row[col.key] ?? '-'}</td>`).join('')}
    </tr>
  `).join('');
  container.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderAudits() {
  renderTable(els.auditList, [
    { key: 'created_at', label: '时间' },
    { key: 'event_type', label: '事件' },
    { key: 'app_name', label: '来源' },
    { key: 'model', label: '模型' },
    { key: 'status_code', label: '状态码' },
    { key: 'total_tokens', label: 'token' },
    { key: 'message', label: '说明' },
  ], state.audits);
}

function renderUsage() {
  renderTable(els.usageList, [
    { key: 'usage_date', label: '日期' },
    { key: 'token_id', label: 'Token ID' },
    { key: 'request_count', label: '请求数' },
    { key: 'total_tokens', label: 'token 消耗' },
    { key: 'updated_at', label: '更新时间' },
  ], state.usage);
}

function showDashboard() {
  els.loginCard.classList.add('hidden');
  els.dashboardApp.classList.remove('hidden');
  els.loginStatus.textContent = state.admin ? `已登录：${state.admin.id}` : '已登录';
}

async function hydrate() {
  try {
    const [me, dashboard, tokens, upstreamKeys, audits, usage] = await Promise.all([
      request('/me'),
      request('/dashboard'),
      request('/tokens'),
      request('/upstream-keys'),
      request('/audits'),
      request('/usage-daily'),
    ]);

    state.admin = me.admin;
    state.dashboard = dashboard;
    state.tokens = tokens.tokens || [];
    state.upstreamKeys = upstreamKeys.upstreamKeys || [];
    state.audits = audits.audits || dashboard.audits || [];
    state.usage = usage.usage || dashboard.usage || [];

    renderSummary();
    renderTokens();
    renderUpstreamKeys();
    renderAudits();
    renderUsage();
    showDashboard();
  } catch (error) {
    console.warn(error);
  }
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const bootstrapToken = document.getElementById('bootstrapToken').value.trim();
  try {
    const data = await request('/login', {
      method: 'POST',
      body: { bootstrapToken },
    });
    state.csrfToken = data.csrfToken;
    showToast('登录成功');
    await hydrate();
  } catch (error) {
    showToast(error.message, true);
  }
});

els.tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.tokenForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    const data = await request('/tokens', { method: 'POST', body: payload });
    els.tokenReveal.classList.remove('hidden');
    els.tokenReveal.innerHTML = `新 Token 已创建，请立即保存：<strong>${data.plainToken}</strong>`;
    els.tokenForm.reset();
    await hydrate();
    showToast('服务 Token 创建成功');
  } catch (error) {
    showToast(error.message, true);
  }
});

els.upstreamKeyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.upstreamKeyForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await request('/upstream-keys', { method: 'POST', body: payload });
    els.upstreamKeyForm.reset();
    await hydrate();
    showToast('上游 Key 已添加');
  } catch (error) {
    showToast(error.message, true);
  }
});

els.logoutBtn.addEventListener('click', async () => {
  try {
    await request('/logout', { method: 'POST' });
    window.location.reload();
  } catch (error) {
    showToast(error.message, true);
  }
});

els.refreshBtn.addEventListener('click', async () => {
  await hydrate();
  showToast('数据已刷新');
});

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const status = button.dataset.status;

  try {
    if (action === 'token-status') {
      await request(`/tokens/${id}/status`, { method: 'POST', body: { status } });
      showToast('服务 Token 状态已更新');
    }
    if (action === 'upstream-status') {
      await request(`/upstream-keys/${id}/status`, { method: 'POST', body: { status } });
      showToast('上游 Key 状态已更新');
    }
    await hydrate();
  } catch (error) {
    showToast(error.message, true);
  }
});

hydrate();
