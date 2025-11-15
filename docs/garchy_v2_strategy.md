# Garchy 2.0 Strategy Documentation

## Overview

Garchy 2.0 is a hybrid volatility + auction market + orderflow trading strategy that builds on the existing GARCH-based zone framework. It combines multiple analysis layers to generate high-confidence trade signals with structured metadata for the risk/execution layer.

## Architecture

Garchy 2.0 consists of five main components that work together:

1. **ORB (Opening Range Breakout)** - "Rule 0" - Session initiation and bias
2. **GARCH Zone Engine** - Volatility-based structure and boundaries
3. **Market Profile / Volume Profile** - Volume-by-price context
4. **Orderflow / DOM Confirmation** - Real-time order book and flow analysis
5. **Imbalance Detection** - Secondary intraday levels and inefficiencies

## Components

### 1. ORB (Opening Range Breakout) - Rule 0

**Purpose**: Establishes session bias and early breakout opportunities.

**How it works**:
- Tracks price action during the opening range window (configurable, default: 5 minutes after UTC 00:00)
- Calculates Opening Range High (ORH) and Opening Range Low (ORL)
- Detects breakouts above ORH (long) or below ORL (short)
- Requires confirmation: price must hold above/below breakout level for a minimum duration (default: 30 seconds)

**Integration**:
- ORB outcome establishes **session bias** (long, short, or neutral)
- This bias influences GARCH zone and imbalance trade decisions throughout the session
- ORB signals are checked first in the decision hierarchy

**Configuration**:
- `ORB_WINDOW_MINUTES` (default: 5) - Opening range window duration
- Hold duration and breakout confirmation thresholds are configurable

**Output**: ORB signal with direction, level, and session bias

---

### 2. GARCH Zone Engine

**Purpose**: Defines volatility-based structure and zone boundaries.

**How it works**:
- Takes daily open price and GARCH% (volatility forecast)
- Calculates upper and lower expected ranges: `upper = open * (1 + GARCH%)`, `lower = open * (1 - GARCH%)`
- Divides the range into **4 quadrants** (zones):
  - **Q2**: Upper range boundary (above open)
  - **Q1**: Midpoint between open and upper range
  - **Q0**: Daily open
  - **Q-1**: Midpoint between lower range and open
  - **Q-2**: Lower range boundary (below open)

**Features**:
- Get current zone for any price
- Find nearest zone boundary
- Check if price has touched a boundary (within tolerance)
- Check if price has broken and held above/below a boundary

**Integration**:
- Zone boundaries act as key support/resistance levels
- Combined with Market Profile to determine if boundaries are likely to hold (HVN) or break (LVN)
- TP/SL levels are calculated from zone boundaries

**Math**: Unchanged from Garchy v1 - same volatility calculation and zone division logic

---

### 3. Market Profile / Volume Profile Validation

**Purpose**: Contextualizes GARCH zones and boundaries using volume-by-price analysis.

**How it works**:
- Builds a volume profile from intraday candles
- Identifies **High Volume Nodes (HVNs)** - price levels/areas with high traded volume
- Identifies **Low Volume Nodes (LVNs)** - price levels/areas with low traded volume (voids)

**Trading Rules**:
- **LVN near GARCH boundary**:
  - More likely to **breakout / fast move**
  - Price tends to move quickly through low-volume areas
- **HVN near GARCH boundary**:
  - More likely to **mean revert / chop**
  - High volume suggests active trading and potential support/resistance
- **No clear node**:
  - Lower confidence; signals may be filtered or down-ranked

**Integration**:
- For each candidate setup (ORB, GARCH boundary, imbalance), the strategy checks the MP/VP context
- This context is used in confidence calculation and setup type determination (breakout vs. rejection)

**Configuration**:
- Bucket size, proximity thresholds, HVN/LVN percentiles are configurable

---

### 4. Orderflow / DOM Confirmation Layer

**Purpose**: Acts as a gatekeeper for trade entries using real-time order book and flow analysis.

**How it works**:
- Analyzes Level 2 order book snapshots
- Tracks:
  - Relative aggressive buys vs aggressive sells (delta-like measure)
  - Volume surges
  - Order book walls (significant limit orders near levels)
  - Absorption (persistent flow against a level without price moving through)

**Signals**:
- **Orderflow bias**: `long`, `short`, or `neutral`
- **Confidence**: 0-1 scale
- **Flags**: `absorbingBids`, `absorbingAsks`, `buyVolumeSurge`, `sellVolumeSurge`

**Trading Rules**:
- Candidate long setup + orderflow bias long → **allowed**
- Candidate short setup + orderflow bias short → **allowed**
- Mismatch or neutral → **rejected or confidence reduced**

**Integration**:
- All trade signals (ORB, GARCH boundaries, imbalances) must pass orderflow confirmation
- Acts as a final filter before emitting a trade signal
- Orderflow confidence contributes to overall signal confidence

**Configuration**:
- Minimum wall notional, proximity thresholds, volume surge multipliers, minimum confidence thresholds

---

### 5. Imbalance Detection

**Purpose**: Identifies secondary intraday levels (inefficiencies) within GARCH zones.

**How it works**:
- Detects **Fair Value Gaps (FVG)**: 3-candle patterns with price gaps
- Detects **Volume Voids**: Consecutive low-volume candles creating thin areas
- Tags imbalances with:
  - Upper/lower boundaries and midpoint
  - Direction (bullish/bearish)
  - Strength/confidence
  - Zone membership (which GARCH quadrant)

**Trading Rules**:
- Price revisiting an imbalance may:
  - **Mean revert** (if session bias is opposite)
  - **Continue trend** into the next GARCH zone (if session bias aligns)

**Integration**:
- Used as additional reaction zones alongside GARCH boundaries
- Behavior chosen based on:
  - Session bias (from ORB)
  - MP/VP context
  - Orderflow at the moment of touch/retest
- Imbalance retests can generate trade signals if orderflow confirms

**Configuration**:
- Minimum/maximum gap sizes, FVG/volume void detection toggles

---

## Decision Hierarchy

The strategy follows a clear, explicit hierarchy for each session:

### 1. Session Initialization

1. Refresh GARCH% and compute zones
2. Initialize ORB module for the upcoming OR window
3. Build or refresh Volume Profile / Market Profile for context
4. Detect key imbalances for the session

### 2. ORB Phase (Rule 0)

**During OR window**:
- Track ORH/ORL continuously

**After OR window closes**:
- Check for ORB breakout conditions
- Validate with:
  - Volume/expansion behaviour
  - Orderflow bias
  - Optional MP/VP context
- If valid:
  - Emit an **ORB trade signal** (direction + type + key level + context flags)
  - Store ORB result as **session bias** (long, short, neutral)

### 3. Post-ORB / Regular Session Logic

Continuously monitor price action relative to:
- GARCH zones and zone boundaries
- MP/VP nodes (HVNs/LVNs)
- Imbalance levels

**For each candidate trade setup**:

Example setups:
- **Boundary breakout**: Price breaking a GARCH boundary
- **Boundary rejection**: Price rejecting at a boundary, especially if aligned with HVN
- **Imbalance retest**: Price revisiting an imbalance inside a zone

**For each event**:
1. Pull **session bias** (from ORB or higher timeframe if present)
2. Pull **MP/VP context** (HVN/LVN/none)
3. Pull **orderflow confirmation** at the time of test/break
4. Decide: Long signal, short signal, or no trade

**Emit structured trade signal** containing:
- Setup type: `ORB`, `GARCH_BREAKOUT`, `GARCH_REJECTION`, `IMBALANCE_RETEST`, `IMBALANCE_CONTINUATION`
- Direction: `long` or `short`
- Key level(s): entry reference price, zone boundary, imbalance level
- Context tags: MP/VP type, orderflow bias, session bias
- Confidence: 0-1 score based on all factors

### 4. Hand-off to Risk & Execution

The strategy layer **does not** compute size or leverage. It only provides:
- Direction
- Level
- Setup metadata (confidence, context)

The existing risk & order modules decide:
- Position size
- Leverage
- Stops
- Actual order placement

---

## Signal Structure

Each trade signal emitted by Garchy 2.0 contains:

```typescript
{
  setupType: 'ORB' | 'GARCH_BREAKOUT' | 'GARCH_REJECTION' | 'IMBALANCE_RETEST' | 'IMBALANCE_CONTINUATION',
  side: 'LONG' | 'SHORT',
  entry: number,  // Entry price/level
  tp: number,     // Take profit level
  sl: number,     // Stop loss level
  confidence: number,  // 0-1 confidence score
  context: {
    sessionBias: 'long' | 'short' | 'neutral',
    profileContext: {
      nodeType: 'HVN' | 'LVN' | 'neutral',
      confidence: number,
      distance: number,
      nearestNodePrice: number | null
    },
    orderflow: {
      bias: 'long' | 'short' | 'neutral',
      confidence: number,
      flags: {
        absorbingBids: boolean,
        absorbingAsks: boolean,
        buyVolumeSurge: boolean,
        sellVolumeSurge: boolean
      }
    },
    zoneInfo: {
      quadrant: 'Q2' | 'Q1' | 'Q0' | 'Q-1' | 'Q-2',
      nearestBoundary: number,
      distanceToBoundaryPct: number
    },
    imbalance: Imbalance | null,
    reason: string  // Human-readable explanation
  }
}
```

---

## Configuration

Garchy 2.0 can be enabled/disabled and configured via environment variables:

### Enable Garchy 2.0

```bash
ENABLE_GARCHY_2=true
```

### ORB Configuration

```bash
ORB_WINDOW_MINUTES=5  # Opening range window duration in minutes
```

### Signal Confidence

```bash
MIN_SIGNAL_CONFIDENCE=0.4  # Minimum confidence threshold (0-1)
```

### Default Values

- ORB window: 5 minutes
- Minimum signal confidence: 0.4
- Hold duration for ORB confirmation: 30 seconds
- Breakout confirmation: 0.1% price move beyond level

---

## File Structure

All Garchy 2.0 code is located in `lib/garchy2/`:

- `orb.ts` - Opening Range Breakout module
- `garch-zones.ts` - GARCH zone engine
- `market-profile.ts` - Market Profile / Volume Profile analyzer
- `orderflow.ts` - Orderflow / DOM confirmation layer
- `imbalance.ts` - Imbalance detection module
- `strategy-engine.ts` - Main orchestration engine
- `signal-adapter.ts` - Adapter for signal API integration

The signal API (`app/api/signal/route.ts`) automatically uses Garchy 2.0 if enabled, with fallback to v1 for backward compatibility.

---

## Backward Compatibility

Garchy 2.0 is designed to be backward compatible:
- If `ENABLE_GARCHY_2` is not set or false, the system uses the original Garchy v1 logic
- All existing v1 functionality remains available
- Signal API maintains the same response structure
- Risk and execution modules require no changes

---

## Usage Example

```typescript
import { Garchy2StrategyEngine } from '@/lib/garchy2/strategy-engine';

const engine = new Garchy2StrategyEngine({
  orb: { windowMinutes: 5 },
  minSignalConfidence: 0.4,
});

// Initialize for session
engine.initialize({
  dailyOpen: 100000,
  garchPct: 0.025,  // 2.5%
  sessionStart: Date.now(),
  candles: [...],  // Intraday candles
});

// Evaluate and get signal
const signal = await engine.evaluate({
  currentPrice: 101000,
  timestamp: Date.now(),
  candles: [...],
  symbol: 'BTCUSDT',
});

if (signal) {
  console.log(`Signal: ${signal.side} @ ${signal.entry}`);
  console.log(`Setup: ${signal.setupType}, Confidence: ${signal.confidence}`);
  console.log(`Session Bias: ${signal.context.sessionBias}`);
}
```

---

## Key Concepts Summary

1. **ORB sets the session bias** - Establishes early direction for the day
2. **GARCH zones provide structure** - Volatility-based support/resistance levels
3. **MP/VP classifies levels** - HVN = likely to hold, LVN = likely to break
4. **Orderflow confirms entries** - Final gatekeeper before trade execution
5. **Imbalances add nuance** - Secondary levels within zones for refined entries

All components work together through the decision hierarchy to generate high-confidence signals while maintaining clear separation between strategy (signals) and risk/execution (size, leverage, orders).

