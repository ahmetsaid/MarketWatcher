// --- Display name mapping ---
const DISPLAY_NAMES = {
  'USDTRY=X': 'USDTRY',
  'EURTRY=X': 'EURTRY',
  'GBPTRY=X': 'GBPTRY',
  'GC=F': 'XAUUSD',
  'XU100.IS': 'BIST100',
  'SI=F': 'XAGUSD',
  'CL=F': 'CRUDE',
  'BTC-USD': 'BTCUSD',
  'ETH-USD': 'ETHUSD',
  'SOL-USD': 'SOLUSD',
  'EURUSD=X': 'EURUSD',
  'GBPUSD=X': 'GBPUSD',
  'USDJPY=X': 'USDJPY',
};

function displayName(symbol) {
  return DISPLAY_NAMES[symbol] || symbol;
}

// --- State ---
let portfolio = { positions: [] };
let settings = {};
let quotes = {};
let prevPrices = {};
let expandedSymbol = null;
let alertFormSymbol = null;
let triggeredAlerts = new Set();
let refreshInterval = null;
let currentView = 'watchlist';
let dragSrcIdx = null;

// --- DOM refs ---
const rowsContainer = document.getElementById('rowsContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const marketDot = document.getElementById('marketDot');
const statusDot = document.getElementById('statusDot');
const marketStatusText = document.getElementById('marketStatusText');
const lastUpdatedEl = document.getElementById('lastUpdated');
const pageTitle = document.getElementById('pageTitle');
const btnAdd = document.getElementById('btnAdd');
const btnRefresh = document.getElementById('btnRefresh');
const btnSettings = document.getElementById('btnSettings');
const addForm = document.getElementById('addForm');
const btnAddConfirm = document.getElementById('btnAddConfirm');
const btnAddCancel = document.getElementById('btnAddCancel');
const addSymbolInput = document.getElementById('addSymbol');
const viewWatchlist = document.getElementById('viewWatchlist');
const viewSettings = document.getElementById('viewSettings');

// Settings controls
const setChartRange = document.getElementById('setChartRange');
const setRefreshInterval = document.getElementById('setRefreshInterval');
const setNotifications = document.getElementById('setNotifications');
const setAlertSound = document.getElementById('setAlertSound');
const setAlertVolume = document.getElementById('setAlertVolume');
const volumeVal = document.getElementById('volumeVal');
const btnTestSound = document.getElementById('btnTestSound');
const setFontSize = document.getElementById('setFontSize');
const setCompactMode = document.getElementById('setCompactMode');
const themeCards = document.querySelectorAll('.theme-card');

// --- Formatting ---
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function drawSparkline(canvas, data, isPositive) {
  if (!data || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);

  const color = isPositive ? getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
    : getComputedStyle(document.documentElement).getPropertyValue('--red').trim();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((val, i) => {
    const x = i * step;
    const y = h - ((val - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function fmtChange(n) {
  if (n == null || isNaN(n)) return '--';
  const prefix = n >= 0 ? '+' : '';
  return prefix + n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '--';
  const prefix = n >= 0 ? '+' : '';
  return prefix + n.toFixed(2) + '%';
}

function colorClass(n) {
  if (n == null || isNaN(n) || n === 0) return '';
  return n > 0 ? 'positive' : 'negative';
}

// --- View toggle ---
function showView(view) {
  currentView = view;
  viewWatchlist.classList.toggle('active', view === 'watchlist');
  viewSettings.classList.toggle('active', view === 'settings');
  btnSettings.classList.toggle('active', view === 'settings');
  btnAdd.style.display = view === 'settings' ? 'none' : '';
  btnRefresh.style.display = view === 'settings' ? 'none' : '';
  pageTitle.textContent = view === 'settings' ? 'Settings' : 'Watchlist';
}

// --- Settings ---
async function loadSettings() {
  settings = await window.api.loadSettings();
  applySettings();
  populateSettingsUI();
}

function applySettings() {
  // Refresh interval
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(fetchAndRender, (settings.refreshInterval || 30) * 1000);

  // Font size
  document.body.classList.remove('font-small', 'font-large');
  if (settings.fontSize === 'small') document.body.classList.add('font-small');
  if (settings.fontSize === 'large') document.body.classList.add('font-large');

  // Compact mode
  document.body.classList.toggle('compact', !!settings.compactMode);

  // Theme
  document.body.classList.remove('theme-midnight', 'theme-pureblack');
  if (settings.theme === 'midnight') document.body.classList.add('theme-midnight');
  if (settings.theme === 'pureblack') document.body.classList.add('theme-pureblack');
}

function populateSettingsUI() {
  setChartRange.value = settings.chartRange || '1d';
  setRefreshInterval.value = settings.refreshInterval || 30;
  setNotifications.checked = settings.notifications !== false;
  setAlertSound.checked = settings.alertSound !== false;
  setAlertVolume.value = settings.alertVolume || 30;
  volumeVal.textContent = settings.alertVolume || 30;
  setFontSize.value = settings.fontSize || 'medium';
  setCompactMode.checked = !!settings.compactMode;

  themeCards.forEach(card => {
    card.classList.toggle('selected', card.dataset.theme === (settings.theme || 'tradingview'));
  });
}

async function saveSetting(key, value) {
  settings[key] = value;
  await window.api.saveSettings(settings);
  applySettings();
}

// --- Render ---
function render() {
  loadingIndicator.style.display = 'none';
  const existingRows = rowsContainer.querySelectorAll('.row');
  existingRows.forEach(r => r.remove());

  let marketState = 'CLOSED';

  portfolio.positions.forEach((pos, idx) => {
    const q = quotes[pos.symbol];
    const price = q ? q.price : null;
    const change = q ? q.change : null;
    const changePct = q ? q.changePercent : null;

    if (q && q.marketState === 'REGULAR') marketState = 'REGULAR';

    const prevPrice = prevPrices[pos.symbol];
    let flashClass = '';
    if (prevPrice != null && price != null && prevPrice !== price) {
      flashClass = price > prevPrice ? 'flash-green' : 'flash-red';
    }

    const hasTriggered = pos.alerts && pos.alerts.some((_, ai) => triggeredAlerts.has(`${pos.symbol}:${ai}`));

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="row-main ${flashClass}">
        <div class="row-symbol">
          <span class="alert-badge ${hasTriggered ? 'active' : ''}"></span>
          ${displayName(pos.symbol)}
        </div>
        <div class="row-spark"><canvas class="sparkline" width="44" height="22" data-symbol="${pos.symbol}"></canvas></div>
        <div class="row-price">${price != null ? fmt(price) : '--'}</div>
        <div class="row-chg"><span class="chg-pill ${colorClass(change)}">${fmtChange(change)}</span></div>
        <div class="row-chgpct ${colorClass(changePct)}">${fmtPct(changePct)}</div>
      </div>
      <div class="row-detail ${expandedSymbol === pos.symbol ? 'open' : ''}">
        <div class="detail-stats">
          <div class="detail-stat"><label>Prev Close</label><span>${q ? fmt(q.previousClose) : '--'}</span></div>
          <div class="detail-stat"><label>Day Change</label><span class="${colorClass(change)}">${fmtChange(change)}</span></div>
          <div class="detail-stat"><label>Day %</label><span class="${colorClass(changePct)}">${fmtPct(changePct)}</span></div>
        </div>
        <div class="detail-actions">
          <button class="btn-small btn-alert" data-symbol="${pos.symbol}">Set Alert</button>
          <button class="btn-small danger btn-remove" data-idx="${idx}">&times; Remove</button>
        </div>
        <div class="alert-form ${alertFormSymbol === pos.symbol ? 'open' : ''}" data-symbol="${pos.symbol}">
          <div class="alert-form-row">
            <select class="alert-type">
              <option value="price">Price</option>
              <option value="percent">% Change</option>
            </select>
            <select class="alert-dir">
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input type="number" class="alert-value" placeholder="Value" step="any" />
            <button class="btn-small btn-alert-save" data-idx="${idx}">Save</button>
          </div>
        </div>
        ${renderActiveAlerts(pos, idx)}
      </div>
    `;

    row.querySelector('.row-main').addEventListener('click', (e) => {
      if (row.classList.contains('was-dragged')) {
        row.classList.remove('was-dragged');
        return;
      }
      // Shift+click opens inline expand (for alerts/remove)
      if (e.shiftKey) {
        expandedSymbol = expandedSymbol === pos.symbol ? null : pos.symbol;
        if (expandedSymbol !== pos.symbol) alertFormSymbol = null;
        render();
      } else {
        // Normal click opens detail panel
        openDetailPanel(pos.symbol);
      }
    });

    // Drag to reorder
    row.setAttribute('draggable', 'true');
    row.dataset.idx = idx;

    row.addEventListener('dragstart', (e) => {
      dragSrcIdx = idx;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', idx);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      rowsContainer.querySelectorAll('.row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      row.classList.toggle('drag-over-top', e.clientY < midY);
      row.classList.toggle('drag-over-bottom', e.clientY >= midY);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      const fromIdx = dragSrcIdx;
      let toIdx = idx;
      if (fromIdx === toIdx) return;
      const item = portfolio.positions.splice(fromIdx, 1)[0];
      portfolio.positions.splice(toIdx, 0, item);
      window.api.savePortfolio(portfolio);
      // Mark as dragged to prevent click from firing
      row.classList.add('was-dragged');
      render();
    });

    row.querySelector('.btn-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removePosition(idx);
    });

    row.querySelector('.btn-alert').addEventListener('click', (e) => {
      e.stopPropagation();
      alertFormSymbol = alertFormSymbol === pos.symbol ? null : pos.symbol;
      render();
    });

    const alertSaveBtn = row.querySelector('.btn-alert-save');
    if (alertSaveBtn) {
      alertSaveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const form = row.querySelector('.alert-form');
        const type = form.querySelector('.alert-type').value;
        const direction = form.querySelector('.alert-dir').value;
        const value = parseFloat(form.querySelector('.alert-value').value);
        if (isNaN(value)) return;
        addAlert(idx, { type, direction, value });
      });
    }

    row.querySelectorAll('.alert-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggeredAlerts.delete(btn.dataset.alertkey);
        render();
      });
    });

    row.querySelectorAll('.alert-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAlert(parseInt(btn.dataset.posidx), parseInt(btn.dataset.alertidx));
      });
    });

    rowsContainer.appendChild(row);

    // Draw sparkline after DOM insert
    if (q && q.sparkline && q.sparkline.length >= 2) {
      const canvas = row.querySelector('.sparkline');
      if (canvas) drawSparkline(canvas, q.sparkline, change >= 0);
    }
  });

  const isOpen = marketState === 'REGULAR' || marketState === 'PRE' || marketState === 'POST';
  marketDot.className = 'titlebar-dot' + (isOpen ? '' : ' closed');
  statusDot.className = 'status-dot ' + (isOpen ? 'open' : 'closed');
  const stateLabels = { REGULAR: 'Market Open', PRE: 'Pre-Market', POST: 'After Hours', CLOSED: 'Market Closed', PREPRE: 'Pre-Market', POSTPOST: 'After Hours' };
  marketStatusText.textContent = stateLabels[marketState] || marketState;
  lastUpdatedEl.textContent = new Date().toLocaleTimeString();
}

function renderActiveAlerts(pos, posIdx) {
  if (!pos.alerts || pos.alerts.length === 0) return '';
  let html = '<div class="active-alerts">';
  pos.alerts.forEach((alert, ai) => {
    const key = `${pos.symbol}:${ai}`;
    const triggered = triggeredAlerts.has(key);
    const label = alert.type === 'price'
      ? `Price ${alert.direction} $${alert.value}`
      : `${alert.direction === 'above' ? '>' : '<'} ${alert.value}% daily change`;
    html += `
      <div class="active-alert" style="${triggered ? 'border-left: 2px solid var(--yellow);' : ''}">
        <span>${label}</span>
        <span>
          ${triggered ? `<span class="dismiss alert-dismiss" data-alertkey="${key}" title="Dismiss">&#10003;</span>` : ''}
          <span class="dismiss alert-remove" data-posidx="${posIdx}" data-alertidx="${ai}" title="Remove alert">&times;</span>
        </span>
      </div>
    `;
  });
  html += '</div>';
  return html;
}

// --- Data operations ---
async function addPosition(symbol) {
  symbol = symbol.toUpperCase().trim();
  if (!symbol) return;
  if (portfolio.positions.find(p => p.symbol === symbol)) return;
  portfolio.positions.push({ symbol, shares: 0, avgCost: 0, alerts: [] });
  await saveAndRefresh();
}

async function removePosition(idx) {
  const sym = portfolio.positions[idx].symbol;
  for (const key of [...triggeredAlerts]) {
    if (key.startsWith(sym + ':')) triggeredAlerts.delete(key);
  }
  portfolio.positions.splice(idx, 1);
  await saveAndRefresh();
}

async function addAlert(posIdx, alert) {
  portfolio.positions[posIdx].alerts.push(alert);
  alertFormSymbol = null;
  await saveAndRefresh();
}

async function removeAlert(posIdx, alertIdx) {
  const sym = portfolio.positions[posIdx].symbol;
  triggeredAlerts.delete(`${sym}:${alertIdx}`);
  portfolio.positions[posIdx].alerts.splice(alertIdx, 1);
  const newTriggered = new Set();
  for (const key of triggeredAlerts) {
    if (!key.startsWith(sym + ':')) newTriggered.add(key);
  }
  triggeredAlerts = newTriggered;
  await saveAndRefresh();
}

async function saveAndRefresh() {
  await window.api.savePortfolio(portfolio);
  await fetchAndRender();
}

// --- Alert checking ---
function checkAlerts() {
  portfolio.positions.forEach((pos) => {
    if (!pos.alerts) return;
    const q = quotes[pos.symbol];
    if (!q || q.price == null) return;

    pos.alerts.forEach((alert, ai) => {
      const key = `${pos.symbol}:${ai}`;
      if (triggeredAlerts.has(key)) return;

      let triggered = false;
      if (alert.type === 'price') {
        if (alert.direction === 'above' && q.price >= alert.value) triggered = true;
        if (alert.direction === 'below' && q.price <= alert.value) triggered = true;
      } else if (alert.type === 'percent') {
        if (alert.direction === 'above' && q.changePercent >= alert.value) triggered = true;
        if (alert.direction === 'below' && q.changePercent <= -alert.value) triggered = true;
      }

      if (triggered) {
        triggeredAlerts.add(key);
        const msg = alert.type === 'price'
          ? `${pos.symbol} price ${alert.direction} $${alert.value} (now $${fmt(q.price)})`
          : `${pos.symbol} daily change ${alert.direction} ${alert.value}% (now ${fmtPct(q.changePercent)})`;

        if (settings.notifications !== false) {
          window.api.showNotification({ title: `Alert: ${pos.symbol}`, body: msg });
        }
        if (settings.alertSound !== false) {
          playAlertSound();
        }
      }
    });
  });
}

function playAlertSound() {
  try {
    const vol = (settings.alertVolume || 30) / 100;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(vol * 0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* Audio not available */ }
}

// --- Fetch quotes ---
async function fetchAndRender() {
  const symbols = portfolio.positions.map(p => p.symbol);
  if (symbols.length === 0) { quotes = {}; render(); return; }

  const result = await window.api.fetchQuotes(symbols, settings.chartRange || '1d');
  if (result && !result.error) {
    prevPrices = {};
    for (const sym of symbols) {
      if (quotes[sym]) prevPrices[sym] = quotes[sym].price;
    }
    quotes = result;
    checkAlerts();
  }
  render();
}

// --- Event Listeners ---

// Settings toggle
btnSettings.addEventListener('click', () => {
  showView(currentView === 'settings' ? 'watchlist' : 'settings');
});

// Add symbol
btnAdd.addEventListener('click', () => {
  addForm.classList.toggle('open');
  if (addForm.classList.contains('open')) addSymbolInput.focus();
});

btnAddCancel.addEventListener('click', () => {
  addForm.classList.remove('open');
  addSymbolInput.value = '';
});

btnAddConfirm.addEventListener('click', async () => {
  const sym = addSymbolInput.value;
  if (!sym.trim()) return;
  await addPosition(sym);
  addForm.classList.remove('open');
  addSymbolInput.value = '';
});

addSymbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAddConfirm.click();
  if (e.key === 'Escape') btnAddCancel.click();
});

btnRefresh.addEventListener('click', () => {
  btnRefresh.style.transform = 'rotate(360deg)';
  setTimeout(() => { btnRefresh.style.transform = ''; }, 400);
  fetchAndRender();
});

// --- Settings event listeners ---
setChartRange.addEventListener('change', async () => {
  await saveSetting('chartRange', setChartRange.value);
  await fetchAndRender();
});

setRefreshInterval.addEventListener('change', () => {
  saveSetting('refreshInterval', parseInt(setRefreshInterval.value));
});

setNotifications.addEventListener('change', () => {
  saveSetting('notifications', setNotifications.checked);
});

setAlertSound.addEventListener('change', () => {
  saveSetting('alertSound', setAlertSound.checked);
});

setAlertVolume.addEventListener('input', () => {
  volumeVal.textContent = setAlertVolume.value;
});
setAlertVolume.addEventListener('change', () => {
  saveSetting('alertVolume', parseInt(setAlertVolume.value));
});

btnTestSound.addEventListener('click', playAlertSound);

setFontSize.addEventListener('change', () => {
  saveSetting('fontSize', setFontSize.value);
});

setCompactMode.addEventListener('change', () => {
  saveSetting('compactMode', setCompactMode.checked);
});

themeCards.forEach(card => {
  card.addEventListener('click', () => {
    themeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    saveSetting('theme', card.dataset.theme);
  });
});

// Tray refresh
if (window.api.onForceRefresh) {
  window.api.onForceRefresh(() => fetchAndRender());
}

// --- Detail Panel ---
const detailPanel = document.getElementById('detailPanel');
const detailSymbolEl = document.getElementById('detailSymbol');
const detailNameEl = document.getElementById('detailName');
const detailBodyEl = document.getElementById('detailBody');
const btnDetailBack = document.getElementById('btnDetailBack');

btnDetailBack.addEventListener('click', closeDetailPanel);

function closeDetailPanel() {
  detailPanel.classList.remove('open');
}

function fmtLargeNum(n) {
  if (n == null || isNaN(n)) return '--';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString('en-US');
}

function fmtTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString();
}

async function openDetailPanel(symbol) {
  detailSymbolEl.textContent = displayName(symbol);
  detailNameEl.textContent = '';
  detailBodyEl.innerHTML = '<div class="detail-loading"><span class="spinner"></span>Loading...</div>';
  detailPanel.classList.add('open');

  const data = await window.api.fetchDetails(symbol);
  if (!data || data.error) {
    detailBodyEl.innerHTML = `<div class="detail-loading">Failed to load data${data && data.error ? ': ' + data.error : ''}</div>`;
    return;
  }

  if (data.longName) detailNameEl.textContent = data.longName;

  renderDetailBody(data);
}

function renderOptions(opt) {
  if (!opt) return '';
  const expDate = new Date(opt.expiration * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const iv = opt.iv != null ? opt.iv.toFixed(1) + '%' : '--';
  const pcr = opt.pcRatio != null ? opt.pcRatio.toFixed(2) : '--';

  const strategyHtml = (title, o, annualReturn, subtitle) => {
    if (!o) return '';
    const annual = annualReturn != null ? `<span class="annual">${annualReturn.toFixed(1)}%/yr</span>` : '';
    return `
      <div class="opt-strategy">
        <div class="opt-strategy-title">
          <span>${title} <span style="color:var(--text-dim);font-size:10px;font-weight:400;">${subtitle}</span></span>
          ${annual}
        </div>
        <div class="opt-strategy-details">
          <div><label>Strike</label><span>${fmt(o.strike)}</span></div>
          <div><label>Bid</label><span>${fmt(o.bid)}</span></div>
          <div><label>Ask</label><span>${fmt(o.ask)}</span></div>
          <div><label>IV</label><span>${o.iv != null ? o.iv.toFixed(0) + '%' : '--'}</span></div>
          <div><label>Vol</label><span>${fmtLargeNum(o.volume)}</span></div>
          <div><label>OI</label><span>${fmtLargeNum(o.openInterest)}</span></div>
        </div>
      </div>
    `;
  };

  return `
    <div class="options-card">
      <div class="options-header">
        <span class="options-header-left">Options Summary</span>
        <span class="options-exp">Exp: ${expDate} (${opt.daysToExp}d)</span>
      </div>
      <div class="options-meta">
        <span>IV <strong>${iv}</strong></span>
        <span>P/C Ratio <strong>${pcr}</strong></span>
        <span>${opt.expirationCount} expirations</span>
      </div>
      ${strategyHtml('Covered Call', opt.ccCall, opt.ccAnnualReturn, '(5% OTM)')}
      ${strategyHtml('Cash Secured Put', opt.cspPut, opt.cspAnnualReturn, '(5% OTM)')}
    </div>
  `;
}

function renderBreakoutWindow(w) {
  if (!w) return '';
  const range = w.max ? `${w.min}-${w.max} days` : `${w.min}+ days`;
  const extras = [];
  if (w.note) extras.push(w.note);
  if (w.near52w) extras.push('near 52w high');
  const extraText = extras.length ? ` (${extras.join(', ')})` : '';
  return `<div class="breakout-prob" style="margin-top:2px;">Estimated breakout window: ${range}${extraText}</div>`;
}

function renderDetailBody(d) {
  const maxScore = d.maxScore || 100;
  const scorePct = (d.score / maxScore) * 100;
  const scoreLabel = scorePct >= 70 ? 'STRONG' : scorePct >= 40 ? 'NEUTRAL' : 'WEAK';
  const scoreClass = scorePct >= 70 ? 'strong' : scorePct >= 40 ? 'neutral' : 'weak';
  const breakoutProb = Math.round(scorePct);

  const techTotal = d.breakdown.technical.reduce((s, i) => s + i.pts, 0);
  const fundTotal = d.breakdown.fundamental.reduce((s, i) => s + i.pts, 0);
  const momTotal = d.breakdown.momentum.reduce((s, i) => s + i.pts, 0);

  const groupHtml = (title, total, max, items) => `
    <div class="score-group">
      <div class="score-group-header">
        <span>${title}</span>
        <span>${total}/${max}</span>
      </div>
      ${items.map(i => `
        <div class="score-item">
          <span class="score-item-label ${i.na ? 'na' : ''}">${i.label}${i.na ? ' (N/A)' : ''}</span>
          <span class="score-item-pts ${i.pts > 0 ? 'got' : 'miss'}">${i.pts > 0 ? '+' : ''}${i.pts}</span>
        </div>
      `).join('')}
    </div>
  `;

  const s = d.stats;
  const statsHtml = `
    <div class="stats-grid">
      ${d.isETF ? '' : `<div class="stat-item"><label>Forward P/E</label><span>${s.forwardPE != null ? s.forwardPE.toFixed(2) : '--'}</span></div>`}
      ${d.isETF ? '' : `<div class="stat-item"><label>Trailing P/E</label><span>${s.trailingPE != null ? s.trailingPE.toFixed(2) : '--'}</span></div>`}
      <div class="stat-item"><label>52w High</label><span>${s.fiftyTwoWeekHigh ? fmt(s.fiftyTwoWeekHigh) : '--'}</span></div>
      <div class="stat-item"><label>52w Low</label><span>${s.fiftyTwoWeekLow ? fmt(s.fiftyTwoWeekLow) : '--'}</span></div>
      <div class="stat-item"><label>Avg Volume</label><span>${s.avgVolume ? fmtLargeNum(s.avgVolume) : '--'}</span></div>
      <div class="stat-item"><label>Volume</label><span>${s.volume ? fmtLargeNum(s.volume) : '--'}</span></div>
      <div class="stat-item"><label>RSI (14)</label><span>${s.rsi != null ? s.rsi.toFixed(1) : '--'}</span></div>
      <div class="stat-item"><label>50d MA</label><span>${s.sma50 != null ? fmt(s.sma50) : '--'}</span></div>
      ${d.isETF ? '' : `<div class="stat-item" style="grid-column:1/-1;"><label>Analyst Target</label><span>${s.targetMeanPrice ? fmt(s.targetMeanPrice) : '--'}</span></div>`}
    </div>
  `;

  const newsHtml = d.news && d.news.length ? `
    <div class="news-list">
      <div class="news-title">Latest News</div>
      ${d.news.map(n => `
        <div class="news-item" data-link="${n.link}">
          <div class="news-headline">${n.title}</div>
          <div class="news-meta">${n.publisher || ''} ${n.pubTime ? '· ' + fmtTimeAgo(n.pubTime) : ''}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  detailBodyEl.innerHTML = `
    <div class="detail-price-row">
      <div class="detail-price-big">${fmt(d.price)}</div>
      <div class="detail-price-chg ${colorClass(d.change)}">${fmtChange(d.change)} (${fmtPct(d.changePercent)})</div>
    </div>

    <div class="score-card">
      <div class="score-title">Breakout Score${d.isETF ? ' <span class="etf-badge">ETF</span>' : ''}</div>
      <div class="score-display">
        <div class="score-ring">
          <div>
            <span class="score-number">${d.score}</span><span class="score-suffix">/${maxScore}</span>
          </div>
        </div>
        <div>
          <div class="score-label ${scoreClass}">${scoreLabel}</div>
          <div class="breakout-prob">Breakout probability: ${breakoutProb}%</div>
          ${renderBreakoutWindow(d.breakoutWindow)}
          ${d.isETF ? '<div class="breakout-prob" style="margin-top:2px;">ETF (no fundamentals)</div>' : ''}
        </div>
      </div>
      <div class="score-bar"><div class="score-bar-fill ${scoreClass}" style="width:${scorePct}%;"></div></div>
      ${groupHtml('Technical', techTotal, 50, d.breakdown.technical)}
      ${d.isETF ? '' : groupHtml('Fundamental', fundTotal, 30, d.breakdown.fundamental)}
      ${groupHtml('Momentum', momTotal, 30, d.breakdown.momentum)}
    </div>

    <div class="section-title">Key Stats</div>
    ${statsHtml}

    ${renderOptions(d.options)}

    ${newsHtml}

    <div class="detail-footer-actions">
      <button class="btn-small btn-detail-alert" data-symbol="${d.symbol}">Set Alert</button>
      <button class="btn-small danger btn-detail-remove" data-symbol="${d.symbol}">&times; Remove Symbol</button>
    </div>
  `;

  // Wire news clicks
  detailBodyEl.querySelectorAll('.news-item').forEach(item => {
    item.addEventListener('click', () => {
      const link = item.dataset.link;
      if (link) window.api.openExternal(link);
    });
  });

  // Remove button
  const removeBtn = detailBodyEl.querySelector('.btn-detail-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      const sym = removeBtn.dataset.symbol;
      const idx = portfolio.positions.findIndex(p => p.symbol === sym);
      if (idx === -1) return;
      closeDetailPanel();
      await removePosition(idx);
    });
  }

  // Alert button (opens inline expanded view below the row)
  const alertBtn = detailBodyEl.querySelector('.btn-detail-alert');
  if (alertBtn) {
    alertBtn.addEventListener('click', () => {
      const sym = alertBtn.dataset.symbol;
      expandedSymbol = sym;
      alertFormSymbol = sym;
      closeDetailPanel();
      render();
    });
  }
}

// Close panel on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detailPanel.classList.contains('open')) {
    closeDetailPanel();
  }
});

// --- Init ---
async function init() {
  portfolio = await window.api.loadPortfolio();
  await loadSettings();
  await fetchAndRender();
}

init();
