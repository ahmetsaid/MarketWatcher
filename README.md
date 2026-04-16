# Market Watcher

A minimal, TradingView-style desktop watchlist widget built with Electron. Tracks stocks, ETFs, crypto, forex, and commodities in real-time with a frameless, always-on-top widget that sits in the corner of your screen.

## Features

### Core
- **Frameless, always-on-top widget** (340x560px, draggable, bottom-right launch)
- **Dark minimal UI** with TradingView-inspired aesthetic
- **Auto-refresh every 30s** (configurable: 10s / 15s / 30s / 60s / 2min)
- **Manual refresh + system tray** (Refresh / Open data folder / Quit)
- **Drag & drop reorder** for symbols
- **Color flash** on price updates (green up / red down)
- **Market open/closed** indicator with last updated timestamp

### Symbols Supported
- **Stocks** — any Yahoo Finance ticker (NVDA, AAPL, MSTU, ...)
- **ETFs** — QQQ, SMH, SOXL, SPY, ...
- **Crypto** — BTC-USD, ETH-USD, SOL-USD
- **Forex** — USDTRY=X, EURUSD=X, GBPUSD=X
- **Commodities** — GC=F (Gold/XAU), SI=F (Silver/XAG), CL=F (Oil)
- **Indices** — XU100.IS (BIST 100, auto-converted to USD)

Clean display names are applied automatically (e.g. `GC=F` → `XAUUSD`, `XU100.IS` → `BIST100`).

### Sparkline Charts
Minimal single-line intraday chart next to each symbol. Configurable range: **1D / 1W / 1M / 3M / 1Y**.

### Alert System
- Per-symbol price targets (above/below) or daily % change thresholds
- System notifications + subtle sound on trigger
- Alert badge on row until dismissed
- Persisted in `portfolio.json`

### Detail Panel (click a symbol)
Sliding panel from the right with:

**Breakout Score (0-100, or 0-70 for ETFs):**
- **Technical (40 pts)** — 52w high proximity, 50d MA position, RSI (50-70), volume vs average
- **Fundamental (30 pts, stocks only)** — Analyst target, Forward P/E, EPS growth
- **Momentum (30 pts)** — 1M / 3M / YTD returns

Color-coded: `70+` = **STRONG**, `40-70` = **NEUTRAL**, `<40` = **WEAK**.

**ETF Detection** — Automatically detects ETFs via `quoteType` and skips fundamental scoring (shows X/70).

**Key Stats** — P/E, 52w high/low, avg volume, RSI, 50d MA, analyst target.

**Latest News** — Top 5 headlines from Yahoo Finance (clickable, opens in browser).

### Settings Page (gear icon)
- **Data** — Refresh interval
- **Chart** — Sparkline time range
- **Alerts** — Notifications toggle, sound toggle, volume slider, test button
- **Appearance** — Font size, compact mode, 3 themes (TradingView Dark, Midnight Blue, Pure Black)

## Data Storage

Stored in your OS user data directory:
- **Windows**: `%APPDATA%\market-tracker\`
- **macOS**: `~/Library/Application Support/market-tracker/`
- **Linux**: `~/.config/market-tracker/`

Files:
- `portfolio.json` — symbols, positions, alerts
- `settings.json` — user preferences

## Tech Stack
- **Electron 33**
- **Yahoo Finance API** (chart, quoteSummary with crumb auth, news search)
- Vanilla JS + HTML + CSS (no framework)
- `electron-builder` for packaging

## Development

```bash
npm install
npm start          # run in dev
npm run build      # build Windows installer (NSIS)
```

The built installer lands in `dist/Market Tracker Setup 1.0.0.exe`.

## File Structure

```
main.js           # Electron main process, IPC handlers, tray, window
preload.js        # Context bridge
renderer.js       # UI logic, rendering, event handling
index.html        # Markup + styles
portfolio.json    # Default watchlist (seeded on first run)
settings.json     # Default settings (seeded on first run)
```

## Install (Windows)

Download the latest `Market Tracker Setup X.Y.Z.exe` from [Releases](https://github.com/ahmetsaid/MarketWatcher/releases).

> **Note:** Windows SmartScreen may warn "Unknown publisher" since the executable is unsigned. Click **More info** → **Run anyway** to proceed.

## License

MIT
