'use strict';

const $ = (id) => document.getElementById(id);
const fmt = (n) => {
  if (!isFinite(n)) n = 0;
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
// Compact breakdown formatter: "$1.5K" / "$29.4K" / "$305" — no cents, unsigned (caller adds sign/color)
const fmtBd = (n) => {
  const v = Math.abs(+n) || 0;
  if (v >= 1000) return '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
};
const num = (id) => {
  const v = parseFloat($(id).value);
  return isFinite(v) ? v : 0;
};
const daysBetween = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T16:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.ceil((d - now) / 86400000);
};

const FIELDS = [
  'symbol', 'positionType', 'strike', 'expiration', 'shares',
  'costBasis', 'originalPremium', 'currentAsk',
  'newStrike', 'newExpiration', 'newPremium',
];

let state = {
  portfolio: [],
  alwaysOnTop: false,
};

// === Core calculations ===
function calc() {
  const strike = num('strike');
  const shares = num('shares');
  const costBasis = num('costBasis');
  const originalPremium = num('originalPremium');
  const currentAsk = num('currentAsk');
  const newStrike = num('newStrike');
  const newPremium = num('newPremium');
  const positionType = $('positionType').value;

  // Totals
  const buybackCost = currentAsk * shares;
  const origPremTotal = originalPremium * shares;
  const newPremTotal = newPremium * shares;
  const netRollCost = buybackCost - origPremTotal;  // per spec: buyback - orig premium
  const netCashToRoll = buybackCost - newPremTotal; // true cash outlay

  $('c-buyback').textContent = fmt(buybackCost);
  $('c-origprem').textContent = fmt(origPremTotal);
  $('c-netrollcost').textContent = fmt(netRollCost);
  $('c-netrollcost').className = 'val ' + (netRollCost <= 0 ? 'positive' : 'negative');

  $('r-buyback').textContent = fmt(buybackCost);
  $('r-newprem').textContent = fmt(newPremTotal);
  $('r-netcash').textContent = fmt(netCashToRoll);
  $('r-netcash').className = 'val ' + (netCashToRoll <= 0 ? 'positive' : 'negative');
  $('r-rollcost').textContent = fmt(netRollCost);

  // Assignment analysis — symmetric cash accounting (both scenarios include origPrem)
  //   assignedNow    = (strike − costBasis)×shares + origPrem
  //   rolledAssigned = (newStrike − costBasis)×shares + origPrem + newPrem − buyback
  //   diff simplifies to (newStrike − strike)×shares − netCashToRoll
  const assignedNow = (strike - costBasis) * shares + origPremTotal;
  const rolledAssigned = (newStrike - costBasis) * shares + origPremTotal + newPremTotal - buybackCost;
  const diff = rolledAssigned - assignedNow;

  $('a-now').textContent = fmt(assignedNow);
  $('a-now').className = 'val ' + (assignedNow >= 0 ? 'positive' : 'negative');
  $('a-rolled').textContent = fmt(rolledAssigned);
  $('a-rolled').className = 'val ' + (rolledAssigned >= 0 ? 'positive' : 'negative');
  $('a-diff').textContent = fmt(diff);
  $('a-diff').className = 'val ' + (diff >= 0 ? 'positive' : 'negative');

  // Breakdown labels — only show once user has entered meaningful data
  const hasNow = strike > 0 && shares > 0;
  const hasRoll = hasNow && newStrike > 0 && (buybackCost > 0 || newPremTotal > 0);
  const stockNow = (strike - costBasis) * shares;
  const stockRolled = (newStrike - costBasis) * shares;
  const stockImprove = (newStrike - strike) * shares;

  $('a-now-bd').innerHTML = hasNow
    ? `<span class="plus">+${fmtBd(stockNow)}</span> stock <span class="plus">+${fmtBd(origPremTotal)}</span> orig prem`
    : '';

  $('a-rolled-bd').innerHTML = hasRoll
    ? `<span class="plus">+${fmtBd(stockRolled)}</span> stock <span class="plus">+${fmtBd(origPremTotal)}</span> orig <span class="plus">+${fmtBd(newPremTotal)}</span> new <span class="minus">−${fmtBd(buybackCost)}</span> buyback`
    : '';

  $('a-diff-bd').innerHTML = hasRoll
    ? `<span class="${stockImprove >= 0 ? 'plus' : 'minus'}">${stockImprove >= 0 ? '+' : '−'}${fmtBd(Math.abs(stockImprove))}</span> strike <span class="${netCashToRoll <= 0 ? 'plus' : 'minus'}">${netCashToRoll <= 0 ? '+' : '−'}${fmtBd(Math.abs(netCashToRoll))}</span> cash`
    : '';

  // Days to expiration pills
  const dExp = daysBetween($('expiration').value);
  $('days-to-exp-pill').textContent = dExp == null ? '—' : (dExp + ' DTE');
  const nDExp = daysBetween($('newExpiration').value);
  $('new-days-to-exp-pill').textContent = nDExp == null ? '—' : (nDExp + ' DTE');

  // Decision
  const box = $('decision-box');
  const emoji = $('decision-emoji');
  const verdict = $('decision-verdict');
  const reason = $('decision-reason');

  box.classList.remove('green', 'yellow', 'red');
  const hasData = (strike > 0 && shares > 0 && newStrike > 0 && (currentAsk > 0 || newPremium > 0));
  if (!hasData) {
    emoji.textContent = '⚪';
    verdict.textContent = 'ENTER VALUES';
    reason.textContent = 'Fill in current position and roll target to see recommendation';
  } else if (netCashToRoll > 0 && diff < 0) {
    box.classList.add('red');
    emoji.textContent = '🔴';
    verdict.textContent = 'HOLD / ACCEPT ASSIGNMENT';
    reason.textContent = `Rolling costs ${fmt(netCashToRoll)} and loses ${fmt(Math.abs(diff))} vs current. Not worth it.`;
  } else if (diff > 500) {
    box.classList.add('green');
    emoji.textContent = '🟢';
    verdict.textContent = 'ROLL';
    reason.textContent = `Rolling improves outcome by ${fmt(diff)}${nDExp != null ? ` over ${nDExp} days` : ''}. Go for it.`;
  } else if (diff < -500) {
    box.classList.add('red');
    emoji.textContent = '🔴';
    verdict.textContent = 'HOLD / ACCEPT ASSIGNMENT';
    reason.textContent = `Rolling loses ${fmt(Math.abs(diff))} vs letting it assign. Not recommended.`;
  } else {
    box.classList.add('yellow');
    emoji.textContent = '🟡';
    verdict.textContent = 'NEUTRAL';
    reason.textContent = `Difference is only ${fmt(diff)}. Consider IV, sentiment, tax impact.`;
  }

  // Ignore positionType for now beyond displaying it; spec formulas are symmetric per instructions.
  // Recompute portfolio totals as cost basis may have changed.
  renderPortfolioTotals();
}

// === Portfolio table ===
function emptyRow() {
  return { symbol: 'SOXL', type: 'CC', strike: 0, expiration: '', shares: 100, premReceived: 0, currentValue: 0, rollCostEst: 0 };
}

// Short = we wrote the option and want to buy it back → use ASK
// Long  = we bought the option and want to sell it back → use BID
const TYPE_META = {
  CC:   { side: 'call', short: true,  label: 'CC',   title: 'Covered Call (short call)' },
  CSP:  { side: 'put',  short: true,  label: 'CSP',  title: 'Cash Secured Put (short put)' },
  Call: { side: 'call', short: false, label: 'Call', title: 'Long Call' },
  Put:  { side: 'put',  short: false, label: 'Put',  title: 'Long Put' },
};

function addRow(data) {
  state.portfolio.push(data || emptyRow());
  renderPortfolio();
  saveState(true);
}

function removeRow(idx) {
  state.portfolio.splice(idx, 1);
  renderPortfolio();
  saveState(true);
}

function renderPortfolio() {
  const tbody = $('portfolio-tbody');
  tbody.innerHTML = '';
  state.portfolio.forEach((p, idx) => {
    const tr = document.createElement('tr');
    const netKz = (p.premReceived || 0) - (p.currentValue || 0);
    const askDisplay = (p.askPerShare != null && p.askPerShare > 0)
      ? `<span class="ask-live" title="${p.askUpdatedAt ? 'Updated ' + new Date(p.askUpdatedAt).toLocaleTimeString() : ''}">${p.askPerShare.toFixed(2)}</span>`
      : `<span class="ask-empty">—</span>`;
    const pType = p.type && TYPE_META[p.type] ? p.type : 'CC';
    const typeOpts = Object.keys(TYPE_META).map(t =>
      `<option value="${t}" ${t === pType ? 'selected' : ''} title="${TYPE_META[t].title}">${TYPE_META[t].label}</option>`
    ).join('');
    const typeClass = TYPE_META[pType].short ? 'type-short' : 'type-long';
    tr.innerHTML = `
      <td><input type="text" data-idx="${idx}" data-k="symbol" value="${escapeHtml(p.symbol || '')}"></td>
      <td><select class="type-select ${typeClass}" data-idx="${idx}" data-k="type" title="${TYPE_META[pType].title}">${typeOpts}</select></td>
      <td><input type="number" step="0.01" data-idx="${idx}" data-k="strike" value="${p.strike || 0}"></td>
      <td><input type="date" data-idx="${idx}" data-k="expiration" value="${p.expiration || ''}"></td>
      <td><input type="number" step="1" data-idx="${idx}" data-k="shares" value="${p.shares || 0}"></td>
      <td><input type="number" step="0.01" data-idx="${idx}" data-k="premReceived" value="${p.premReceived || 0}"></td>
      <td class="ask-cell">${askDisplay}</td>
      <td><input type="number" step="0.01" data-idx="${idx}" data-k="currentValue" value="${p.currentValue || 0}"></td>
      <td class="${netKz >= 0 ? 'positive' : 'negative'}">${fmt(netKz)}</td>
      <td><input type="number" step="0.01" data-idx="${idx}" data-k="rollCostEst" value="${p.rollCostEst || 0}"></td>
      <td style="white-space:nowrap;">
        <button class="refresh-btn" data-refresh="${idx}" title="Fetch live ask">&#8635;</button>
        <button class="del-btn" data-del="${idx}" title="Remove">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.idx, 10);
      const k = e.target.dataset.k;
      const v = e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
      state.portfolio[i][k] = v;
      renderPortfolioTotals();
      scheduleAutoSave();
    });
  });
  tbody.querySelectorAll('select.type-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.idx, 10);
      state.portfolio[i].type = e.target.value;
      renderPortfolio();       // re-render to update color / title
      scheduleAutoSave();
    });
  });
  tbody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      removeRow(parseInt(e.target.dataset.del, 10));
    });
  });
  tbody.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.currentTarget.dataset.refresh, 10);
      refreshRow(i);
    });
  });
  renderPortfolioTotals();
}

// === Live refresh of Current Value from Yahoo ===
async function refreshRow(idx) {
  const p = state.portfolio[idx];
  if (!p) return;
  if (!p.symbol || !p.strike || !p.expiration) {
    toast('⚠ Row needs symbol, strike, expiration');
    return;
  }
  const meta = TYPE_META[p.type] || TYPE_META.CC;
  const tbody = $('portfolio-tbody');
  const tr = tbody.children[idx];
  const btn = tr && tr.querySelector('.refresh-btn');
  if (tr) tr.classList.add('refreshing');
  if (btn) btn.classList.add('spinning');

  try {
    const q = await window.api.fetchOptionQuote({
      symbol: p.symbol,
      expDate: p.expiration,
      strike: parseFloat(p.strike),
      type: meta.side, // 'call' or 'put'
    });
    if (!q || q.error) {
      toast('⚠ ' + (q && q.error ? q.error : 'Fetch failed'));
      return false;
    }
    // Short (CC/CSP) → we buy back at ASK.  Long (Call/Put) → we sell back at BID.
    // Fall back to last if primary side is 0 (illiquid).
    const primary = meta.short ? q.ask : q.bid;
    const perShare = (primary && primary > 0) ? primary : (q.last || 0);
    p.askPerShare = perShare;
    p.askUpdatedAt = Date.now();
    p.currentValue = Math.round(perShare * (p.shares || 0) * 100) / 100;
    // Keep matched strike if Yahoo snapped it
    if (q.matchedStrike && Math.abs(q.matchedStrike - parseFloat(p.strike)) > 0.001) {
      // Don't overwrite user's typed strike; just note it in toast once
    }
    renderPortfolio();
    // Flash the updated cell
    const newTr = $('portfolio-tbody').children[idx];
    if (newTr) {
      const cv = newTr.querySelector('[data-k="currentValue"]');
      if (cv) {
        cv.classList.add('live-flash');
        setTimeout(() => cv.classList.remove('live-flash'), 900);
      }
    }
    saveState(true);
    return true;
  } catch (err) {
    toast('⚠ ' + err.message);
    return false;
  } finally {
    // tr may have been re-rendered; guard
    const stillTr = $('portfolio-tbody').children[idx];
    if (stillTr) stillTr.classList.remove('refreshing');
  }
}

async function refreshAll() {
  if (!state.portfolio.length) { toast('No rows to refresh'); return; }
  const btn = $('btn-refresh-all');
  btn.disabled = true;
  const origText = btn.textContent;
  let ok = 0, fail = 0;
  for (let i = 0; i < state.portfolio.length; i++) {
    btn.textContent = `⟳ ${i + 1}/${state.portfolio.length}`;
    const success = await refreshRow(i);
    if (success) ok++; else fail++;
    // gentle spacing between Yahoo requests
    if (i < state.portfolio.length - 1) await new Promise(r => setTimeout(r, 350));
  }
  btn.textContent = origText;
  btn.disabled = false;
  toast(`✓ Live: ${ok} ok${fail ? `, ${fail} failed` : ''}`);
}

function renderPortfolioTotals() {
  const costBasis = num('costBasis');
  let totShares = 0, totPrim = 0, totValue = 0, totNetKz = 0, totRollCost = 0, totAssignProceeds = 0;
  for (const p of state.portfolio) {
    const sh = p.shares || 0;
    totShares += sh;
    totPrim += p.premReceived || 0;
    totValue += p.currentValue || 0;
    totNetKz += (p.premReceived || 0) - (p.currentValue || 0);
    totRollCost += p.rollCostEst || 0;
    totAssignProceeds += (p.strike || 0) * sh;
  }
  const totCostBasis = costBasis * totShares;
  const netKarAssign = (totAssignProceeds - totCostBasis) + totPrim;
  const netKarRoll = netKarAssign - totRollCost;

  $('t-shares').textContent = totShares.toLocaleString();
  $('t-prim').textContent = fmt(totPrim);
  $('t-value').textContent = fmt(totValue);
  $('t-netkz').textContent = fmt(totNetKz);
  $('t-netkz').className = totNetKz >= 0 ? 'positive' : 'negative';
  $('t-rollcost').textContent = fmt(totRollCost);

  $('s-assign-gelir').textContent = fmt(totAssignProceeds);
  $('s-maliyet-bazi').textContent = fmt(totCostBasis);
  $('s-roll-maliyet').textContent = fmt(totRollCost);
  $('s-net-roll').textContent = fmt(netKarRoll);
  $('s-net-assign').textContent = fmt(netKarAssign);

  // Breakdowns — show only when we have positions
  const stockGain = totAssignProceeds - totCostBasis;
  const hasData = totShares > 0;
  $('s-net-assign-bd').innerHTML = hasData
    ? `<span class="${stockGain >= 0 ? 'plus' : 'minus'}">${stockGain >= 0 ? '+' : '−'}${fmtBd(Math.abs(stockGain))}</span> stock <span class="plus">+${fmtBd(totPrim)}</span> prem`
    : '';
  $('s-net-roll-bd').innerHTML = hasData
    ? `<span class="${stockGain >= 0 ? 'plus' : 'minus'}">${stockGain >= 0 ? '+' : '−'}${fmtBd(Math.abs(stockGain))}</span> stock <span class="plus">+${fmtBd(totPrim)}</span> prem <span class="${totRollCost > 0 ? 'minus' : ''}">${totRollCost > 0 ? '−' + fmtBd(totRollCost) : '$0'}</span> roll`
    : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// === Theme sync with MarketTracker settings ===
async function applyTheme() {
  try {
    const settings = await window.api.loadSettings();
    document.body.classList.remove('theme-midnight', 'theme-pureblack');
    if (settings && settings.theme === 'midnight') document.body.classList.add('theme-midnight');
    else if (settings && settings.theme === 'pureblack') document.body.classList.add('theme-pureblack');
    // 'tradingview' (default) requires no class
  } catch { /* fall back to default theme */ }
}

// === Persistence ===
async function loadState() {
  const data = await window.api.loadRolls();
  if (data.current) {
    for (const k of Object.keys(data.current)) {
      const el = $(k);
      if (el) el.value = data.current[k];
    }
  }
  if (data.target) {
    if (data.target.newStrike != null) $('newStrike').value = data.target.newStrike;
    if (data.target.newExpiration != null) $('newExpiration').value = data.target.newExpiration;
    if (data.target.newPremium != null) $('newPremium').value = data.target.newPremium;
  }
  state.portfolio = Array.isArray(data.portfolio) ? data.portfolio : [];
  state.alwaysOnTop = !!data.alwaysOnTop;
  if (state.alwaysOnTop) {
    $('btn-pin').classList.add('active');
    window.api.rollSetAlwaysOnTop(true);
  }
  renderPortfolio();
  calc();
}

let autoSaveTimer = null;
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { saveState(true); }, 600);
}

async function saveState(silent) {
  const data = {
    current: {
      symbol: $('symbol').value,
      positionType: $('positionType').value,
      strike: num('strike'),
      expiration: $('expiration').value,
      shares: num('shares'),
      costBasis: num('costBasis'),
      originalPremium: num('originalPremium'),
      currentAsk: num('currentAsk'),
    },
    target: {
      newStrike: num('newStrike'),
      newExpiration: $('newExpiration').value,
      newPremium: num('newPremium'),
    },
    portfolio: state.portfolio,
    alwaysOnTop: state.alwaysOnTop,
  };
  await window.api.saveRolls(data);
  if (!silent) toast('💾 Saved to rolls.json');
}

// === Copy summary ===
function buildSummary() {
  const sym = $('symbol').value || '—';
  const pos = $('positionType').value === 'cc' ? 'Covered Call' : 'Cash Secured Put';
  const lines = [
    `${sym} ${pos} Roll Analysis`,
    `────────────────────────`,
    `Current: Strike $${num('strike').toFixed(2)} exp ${$('expiration').value || '—'}, ${num('shares')} shares`,
    `Cost basis: $${num('costBasis').toFixed(2)}/sh, orig premium $${num('originalPremium').toFixed(2)}/sh`,
    `Current ask: $${num('currentAsk').toFixed(2)}/sh → buyback ${$('c-buyback').textContent}`,
    ``,
    `Roll to: Strike $${num('newStrike').toFixed(2)} exp ${$('newExpiration').value || '—'}`,
    `New premium: $${num('newPremium').toFixed(2)}/sh`,
    `Net cash to roll: ${$('r-netcash').textContent}`,
    ``,
    `If assigned now: ${$('a-now').textContent}`,
    `If rolled & assigned: ${$('a-rolled').textContent}`,
    `Difference: ${$('a-diff').textContent}`,
    ``,
    `VERDICT: ${$('decision-emoji').textContent} ${$('decision-verdict').textContent}`,
    `${$('decision-reason').textContent}`,
  ];
  return lines.join('\n');
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(buildSummary());
    toast('📋 Copied to clipboard');
  } catch {
    toast('⚠ Copy failed');
  }
}

// === Toast ===
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// === Wire up ===
function init() {
  FIELDS.forEach(id => {
    const el = $(id);
    if (!el) return;
    const onChange = () => { calc(); scheduleAutoSave(); };
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  });

  $('btn-calc').addEventListener('click', calc);
  $('btn-save').addEventListener('click', () => saveState(false));
  $('btn-copy').addEventListener('click', copySummary);
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset all current & roll target fields?')) return;
    ['strike', 'originalPremium', 'currentAsk', 'newStrike', 'newPremium'].forEach(id => $(id).value = 0);
    $('expiration').value = '';
    $('newExpiration').value = '';
    calc();
  });
  $('btn-add-row').addEventListener('click', () => addRow());
  $('btn-refresh-all').addEventListener('click', () => refreshAll());

  $('btn-pin').addEventListener('click', () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    $('btn-pin').classList.toggle('active', state.alwaysOnTop);
    window.api.rollSetAlwaysOnTop(state.alwaysOnTop);
    saveState(true);
  });
  $('btn-min').addEventListener('click', () => window.api.rollWindowControl('minimize'));
  $('btn-close').addEventListener('click', () => window.api.rollWindowControl('close'));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      calc();
      toast('🔄 Recalculated');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveState(false);
    }
  });

  applyTheme();
  loadState();

  // Re-sync theme when window regains focus (user may have changed it in MarketTracker)
  window.addEventListener('focus', applyTheme);
}

document.addEventListener('DOMContentLoaded', init);
