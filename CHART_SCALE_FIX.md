# Chart Scale Fix - Symbol Switching Issue

## Problem
When changing assets (symbols) in the settings and returning to the dashboard, the chart scale would not update properly. The chart would maintain the old price range from the previous symbol, making it difficult to view the new asset's price action.

## Root Causes Identified

### 1. Variable Declaration Order Bug
- `candlesSignatureRef` was being used in a `useEffect` at line 174 before it was declared at line 192
- This caused the reset logic to fail silently
- JavaScript hoisting didn't apply since these are `useRef` hooks

### 2. Incomplete Reset Logic
- When symbol/interval changed, only 2 refs were being reset
- Chart data and price lines were not being cleared
- Auto-scale option was not being explicitly set

### 3. Stale State Persistence
- `lastProcessedRef` and `lastCandleCountRef` were not reset on symbol change
- This could cause the chart to think it had already processed the new symbol's data

## Solution Implemented

### 1. Fixed Variable Declaration Order
Moved `candlesSignatureRef` and `lastCandleCountRef` to the top of the component with other refs:

```typescript
const candlesSignatureRef = useRef<string>('');
const lastCandleCountRef = useRef<number>(0);
```

### 2. Enhanced Symbol/Interval Change Handler
Complete reset of chart state when symbol or interval changes:

```typescript
useEffect(() => {
  // Reset all tracking refs
  hasInitialFitRef.current = false;
  candlesSignatureRef.current = '';
  lastCandleCountRef.current = 0;
  lastProcessedRef.current = '';
  
  // Clear update intervals
  if (updateCheckIntervalRef.current) {
    clearInterval(updateCheckIntervalRef.current);
    updateCheckIntervalRef.current = null;
  }
  
  // Clear chart data
  if (chartRef.current && seriesRef.current && vwapSeriesRef.current) {
    seriesRef.current.setData([]);
    vwapSeriesRef.current.setData([]);
    
    // Remove all price lines
    priceLinesRef.current.forEach(line => {
      try {
        if (line && seriesRef.current) {
          seriesRef.current.removePriceLine(line);
        }
      } catch (e) {
        // Ignore errors
      }
    });
    priceLinesRef.current = [];
    
    // Reset chart scale
    chartRef.current.timeScale().fitContent();
    chartRef.current.priceScale('right').applyOptions({ 
      mode: PriceScaleMode.Normal,
      autoScale: true 
    });
    
    hasInitialFitRef.current = true;
  }
}, [symbol, interval]);
```

### 3. What Gets Reset Now
✅ All tracking refs (`candlesSignatureRef`, `lastCandleCountRef`, `lastProcessedRef`)  
✅ Chart series data (candles and VWAP line)  
✅ All price lines (support/resistance levels, TP/SL lines)  
✅ Time scale (fits to new data)  
✅ Price scale (auto-scales to new price range)  
✅ Update check intervals  

## Files Modified
- `/workspace/components/Chart.tsx` - Fixed variable declarations and enhanced reset logic

## Testing Scenarios
✅ Change symbol from BTC to ETH - chart scales correctly  
✅ Change symbol from high-value asset (BTC $90k) to low-value asset (SOL $200)  
✅ Change interval while keeping same symbol  
✅ Navigate away from dashboard and back  
✅ Switch between multiple symbols rapidly  

## Technical Details

### Before
- Chart would show BTC price range ($88k-$92k) when viewing ETH
- Price lines from previous symbol would persist
- Scale wouldn't auto-adjust to new price range
- User had to manually zoom/reset the chart

### After
- Chart immediately clears all old data
- Scale auto-fits to new symbol's price range
- All indicators and price lines properly reset
- Smooth transition between different assets

## Impact
This fix ensures that traders can quickly switch between different assets without chart display issues, improving the overall user experience and reducing confusion when monitoring multiple trading pairs.
