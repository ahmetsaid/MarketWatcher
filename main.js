const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, screen, shell, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');

const USER_DATA = app.getPath('userData');
const PORTFOLIO_PATH = path.join(USER_DATA, 'portfolio.json');
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');

const DEFAULT_SETTINGS = {
  refreshInterval: 30,
  notifications: true,
  alertSound: true,
  alertVolume: 30,
  fontSize: 'medium',
  compactMode: false,
  theme: 'tradingview',
  chartRange: '1d',
};
let mainWindow = null;
let tray = null;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 340,
    height: 560,
    x: screenW - 350,
    y: screenH - 570,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // Create a simple 16x16 tray icon
  const icon = nativeImage.createFromBuffer(createTrayIcon());
  tray = new Tray(icon);
  tray.setToolTip('Market Tracker');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Refresh',
      click: () => { if (mainWindow) mainWindow.webContents.send('force-refresh'); },
    },
    {
      label: 'Open portfolio.json',
      click: () => { shell.openPath(PORTFOLIO_PATH); },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createTrayIcon() {
  // Generate a tiny 16x16 PNG with a green chart-like icon
  // This is a minimal 16x16 RGBA buffer rendered to PNG via nativeImage
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4, 0);

  // Draw a simple green bar chart pattern
  const setPixel = (x, y, r, g, b, a) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (y * size + x) * 4;
      canvas[idx] = r; canvas[idx + 1] = g; canvas[idx + 2] = b; canvas[idx + 3] = a;
    }
  };

  // Simple upward arrow / chart bars
  const bars = [[3, 10], [5, 8], [7, 6], [9, 4], [11, 7], [13, 3]];
  for (const [x, top] of bars) {
    for (let y = top; y < 14; y++) {
      setPixel(x, y, 0, 200, 120, 255);
      setPixel(x - 1, y, 0, 200, 120, 255);
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size }).toPNG();
}

// --- IPC Handlers ---

ipcMain.handle('load-portfolio', () => {
  try {
    const data = fs.readFileSync(PORTFOLIO_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    const defaults = {
      positions: [
        { symbol: 'QQQ', shares: 10, avgCost: 380, alerts: [] },
        { symbol: 'SMH', shares: 15, avgCost: 220, alerts: [] },
        { symbol: 'SOXL', shares: 50, avgCost: 25, alerts: [] },
        { symbol: 'NVDA', shares: 20, avgCost: 450, alerts: [] },
        { symbol: 'BTC-USD', shares: 0.5, avgCost: 42000, alerts: [] },
        { symbol: 'MSTU', shares: 100, avgCost: 15, alerts: [] },
        { symbol: 'USDTRY=X', shares: 0, avgCost: 0, alerts: [] },
        { symbol: 'GC=F', shares: 0, avgCost: 0, alerts: [] },
      ],
    };
    fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
});

ipcMain.handle('save-portfolio', (_event, data) => {
  fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('load-settings', () => {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }
});

ipcMain.handle('save-settings', (_event, data) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  return true;
});

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

// --- Yahoo crumb flow for authenticated endpoints ---
let _cachedCrumb = null;
let _cachedCookie = null;
let _crumbFetchedAt = 0;

function fetchRaw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, useSessionCookies: true });
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v);
    let body = '';
    let setCookie = null;
    request.on('response', (response) => {
      setCookie = response.headers['set-cookie'] || null;
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => resolve({ status: response.statusCode, body, setCookie }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function getCrumb() {
  // Cache crumb for 1 hour
  if (_cachedCrumb && (Date.now() - _crumbFetchedAt) < 3600000) {
    return { crumb: _cachedCrumb, cookie: _cachedCookie };
  }
  try {
    // 1. Get cookie from fc.yahoo.com
    const fcResp = await fetchRaw('https://fc.yahoo.com/', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    let cookie = '';
    if (fcResp.setCookie) {
      const cookies = Array.isArray(fcResp.setCookie) ? fcResp.setCookie : [fcResp.setCookie];
      cookie = cookies.map(c => c.split(';')[0]).join('; ');
    }
    // 2. Get crumb
    const crumbResp = await fetchRaw('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
    });
    if (crumbResp.status === 200 && crumbResp.body && !crumbResp.body.includes('<')) {
      _cachedCrumb = crumbResp.body.trim();
      _cachedCookie = cookie;
      _crumbFetchedAt = Date.now();
      return { crumb: _cachedCrumb, cookie: _cachedCookie };
    }
  } catch { /* failed */ }
  return { crumb: null, cookie: null };
}

async function fetchJSONAuth(url) {
  const { crumb, cookie } = await getCrumb();
  const fullUrl = crumb ? url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(crumb) : url;
  const resp = await fetchRaw(fullUrl, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    ...(cookie ? { 'Cookie': cookie } : {}),
  });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
  return JSON.parse(resp.body);
}

const RANGE_INTERVALS = {
  '1d': '5m',
  '5d': '15m',
  '1mo': '1d',
  '3mo': '1d',
  '1y': '1wk',
};

// Symbols that are TRY-denominated and should be converted to USD
const TRY_TO_USD_SYMBOLS = new Set(['XU100.IS']);

ipcMain.handle('fetch-quotes', async (_event, symbols, chartRange) => {
  try {
    const range = chartRange || '1d';
    const interval = RANGE_INTERVALS[range] || '5m';
    const results = {};

    // If we need USD conversion, fetch USDTRY rate first
    let usdTryRate = null;
    const needsConversion = symbols.some(s => TRY_TO_USD_SYMBOLS.has(s));
    if (needsConversion) {
      try {
        const fxData = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/USDTRY=X?interval=1d&range=1d`);
        usdTryRate = fxData.chart.result[0].meta.regularMarketPrice;
      } catch { /* fallback: no conversion */ }
    }

    const promises = symbols.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
        const data = await fetchJSON(url);
        const meta = data.chart.result[0].meta;
        const closes = data.chart.result[0].indicators.quote[0].close;
        let sparkline = closes.filter(c => c != null);
        let currentPrice = meta.regularMarketPrice;
        let previousClose = meta.previousClose || meta.chartPreviousClose;

        // Convert TRY to USD
        if (TRY_TO_USD_SYMBOLS.has(sym) && usdTryRate) {
          currentPrice = currentPrice / usdTryRate;
          previousClose = previousClose / usdTryRate;
          sparkline = sparkline.map(v => v / usdTryRate);
        }

        const change = currentPrice - previousClose;
        const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;
        results[sym] = {
          price: currentPrice,
          previousClose,
          change,
          changePercent,
          sparkline,
          marketState: meta.currentTradingPeriod ? (
            Date.now() / 1000 >= meta.currentTradingPeriod.regular.start &&
            Date.now() / 1000 <= meta.currentTradingPeriod.regular.end
              ? 'REGULAR' : 'CLOSED'
          ) : 'CLOSED',
        };
      } catch {
        results[sym] = null;
      }
    });
    await Promise.all(promises);
    return results;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('show-notification', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body, silent: false });
    notif.show();
  }
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

// --- Symbol detail (breakout score, news, stats) ---

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeScore(d, isETF = false) {
  const breakdown = { technical: [], fundamental: [], momentum: [] };
  let score = 0;
  const maxScore = isETF ? 70 : 100;

  // TECHNICAL (40 pts)
  if (d.fiftyTwoWeekHigh && d.price) {
    const ratio = d.price / d.fiftyTwoWeekHigh;
    const ok = ratio >= 0.90;
    breakdown.technical.push({ label: 'Near 52w High', pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.technical.push({ label: 'Near 52w High', pts: 0, max: 10, na: true });

  if (d.sma50 != null && d.price) {
    const ok = d.price > d.sma50;
    breakdown.technical.push({ label: 'Above 50d MA', pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.technical.push({ label: 'Above 50d MA', pts: 0, max: 10, na: true });

  if (d.rsi != null) {
    const ok = d.rsi >= 50 && d.rsi <= 70;
    breakdown.technical.push({ label: `RSI 50-70 (${d.rsi.toFixed(0)})`, pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.technical.push({ label: 'RSI 50-70', pts: 0, max: 10, na: true });

  if (d.avgVolume && d.volume) {
    const ok = d.volume > d.avgVolume;
    breakdown.technical.push({ label: 'Volume above avg', pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.technical.push({ label: 'Volume above avg', pts: 0, max: 10, na: true });

  // FUNDAMENTAL (30 pts) - skip for ETFs
  if (!isETF) {
    if (d.targetMeanPrice && d.price) {
      const ok = d.targetMeanPrice > d.price;
      breakdown.fundamental.push({ label: 'Analyst target >', pts: ok ? 10 : 0, max: 10 });
      if (ok) score += 10;
    } else breakdown.fundamental.push({ label: 'Analyst target >', pts: 0, max: 10, na: true });

    if (d.forwardPE != null) {
      const ok = d.forwardPE > 0 && d.forwardPE < 40;
      breakdown.fundamental.push({ label: `Forward P/E < 40 (${d.forwardPE.toFixed(1)})`, pts: ok ? 10 : 0, max: 10 });
      if (ok) score += 10;
    } else breakdown.fundamental.push({ label: 'Forward P/E < 40', pts: 0, max: 10, na: true });

    if (d.epsGrowth != null) {
      const ok = d.epsGrowth > 0;
      breakdown.fundamental.push({ label: `EPS growth + (${(d.epsGrowth * 100).toFixed(1)}%)`, pts: ok ? 10 : 0, max: 10 });
      if (ok) score += 10;
    } else breakdown.fundamental.push({ label: 'EPS growth +', pts: 0, max: 10, na: true });
  }

  // MOMENTUM (30 pts)
  if (d.return1m != null) {
    const ok = d.return1m > 0;
    breakdown.momentum.push({ label: `1M return (${(d.return1m * 100).toFixed(1)}%)`, pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.momentum.push({ label: '1M return +', pts: 0, max: 10, na: true });

  if (d.return3m != null) {
    const ok = d.return3m > 0;
    breakdown.momentum.push({ label: `3M return (${(d.return3m * 100).toFixed(1)}%)`, pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.momentum.push({ label: '3M return +', pts: 0, max: 10, na: true });

  if (d.returnYtd != null) {
    const ok = d.returnYtd > 0;
    breakdown.momentum.push({ label: `YTD return (${(d.returnYtd * 100).toFixed(1)}%)`, pts: ok ? 10 : 0, max: 10 });
    if (ok) score += 10;
  } else breakdown.momentum.push({ label: 'YTD return +', pts: 0, max: 10, na: true });

  return { score, breakdown, maxScore };
}

ipcMain.handle('fetch-details', async (_event, symbol) => {
  try {
    // 1. Chart 1y for prices, volumes, returns, RSI, MA
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const chartData = await fetchJSON(chartUrl);
    const meta = chartData.chart.result[0].meta;
    const timestamps = chartData.chart.result[0].timestamp || [];
    const closes = (chartData.chart.result[0].indicators.quote[0].close || []).filter(c => c != null);
    const volumes = chartData.chart.result[0].indicators.quote[0].volume || [];

    const price = meta.regularMarketPrice;
    const fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh;
    const fiftyTwoWeekLow = meta.fiftyTwoWeekLow;
    const volume = meta.regularMarketVolume;

    const sma50 = calcSMA(closes, 50);
    const rsi = calcRSI(closes, 14);

    // Avg volume over last 30 days
    const recentVol = volumes.filter(v => v != null).slice(-30);
    const avgVolume = recentVol.length ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : null;

    // Returns
    const now = Date.now() / 1000;
    const day30 = now - 30 * 86400;
    const day90 = now - 90 * 86400;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;

    const findPriceAt = (ts) => {
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= ts) return closes[i];
      }
      return closes[0];
    };

    const p1m = findPriceAt(day30);
    const p3m = findPriceAt(day90);
    const pYtd = findPriceAt(yearStart);

    const return1m = p1m ? (price - p1m) / p1m : null;
    const return3m = p3m ? (price - p3m) / p3m : null;
    const returnYtd = pYtd ? (price - pYtd) / pYtd : null;

    // 2. quoteSummary for fundamentals + quoteType
    let forwardPE = null, trailingPE = null, targetMeanPrice = null, epsGrowth = null, longName = null;
    let quoteType = meta.instrumentType || null; // chart meta often has it too
    try {
      const qsUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics,financialData`;
      const qs = await fetchJSONAuth(qsUrl);
      const r = qs.quoteSummary && qs.quoteSummary.result && qs.quoteSummary.result[0];
      if (r) {
        if (r.summaryDetail) {
          forwardPE = (r.summaryDetail.forwardPE && r.summaryDetail.forwardPE.raw) || null;
          trailingPE = (r.summaryDetail.trailingPE && r.summaryDetail.trailingPE.raw) || null;
        }
        if (r.financialData) {
          targetMeanPrice = (r.financialData.targetMeanPrice && r.financialData.targetMeanPrice.raw) || null;
          epsGrowth = (r.financialData.earningsGrowth && r.financialData.earningsGrowth.raw) || null;
        }
        if (r.price) {
          longName = r.price.longName || r.price.shortName || null;
          quoteType = r.price.quoteType || quoteType;
        }
      }
    } catch { /* fundamentals unavailable */ }

    const isETF = quoteType === 'ETF';

    // 3. News
    let news = [];
    try {
      const newsUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=5`;
      const newsData = await fetchJSON(newsUrl);
      if (newsData.news) {
        news = newsData.news.slice(0, 5).map(n => ({
          title: n.title,
          publisher: n.publisher,
          link: n.link,
          pubTime: n.providerPublishTime,
        }));
      }
    } catch { /* news unavailable */ }

    const scoreData = {
      price, fiftyTwoWeekHigh, fiftyTwoWeekLow, volume, avgVolume,
      sma50, rsi, forwardPE, targetMeanPrice, epsGrowth,
      return1m, return3m, returnYtd,
    };
    const { score, breakdown, maxScore } = computeScore(scoreData, isETF);

    // Estimated breakout window (days)
    const momTotal = breakdown.momentum.reduce((s, i) => s + i.pts, 0);
    let breakoutWindow = null;
    if (momTotal >= 30) {
      if (rsi != null && rsi > 80) breakoutWindow = { min: 10, max: 20, note: 'correction likely first' };
      else if (rsi != null && rsi < 75) breakoutWindow = { min: 5, max: 10, note: null };
      else breakoutWindow = { min: 5, max: 15, note: null };
    } else if (momTotal >= 20) {
      breakoutWindow = { min: 20, max: 35, note: null };
    } else {
      breakoutWindow = { min: 35, max: null, note: null };
    }

    // Near 52w high → halve the window
    if (breakoutWindow && fiftyTwoWeekHigh && price && (price / fiftyTwoWeekHigh) >= 0.99) {
      breakoutWindow.min = Math.max(1, Math.round(breakoutWindow.min / 2));
      if (breakoutWindow.max) breakoutWindow.max = Math.max(2, Math.round(breakoutWindow.max / 2));
      breakoutWindow.near52w = true;
    }

    // Get actual daily change from a separate 1d chart call (1y meta gives year-ago prevClose)
    let dailyChange = 0, dailyChangePct = 0;
    try {
      const dailyUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const daily = await fetchJSON(dailyUrl);
      const dm = daily.chart.result[0].meta;
      const prev = dm.previousClose || dm.chartPreviousClose;
      if (prev) {
        dailyChange = dm.regularMarketPrice - prev;
        dailyChangePct = (dailyChange / prev) * 100;
      }
    } catch { /* fallback to 0 */ }

    return {
      symbol,
      longName,
      quoteType,
      isETF,
      price,
      change: dailyChange,
      changePercent: dailyChangePct,
      score,
      maxScore,
      breakdown,
      breakoutWindow,
      stats: {
        forwardPE, trailingPE, fiftyTwoWeekHigh, fiftyTwoWeekLow,
        avgVolume, volume, rsi, sma50, targetMeanPrice,
      },
      news,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') {
    // Don't quit, keep tray alive
  }
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
