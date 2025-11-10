# VWAP + GARCH Grid Trading Dashboard

A production-grade Next.js 14 + TypeScript trading dashboard that combines VWAP (Volume Weighted Average Price) analysis with GARCH volatility modeling for grid trading strategies.

## Features

- **Real-time Market Data**: Fetches live klines from Bybit Testnet API
- **GARCH Volatility**: Calculates daily expected move using GARCH(1,1) with EWMA fallback
- **VWAP Analysis**: Computes Volume Weighted Average Price from intraday OHLCV data
- **Grid Trading Strategy**: Generates grid levels around daily open with configurable subdivisions
- **Signal Detection**: Strict bias rules (Long only if open & close > VWAP, Short mirrored)
- **Trade Simulation**: In-session trade log with TP/SL simulation
- **Interactive Chart**: Live chart with overlays (VWAP, daily open, grid levels, entry/exit markers)
- **Multi-Symbol Support**: BTCUSDT, ETHUSDT, SOLUSDT

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **UI**: React Server Components + Client Components
- **Charts**: lightweight-charts
- **Validation**: Zod
- **Styling**: Tailwind CSS

## Project Structure

```
/app
  /api              # Serverless API routes
    /klines         # Fetch Bybit klines
    /vol            # Calculate GARCH volatility
    /levels         # Generate grid levels
    /signal         # Compute trading signals
    /order          # Place orders (Testnet)
  /page.tsx         # Main dashboard page
  /layout.tsx       # Root layout
  /globals.css      # Global styles
/components
  Chart.tsx         # TradingView-style chart component
  Cards.tsx         # KPI cards display
  TradeLog.tsx      # In-session trade log
/lib
  types.ts          # Zod schemas and TypeScript types
  bybit.ts          # Bybit REST API helpers
  vol.ts            # GARCH/EWMA volatility calculation
  strategy.ts       # Trading strategy logic
```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables** (optional, only needed for real Testnet orders):
   ```bash
   # .env.local
   NEXT_PUBLIC_DEFAULT_SYMBOL=BTCUSDT
   BYBIT_API_KEY=your_testnet_key
   BYBIT_API_SECRET=your_testnet_secret
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   npm start
   ```

## Strategy Rules

1. **Daily Expected Move (kPct)**: Calculated via GARCH(1,1) using last ~30 daily log returns. Falls back to EWMA if insufficient data. Clamped between 1% and 10%.

2. **Daily Open (dOpen)**: UTC 00:00 boundary - uses first candle's open after midnight UTC.

3. **Grid Levels**: ±k% around dOpen, split into N subdivisions on each side (U1..UN above, D1..DN below).

4. **VWAP**: Calculated from intraday OHLCV using typical price (O+H+C)/3 weighted by volume.

5. **Bias Rules**:
   - **Long**: Only if open > VWAP AND close > VWAP
   - **Short**: Only if open < VWAP AND close < VWAP

6. **Entry**: Bar touches a grid level on the bias side (low ≤ level ≤ high).

7. **TP/SL**: Single TP at next adjacent level toward target direction, single SL at previous level (≈1:1 RR). Extrapolates at edges.

8. **Breakeven**: If VWAP flips against open trade after entry, move stop to entry.

## API Routes

### GET `/api/klines`
Fetch klines from Bybit.

**Query Parameters**:
- `symbol` (default: BTCUSDT)
- `interval` (1|3|5|15|60|120|240, default: 5)
- `limit` (1-1000, default: 200)
- `testnet` (boolean, default: true)

### POST `/api/vol`
Calculate GARCH volatility.

**Body**:
```json
{
  "symbol": "BTCUSDT",
  "closes": [50000, 50100, ...]
}
```

### POST `/api/levels`
Generate grid levels.

**Body**:
```json
{
  "symbol": "BTCUSDT",
  "kPct": 0.02,
  "subdivisions": 5
}
```

### POST `/api/signal`
Compute trading signal.

**Body**:
```json
{
  "symbol": "BTCUSDT",
  "kPct": 0.02,
  "subdivisions": 5,
  "noTradeBandPct": 0.001,
  "candles": [...]
}
```

### POST `/api/order`
Place order (requires API keys).

**Body**:
```json
{
  "symbol": "BTCUSDT",
  "side": "Buy",
  "qty": 0.001,
  "price": 50000,
  "testnet": true
}
```

## Deployment

This project is Vercel-ready. Simply:

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables if using real API keys
4. Deploy

The serverless API routes will automatically work on Vercel's edge network.

## Future Enhancements

- WebSocket streaming for real-time updates
- Vercel KV for persistent trade history
- Order book visualization
- Risk sizing options (fixed %, Kelly criterion)
- Backtest endpoint for replaying historical klines

## License

MIT
