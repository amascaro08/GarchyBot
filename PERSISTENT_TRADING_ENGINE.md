# Persistent Trading Engine Implementation Guide

## Overview

This document shows how to deploy a **real-time persistent trading engine** that eliminates serverless latency.

**Latency Improvement:**
- Current: 650-1500ms + 60s between checks = **terrible**
- New: 50-150ms + **continuous monitoring** = **excellent**

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Persistent Node.js Process              │
│                    (VPS/Railway/Render)                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ WebSocket Connections (Always Active)          │    │
│  │                                                 │    │
│  │  • Bybit Kline Stream (1m candles)            │    │
│  │  • Bybit Orderbook Stream (50 levels)         │    │
│  │  • Bybit Ticker Stream (real-time price)      │    │
│  │                                                 │    │
│  │  Latency: < 1ms (instant updates)             │    │
│  └────────────────────────────────────────────────┘    │
│                      ↓                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │ Signal Detection Engine (Event-Driven)         │    │
│  │                                                 │    │
│  │  On every price update:                        │    │
│  │  1. Check if price near signal levels (~1ms)  │    │
│  │  2. Analyze orderflow if near level (~5ms)    │    │
│  │  3. Validate momentum (~2ms)                   │    │
│  │  4. Execute if all conditions met              │    │
│  │                                                 │    │
│  │  Latency: ~10ms per evaluation                │    │
│  └────────────────────────────────────────────────┘    │
│                      ↓                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │ Order Execution (Bybit REST API)               │    │
│  │                                                 │    │
│  │  • Market order placement                      │    │
│  │  • TP/SL setup                                 │    │
│  │                                                 │    │
│  │  Latency: ~100ms (network to Bybit)           │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Total Latency: ~110ms from signal to order filled     │
│  (vs 60,000ms+ in serverless)                          │
└──────────────────────────────────────────────────────────┘
```

---

## Deployment Options

### Option A: Railway.app (RECOMMENDED - Easy & Free)

**Pros:**
- Free tier available (500 hours/month)
- Easy GitHub deployment
- Auto-restart on crash
- Environment variables built-in
- Monitoring dashboard

**Cost:** $0-5/month

**Setup Time:** 10 minutes

### Option B: Render.com (Alternative Free Option)

**Pros:**
- Free tier available
- Similar to Railway
- Good for hobby projects

**Cost:** $0-7/month

### Option C: DigitalOcean/Linode VPS (Most Control)

**Pros:**
- Full server control
- Best performance
- Can run multiple bots

**Cost:** $6-12/month

**Setup Time:** 30 minutes

### Option D: AWS EC2 t3.micro (Free Tier)

**Pros:**
- 750 hours/month free (first year)
- Good for testing

**Cost:** $0 (first year)

---

## Implementation Strategy

### Phase 1: Keep Vercel Running (Zero Downtime)

Keep your current Vercel setup as-is. It will continue trading.

### Phase 2: Deploy Persistent Engine (Parallel)

Deploy the new persistent engine alongside Vercel:
- Both systems run in parallel
- Monitor performance differences
- Gradual migration

### Phase 3: Switch Over (When Ready)

Once the persistent engine is proven:
- Disable Vercel cron
- Keep Vercel for dashboard/UI only
- All trading happens in persistent engine

---

## File Structure for Persistent Engine

```
/trading-engine/
├── package.json
├── tsconfig.json
├── .env
├── src/
│   ├── index.ts              # Main entry point
│   ├── websocket-manager.ts  # WebSocket connection handler
│   ├── signal-engine.ts      # Garchy 2.0 signal detection
│   ├── order-executor.ts     # Order placement logic
│   ├── db-client.ts          # Database connection (reuse existing)
│   └── types.ts              # Shared types
├── Dockerfile                # For Railway/Render deployment
└── railway.toml              # Railway config
```

---

## Quick Start: Railway Deployment

### Step 1: Create Trading Engine Package

```bash
# In your project root
mkdir trading-engine
cd trading-engine
npm init -y
```

### Step 2: Install Dependencies

```bash
npm install \
  ws \
  @vercel/postgres \
  dotenv \
  typescript \
  @types/node \
  @types/ws
```

### Step 3: Create Core Files

I'll create these for you in the next step.

### Step 4: Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

**Railway will:**
- Build your TypeScript code
- Start the persistent process
- Keep it running 24/7
- Auto-restart on crash
- Provide logs dashboard

---

## Performance Comparison

### Current Serverless (Vercel Cron)

```
Signal appears at level:     00:00:00.000
Price moves:                 00:00:15.000
Optimal entry:               00:00:30.000  ← Should enter here
Cron runs:                   00:01:00.000  ← Actually enters here
Order placed:                00:01:00.500
Order filled:                00:01:00.650

Entry: 30+ seconds late, 50+ points slippage
```

### New Persistent Engine

```
Signal appears at level:     00:00:00.000
WebSocket price update:      00:00:00.001  ← Instant
Signal detected:             00:00:00.011  ← 11ms
Order placed:                00:00:00.111  ← 111ms
Order filled:                00:00:00.261  ← 261ms

Entry: 261ms from signal, ~0 slippage
```

**That's 230x faster signal detection!**

---

## Risk Management Improvements

With persistent monitoring, you can add:

### 1. **Stop Loss Monitoring** (Critical!)
```typescript
// Monitor EVERY tick for SL hits, not just once per minute
ws.on('ticker', (data) => {
  for (const trade of openTrades) {
    if (shouldHitStopLoss(data.price, trade)) {
      closePositionImmediately(trade); // ← 100ms vs 60s
    }
  }
});
```

### 2. **Breakeven Triggers**
```typescript
// Move to breakeven as soon as profit threshold hit
if (trade.pnl >= trade.breakeven_threshold) {
  updateStopLoss(trade.id, trade.entry_price);
}
```

### 3. **Partial Profit Taking**
```typescript
// Close 50% at 50% of target
if (trade.pnl >= trade.target * 0.5) {
  closePartialPosition(trade.id, 0.5);
}
```

---

## Hybrid Approach (Recommended Start)

Keep both systems running:

**Vercel (Keep for):**
- Dashboard UI
- Settings management  
- Trade history display
- Manual trading interface
- Daily level calculation

**Persistent Engine (New, for):**
- Real-time signal detection
- Order execution
- Position monitoring
- Stop loss management

**Communication:**
- Both read from same PostgreSQL database
- Persistent engine writes trades
- Vercel displays them

---

## Next Steps

**I can build this for you right now. Which would you like?**

1. **Full Persistent Engine** (Railway/Render deployment ready)
   - Complete WebSocket + signal engine
   - Deployment configs included
   - Can deploy in 15 minutes

2. **Hybrid Starter** (Add to existing project)
   - Minimal changes to current code
   - Run alongside Vercel
   - Easy testing

3. **Conditional Orders Integration** (Quick win)
   - Use Bybit's execution engine
   - Works with current serverless setup
   - No infrastructure changes

**My recommendation:** Start with #3 (conditional orders) for immediate improvement, then build #1 (persistent engine) for long-term.

Would you like me to implement one of these?
