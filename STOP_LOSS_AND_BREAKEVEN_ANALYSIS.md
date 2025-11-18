# Stop Loss and Breakeven Logic Analysis

## Overview
Your trading bot implements a sophisticated two-tier stop loss management system with **breakeven protection** and **trailing stop loss** functionality. These systems work together to protect capital and lock in profits.

---

## 1. Breakeven Stop Loss Logic

### Purpose
Protects trades when price action invalidates the original trade setup by moving the stop loss to the entry price (breakeven), ensuring no loss is taken.

### Location
- **Function:** `applyBreakevenOnVWAPFlip()` in `/workspace/lib/strategy.ts` (lines 752-828)
- **Implementation:** `/workspace/app/api/cron/bot-runner/route.ts` (lines 723-766 for live mode)

### Trigger Conditions

#### For LONG Trades:
- **Entry Logic:** LONG trades are entered when price is ABOVE VWAP (bullish bias)
- **Breakeven Trigger:** When price crosses BELOW VWAP and moves against the trade
- **Specific Condition:** `currentPrice < currentVWAP - buffer`
  - Buffer: 0.5% - 1% of VWAP (configurable)
  - This means price must be **clearly** below VWAP, not just touching it

#### For SHORT Trades:
- **Entry Logic:** SHORT trades are entered when price is BELOW VWAP (bearish bias)
- **Breakeven Trigger:** When price crosses ABOVE VWAP and moves against the trade
- **Specific Condition:** `currentPrice > currentVWAP + buffer`
  - Buffer: 0.5% - 1% of VWAP (configurable)
  - This means price must be **clearly** above VWAP, not just touching it

### Safeguards & Parameters

1. **Grace Period:** 5 minutes (300,000ms in live mode, can be adjusted)
   - Prevents immediate breakeven triggers right after entry
   - Gives trades room to develop before applying breakeven logic
   - In live mode: 10 minutes (600,000ms) - even more conservative

2. **Confirmation Buffer:** 0.5% - 1% (configurable)
   - Live mode uses 1% buffer (line 738 in bot-runner)
   - Demo mode uses 0.5% buffer (line 831 in bot-runner)
   - Prevents whipsaws from minor VWAP touches

3. **Entry Validation:**
   - Verifies entry was on correct side of VWAP before applying breakeven
   - Uses 0.05% tolerance to validate original entry position

4. **Price Safety Check:**
   - Prevents moving stop to entry if price is already at or beyond entry
   - Avoids immediate stop loss hits

### What Happens When Triggered

1. **Stop Loss Updated:** Current stop loss is moved to entry price (breakeven)
2. **Database Updated:** Trade record updated with new `current_sl` value
3. **Bybit Updated:** Stop loss updated on Bybit exchange via API
4. **Activity Log:** Warning message logged: 
   ```
   "Breakeven applied: {SIDE} {SYMBOL} SL → ${breakevenSl} 
    (price invalidated trade - moved against VWAP direction)"
   ```
5. **Trailing Stop Disabled:** Once breakeven is applied, trailing stop is skipped for that cycle

---

## 2. Trailing Stop Loss Logic

### Purpose
Locks in profits as the trade moves in your favor by continuously adjusting the stop loss to follow price movement.

### Location
- **Function:** `computeTrailingBreakeven()` in `/workspace/lib/strategy.ts` (lines 645-727)
- **Implementation:** `/workspace/app/api/cron/bot-runner/route.ts` (lines 768-801 for live mode)

### Activation Requirements

The trailing stop **only activates** when ALL of these conditions are met:

1. **Trade Must Be Profitable:**
   - For LONG: `lastClose > entry`
   - For SHORT: `lastClose < entry`

2. **Minimum Profit Threshold:**
   - Must exceed **BOTH** of these thresholds (uses the higher):
     - **Absolute:** 2% profit minimum (`minProfitPct = 0.02`)
     - **Risk-based:** 2x the initial risk (2:1 risk/reward ratio)
   
   Example:
   - If entry = $100, initial SL = $98 (2% risk)
   - Risk = $2
   - Minimum profit needed = MAX(2% of $100, 2 × $2) = MAX($2, $4) = $4
   - Trailing activates when price reaches $104+

3. **Breakeven NOT Applied:**
   - If breakeven was triggered, trailing stop is skipped for that cycle

### How It Works

#### For LONG Trades:
- **Trail Formula:** `trailingStop = currentPrice - offset`
  - Offset = 5 basis points (0.05%) of current price
  - Example: If price = $100, offset = $0.05, stop = $99.95
- **Protection:** Stop never moves down, only UP
- **Minimum Stop:** At least 0.1% above entry price

#### For SHORT Trades:
- **Trail Formula:** `trailingStop = currentPrice + offset`
  - Offset = 5 basis points (0.05%) of current price
  - Example: If price = $100, offset = $0.05, stop = $100.05
- **Protection:** Stop never moves up, only DOWN
- **Minimum Stop:** At least 0.1% below entry price

### Update Conditions

1. **Significant Change Required:** New stop must differ from current stop by at least $0.01 (1 cent)
   - Prevents excessive API calls for tiny movements

2. **Only Moves in Favorable Direction:**
   - LONG: Only raises stop, never lowers it
   - SHORT: Only lowers stop, never raises it

### What Happens When Triggered

1. **Stop Loss Updated:** Current stop loss adjusted to new trailing level
2. **Database Updated:** Trade record updated with new `current_sl` value
3. **Bybit Updated:** Stop loss updated on Bybit exchange via API
4. **Activity Log:** Info message logged:
   ```
   "Stop moved: {SIDE} {SYMBOL} SL → ${trailingSl}"
   ```

---

## 3. Execution Order in Bot Runner

The bot processes open trades every minute with this priority order:

### Step 1: Bybit Sync (Live Mode Only)
- Fetches actual position data from Bybit
- Updates entry price, position size, and P&L
- Syncs TP/SL if manually changed on Bybit

### Step 2: Breakeven Check (FIRST PRIORITY)
```
Lines 723-766 (live mode) / 822-846 (demo mode)
```
- Checks if price crossed against VWAP direction
- If triggered: moves stop to entry, updates Bybit, logs activity
- If triggered: **SKIPS** to next trade (trailing stop not evaluated)

### Step 3: Trailing Stop Check (SECOND PRIORITY)
```
Lines 768-801 (live mode) / 849-867 (demo mode)
```
- **Only runs if breakeven NOT applied**
- Checks if trade is profitable enough to activate trailing
- If activated: adjusts stop to trail price, updates Bybit, logs activity

### Step 4: TP/SL Hit Detection (Demo Mode)
```
Lines 870-909 (demo mode only)
```
- Checks if last candle hit TP or current SL
- Closes trade if hit, calculates P&L, logs result

---

## 4. Key Parameters Summary

| Parameter | Value | Location | Purpose |
|-----------|-------|----------|---------|
| **Breakeven Buffer** | 0.5% - 1% | Bot-runner line 738/831 | VWAP confirmation threshold |
| **Grace Period** | 5-10 min | Bot-runner line 740/833 | Time before breakeven can trigger |
| **Trailing Offset** | 5 bps (0.05%) | strategy.ts line 651 | Distance of trailing stop from price |
| **Min Profit %** | 2% | strategy.ts line 652 | Minimum profit to activate trailing |
| **Min Risk/Reward** | 2:1 | strategy.ts line 677 | Alternative profit threshold |
| **Min Stop Change** | $0.01 | strategy.ts line 722 | Minimum change to update stop |

---

## 5. Real-World Example

### Scenario: LONG Trade on BTCUSDT

**Entry:**
- Entry Price: $50,000
- Initial SL: $49,500 (1% below entry, $500 risk)
- TP: $51,000
- VWAP at entry: $49,800 (price above VWAP = bullish bias)

**Timeline:**

**T+2 min:** Price = $50,100, VWAP = $49,900
- ✅ Profit = $100 (0.2%) - below 2% minimum
- ❌ Trailing stop: NOT activated (needs 2% or $1000 profit)
- ❌ Breakeven: NOT triggered (price still above VWAP + buffer)
- **Stop remains:** $49,500

**T+6 min:** Price = $49,700, VWAP = $50,100
- ⚠️ Price crossed BELOW VWAP (bearish reversal!)
- ✅ Grace period passed (6 min > 5 min)
- ✅ Price clearly below VWAP: $49,700 < $50,100 - 1% buffer ($50,100 - $501 = $49,599)
- 🔄 **BREAKEVEN TRIGGERED!**
- **Stop moved:** $49,500 → $50,000 (entry price)
- **Result:** Trade now protected at breakeven, can't lose money

**T+15 min:** Price recovers to $51,100 (back above VWAP)
- ✅ Profit = $1,100 (2.2% of entry)
- ✅ Exceeds 2% minimum AND 2x risk ($1,000)
- 🔄 **TRAILING STOP ACTIVATED!**
- Trailing stop = $51,100 - 0.05% = $51,074.45
- **Stop moved:** $50,000 → $51,074.45
- **Result:** $1,074 profit locked in!

**T+20 min:** Price reaches $52,000
- 🔄 **TRAILING CONTINUES**
- New trailing stop = $52,000 - 0.05% = $51,974
- **Stop moved:** $51,074.45 → $51,974
- **Result:** $1,974 profit now locked in!

**T+25 min:** Price pulls back to $51,950
- Trailing stop = $51,974 (already set)
- Price hasn't hit stop yet
- **Stop remains:** $51,974 (doesn't move down)

**T+30 min:** Price drops to $51,970, hits stop at $51,974
- ✅ **STOP LOSS HIT**
- Exit Price: $51,974
- **Final P&L:** +$1,974 profit on $500 risk = 3.95:1 risk/reward

---

## 6. Differences Between Live and Demo Mode

| Feature | Live Mode | Demo Mode |
|---------|-----------|-----------|
| **Data Source** | Bybit API (real positions) | Chart candles |
| **Grace Period** | 10 minutes | 5 minutes |
| **Buffer** | 1% (more conservative) | 0.5% (more aggressive) |
| **Position Sync** | Yes - syncs with Bybit | No - uses database only |
| **SL Updates** | Updates Bybit via API | Database only |
| **TP/SL Detection** | Detected by Bybit execution | Detected by candle high/low |

---

## 7. Benefits of This System

### Risk Management
✅ **No Losing Trades After Reversal:** Breakeven protects you when VWAP direction changes  
✅ **Automatic Profit Protection:** Trailing locks in gains without manual intervention  
✅ **Grace Period:** Prevents premature exits on normal volatility  

### Profit Optimization
✅ **Let Winners Run:** Trailing allows trades to capture extended moves  
✅ **Smart Activation:** Only trails after achieving 2:1 risk/reward  
✅ **Controlled Risk:** Maximum loss always capped at initial stop loss  

### Practical Execution
✅ **Whipsaw Protection:** Confirmation buffers prevent false signals  
✅ **Minimal Updates:** 1-cent threshold prevents excessive API calls  
✅ **Bybit Integration:** Real-time position sync in live mode  

---

## 8. Potential Weaknesses & Considerations

⚠️ **Breakeven May Exit Winners Early:**
- If price briefly crosses VWAP then reverses back, you exit at breakeven
- You miss the eventual profitable move
- Mitigation: Grace period and confirmation buffer reduce false triggers

⚠️ **Trailing Offset May Be Too Tight:**
- 5 bps (0.05%) is very close to price
- Normal volatility could hit your trailing stop
- Mitigation: 2% minimum profit gives initial breathing room

⚠️ **VWAP as Sole Breakeven Trigger:**
- VWAP direction change doesn't always mean trade is invalid
- Could be temporary pullback in a larger trend
- Mitigation: Confirmation buffer requires clear cross, not just touch

⚠️ **No Partial Exits:**
- System uses full position stop loss management
- Can't scale out portions at different levels
- Current design: all-or-nothing exits

---

## 9. Recommended Monitoring

### Things to Watch:
1. **Breakeven Trigger Frequency:** Are you getting stopped out at breakeven too often?
   - If yes: Increase grace period or confirmation buffer
   
2. **Trailing Stop Hits:** Are trailing stops being hit before reaching TP?
   - If yes: Consider widening trailing offset or increasing min profit threshold
   
3. **Missed Opportunities:** Are breakeven exits happening before big moves?
   - If yes: Adjust VWAP buffer or grace period

### Activity Log Messages:
- ✅ `"Breakeven applied..."` - Stop moved to entry due to VWAP flip
- ✅ `"Stop moved..."` - Trailing stop adjustment
- ✅ `"Stop loss synced from Bybit..."` - Manual SL change detected

---

## Summary

Your bot uses a **two-layer defense system**:

1. **Breakeven (Primary Defense):** Protects capital when trade setup is invalidated by VWAP direction change
2. **Trailing Stop (Profit Lock):** Secures gains once trade achieves minimum 2% profit or 2x risk/reward

Both systems update your stop loss automatically in the database and on Bybit, require significant price movement to trigger (preventing whipsaws), and prioritize capital preservation while maximizing profit capture.

The system is conservative by design - better to protect capital than chase maximum profit.
