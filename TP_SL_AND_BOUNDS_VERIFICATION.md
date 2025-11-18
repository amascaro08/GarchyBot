# TP/SL Calculation & Bounds Logic Verification

## Part 1: TP/SL Calculation ✅ VERIFIED CORRECT

### How `findClosestGridLevels()` Works

**Function Location:** `/workspace/lib/strategy.ts` (lines 76-136)

#### Step 1: Create Sorted Grid Array
```typescript
const allLevels = [...dnLevels, dOpen, ...upLevels]
  .map(roundLevel)
  .sort((a, b) => a - b);
```

**Example Grid:**
```
D3: $48,500
D2: $49,000
D1: $49,500
Daily Open: $50,000
U1: $50,500
U2: $51,000
U3: $51,500
```

#### Step 2: Find Entry Index in Grid
Finds where your entry price sits in the sorted array.

#### Step 3: Calculate TP/SL Based on Side

**For LONG Trades:**
```typescript
const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackLongTp;  // Next level UP
const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackLongSl;  // Previous level DOWN
```

**For SHORT Trades:**
```typescript
const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackShortTp;  // Previous level DOWN
const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackShortSl;  // Next level UP
```

### Example Calculations

#### LONG Entry at D1 ($49,500):
- **Entry:** $49,500 (D1)
- **TP:** $50,000 (Daily Open - next level up) ✅
- **SL:** $49,000 (D2 - previous level down) ✅
- **Risk:** $500, **Reward:** $500 → **1:1 R/R**

#### LONG Entry at Daily Open ($50,000):
- **Entry:** $50,000 (Daily Open)
- **TP:** $50,500 (U1 - next level up) ✅
- **SL:** $49,500 (D1 - previous level down) ✅
- **Risk:** $500, **Reward:** $500 → **1:1 R/R**

#### SHORT Entry at U1 ($50,500):
- **Entry:** $50,500 (U1)
- **TP:** $50,000 (Daily Open - next level down) ✅
- **SL:** $51,000 (U2 - next level up) ✅
- **Risk:** $500, **Reward:** $500 → **1:1 R/R**

### Verification in Bot Runner

**Location:** `/workspace/app/api/cron/bot-runner/route.ts` (lines 1225-1242)

```typescript
// Signal includes calculated TP/SL from findClosestGridLevels()
const tpPrice = signal.tp;
const slPrice = signal.sl;

// Trade record created with these exact values
const tradeRecord = await createTrade({
  user_id: botConfig.user_id,
  bot_config_id: botConfig.id,
  symbol: botConfig.symbol,
  side: signal.side,
  status: 'pending',
  entry_price: entryPrice,
  tp_price: tpPrice,      // ✅ Uses calculated TP
  sl_price: slPrice,      // ✅ Uses calculated SL
  current_sl: slPrice,    // ✅ Initializes current SL
  // ...
});
```

**✅ VERDICT: TP/SL are set EXACTLY to the calculated grid levels**

---

## Part 2: Upper/Lower Bounds Logic ⚠️ POTENTIAL ISSUE

### Current Strategy Behavior

#### When Price > VWAP (LONG Bias):
**The bot will enter LONG at:**
- ✅ D1, D2, D3, etc. (Lower levels - makes sense, buying dips)
- ✅ Daily Open (Support - makes sense)
- ⚠️ U1, U2, U3, etc. (Upper levels - **ENTERS LONG AT RESISTANCE!**)

**Code Location:** `/workspace/lib/strategy.ts` (lines 291-336)

```typescript
if (isLongBias) {
  // Check U1 for LONG entry
  if (upLevels.length > 0) {
    const u1Level = roundLevel(upLevels[0]);
    if (checkRealtimeLevelTouch(realtimePrice, u1Level)) {
      const entry = u1Level;
      const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
      return { side: 'LONG', entry, tp, sl, ... };  // ⚠️ LONG at U1
    }
  }
  
  // Check U2, U3, U4, U5 for LONG entry
  for (let i = 1; i < upLevels.length; i++) {
    const level = roundLevel(upLevels[i]);
    if (checkRealtimeLevelTouch(realtimePrice, level)) {
      const entry = level;
      const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
      return { side: 'LONG', entry, tp, sl, ... };  // ⚠️ LONG at U2, U3, U4, U5
    }
  }
}
```

#### When Price < VWAP (SHORT Bias):
**The bot will enter SHORT at:**
- ⚠️ D1, D2, D3, etc. (Lower levels - **ENTERS SHORT AT SUPPORT!**)
- ✅ Daily Open (Resistance - makes sense)
- ✅ U1, U2, U3, etc. (Upper levels - makes sense, selling rallies)

**Code Location:** `/workspace/lib/strategy.ts` (lines 486-514)

```typescript
// SHORT logic - checks ALL levels
for (let i = 0; i < dnLevels.length; i++) {
  const level = roundLevel(dnLevels[i]);
  if (checkRealtimeLevelTouch(realtimePrice, level)) {
    const entry = level;
    const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
    return { side: 'SHORT', entry, tp, sl, ... };  // ⚠️ SHORT at D1, D2, D3
  }
}

for (let i = 1; i < upLevels.length; i++) {
  const level = roundLevel(upLevels[i]);
  if (checkRealtimeLevelTouch(realtimePrice, level)) {
    const entry = level;
    const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
    return { side: 'SHORT', entry, tp, sl, ... };  // ✅ SHORT at U2, U3, U4, U5
  }
}
```

---

## Real-World Scenario Analysis

### Scenario 1: Price at Upper Bound (U5 - Highest Level)

**Setup:**
- Daily Open: $50,000
- U5 (Upper Bound): $51,500 (highest grid level)
- VWAP: $50,200
- Current Price: $51,500

**Current Behavior:**
1. Price > VWAP → **LONG bias** ✓
2. Price touches U5 (upper bound)
3. Bot enters **LONG at $51,500** ⚠️
4. TP: $52,000 (fallback, no grid level above)
5. SL: $51,000 (U4)

**Problem:**
- You're buying at the **TOP of the expected range**
- U5 represents the **upper volatility boundary** (resistance)
- If price is at the upper bound, it's more likely to reverse DOWN
- This is like "buying the top" in a range

**What SHOULD Happen (arguably):**
- At upper bound with LONG bias: **NO ENTRY** (wait for pullback)
- OR: Enter **SHORT** (fade the extreme, mean reversion)

---

### Scenario 2: Price at Lower Bound (D5 - Lowest Level)

**Setup:**
- Daily Open: $50,000
- D5 (Lower Bound): $48,500 (lowest grid level)
- VWAP: $49,800
- Current Price: $48,500

**Current Behavior:**
1. Price < VWAP → **SHORT bias** ✓
2. Price touches D5 (lower bound)
3. Bot enters **SHORT at $48,500** ⚠️
4. TP: $48,000 (fallback, no grid level below)
5. SL: $49,000 (D4)

**Problem:**
- You're selling at the **BOTTOM of the expected range**
- D5 represents the **lower volatility boundary** (support)
- If price is at the lower bound, it's more likely to reverse UP
- This is like "shorting the bottom" in a range

**What SHOULD Happen (arguably):**
- At lower bound with SHORT bias: **NO ENTRY** (wait for rally)
- OR: Enter **LONG** (fade the extreme, mean reversion)

---

## Comparison: Current vs Expected Logic

### Current Logic (Mean-Following):
| Bias | At Upper Levels | At Lower Levels |
|------|----------------|-----------------|
| LONG (Price > VWAP) | ⚠️ Enter LONG (buying tops) | ✅ Enter LONG (buying dips) |
| SHORT (Price < VWAP) | ✅ Enter SHORT (selling rallies) | ⚠️ Enter SHORT (selling bottoms) |

### Alternative Logic (Mean-Reversion at Extremes):
| Bias | At Upper Bound (U5) | At Lower Bound (D5) |
|------|---------------------|---------------------|
| LONG (Price > VWAP) | ❌ NO ENTRY or 🔄 SHORT | ✅ Enter LONG |
| SHORT (Price < VWAP) | ✅ Enter SHORT | ❌ NO ENTRY or 🔄 LONG |

### Hybrid Logic (Conservative):
| Bias | At Upper Bound (U5) | At Lower Bound (D5) |
|------|---------------------|---------------------|
| LONG (Price > VWAP) | ❌ NO ENTRY (wait for pullback) | ✅ Enter LONG |
| SHORT (Price < VWAP) | ✅ Enter SHORT | ❌ NO ENTRY (wait for rally) |

---

## Strategy Intent Analysis

### Possible Interpretations:

#### Interpretation 1: "Zone Trading" (Current Implementation)
**Philosophy:** The grid is a zone structure. VWAP determines bias. ANY level touch is a retracement entry opportunity.

**Logic:**
- When price > VWAP (bullish), all grid levels act as potential support
- When price < VWAP (bearish), all grid levels act as potential resistance
- Grid levels are "stepping stones" in the direction of bias

**Pros:**
- More entry opportunities
- Catches continuation moves
- Works in strong trending markets

**Cons:**
- Enters at extremes (tops/bottoms of range)
- Counter to GARCH mean-reversion theory
- Higher risk at boundaries

---

#### Interpretation 2: "Pure Mean-Reversion at Extremes"
**Philosophy:** At the upper/lower bounds, fade the move (enter opposite direction).

**Logic:**
- GARCH volatility bands represent expected range
- Price at extremes tends to revert to mean (daily open/VWAP)
- Upper bound = overbought, lower bound = oversold

**Pros:**
- Aligns with mean-reversion theory
- Better risk/reward at extremes
- Catches reversals

**Cons:**
- Fights the trend (dangerous in breakouts)
- Fewer entries in trending markets
- Requires strong conviction in range

---

#### Interpretation 3: "Hybrid - No Extremes"
**Philosophy:** Trade with bias, but skip extreme boundary entries.

**Logic:**
- When LONG bias: Enter at D1-D5, Daily Open, U1-U4, but NOT U5
- When SHORT bias: Enter at U1-U5, Daily Open, D1-D4, but NOT D5
- Avoid buying tops and selling bottoms

**Pros:**
- Best of both worlds
- Avoids worst entries
- Still captures most opportunities

**Cons:**
- Misses occasional breakout continuations
- More complex logic

---

## Questions to Answer:

### 1. **Is the current logic intentional?**
   - Are you deliberately entering LONG at all upper levels when price > VWAP?
   - Are you deliberately entering SHORT at all lower levels when price < VWAP?

### 2. **What should happen at upper bound (U5)?**
   - A) Enter LONG (current behavior - momentum/continuation)
   - B) Enter SHORT (mean-reversion)
   - C) No entry (wait for pullback)

### 3. **What should happen at lower bound (D5)?**
   - A) Enter SHORT (current behavior - momentum/continuation)
   - B) Enter LONG (mean-reversion)
   - C) No entry (wait for rally)

### 4. **What is the strategy philosophy?**
   - Trend-following (trade with VWAP bias at all levels)?
   - Mean-reversion (fade extremes)?
   - Hybrid (trend-following inside range, mean-reversion at boundaries)?

---

## Recommendations Based on GARCH Theory

**GARCH models predict volatility ranges and mean reversion.**

Given that your bot uses GARCH-calculated volatility bands (kPct) to set the grid:

### Recommended Logic: **Hybrid Mean-Reversion**

**Rationale:**
- GARCH upper/lower bounds represent ±2-3 standard deviation moves
- Statistically, price should revert toward mean (daily open) from extremes
- Entering at extremes in the same direction increases risk

**Suggested Rules:**

#### For LONG Bias (Price > VWAP):
1. ✅ Enter LONG at: D1-D5, Daily Open, U1-U4 (interior levels)
2. ❌ Do NOT enter LONG at: U5 (upper bound - too extended)
3. 🔄 Consider SHORT at: U5 (mean-reversion play)

#### For SHORT Bias (Price < VWAP):
1. ✅ Enter SHORT at: U1-U5, Daily Open, D2-D4 (interior levels)
2. ❌ Do NOT enter SHORT at: D5 (lower bound - too extended)
3. 🔄 Consider LONG at: D5 (mean-reversion play)

---

## Code Example: Proposed Fix

To prevent entries at extremes, add boundary checks:

```typescript
// In strictSignalWithDailyOpen() function

if (isLongBias) {
  // Check upper levels EXCEPT the last one (U5/upper bound)
  for (let i = 1; i < upLevels.length - 1; i++) {  // ← Added -1 to skip last level
    const level = roundLevel(upLevels[i]);
    if (checkRealtimeLevelTouch(realtimePrice, level)) {
      const entry = level;
      const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
      return { side: 'LONG', entry, tp, sl, ... };
    }
  }
  
  // All other LONG entries (D1-D5, Daily Open, U1) remain unchanged
}

if (isShortBias) {
  // Check lower levels EXCEPT the last one (D5/lower bound)
  for (let i = 1; i < dnLevels.length - 1; i++) {  // ← Added -1 to skip last level
    const level = roundLevel(dnLevels[i]);
    if (checkRealtimeLevelTouch(realtimePrice, level)) {
      const entry = level;
      const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
      return { side: 'SHORT', entry, tp, sl, ... };
    }
  }
  
  // All other SHORT entries (U1-U5, Daily Open, D1-D4) remain unchanged
}
```

---

## Summary

### ✅ **TP/SL Calculation:** VERIFIED CORRECT
- TP and SL are set to exact grid levels as calculated by `findClosestGridLevels()`
- LONG: TP = next level up, SL = next level down
- SHORT: TP = next level down, SL = next level up
- All values properly passed from signal generation to trade creation

### ⚠️ **Upper/Lower Bounds Logic:** NEEDS CLARIFICATION
- Current behavior: Enters LONG at ALL levels when price > VWAP (including upper bounds)
- Current behavior: Enters SHORT at ALL levels when price < VWAP (including lower bounds)
- This may be **counter to GARCH mean-reversion theory**
- Recommendation: Skip extreme boundary entries OR implement mean-reversion at boundaries

**Next Step:** Confirm your intended strategy philosophy, and I can implement the appropriate logic.
