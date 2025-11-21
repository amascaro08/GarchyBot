// Quick test to verify TP/SL levels include daily open

function gridLevels(dOpen, kPct, subdivisions) {
  const upper = dOpen * (1 + kPct);
  const lower = dOpen * (1 - kPct);

  const upLevels = [];
  const dnLevels = [];

  // Upper levels (above dOpen)
  const upStep = (upper - dOpen) / subdivisions;
  for (let i = 1; i <= subdivisions; i++) {
    upLevels.push(dOpen + upStep * i);
  }

  // Lower levels (below dOpen)
  const dnStep = (dOpen - lower) / subdivisions;
  for (let i = 1; i <= subdivisions; i++) {
    dnLevels.push(dOpen - dnStep * i);
  }

  return { upper, lower, upLevels, dnLevels };
}

function roundLevel(level) {
  return Math.round(level * 1e8) / 1e8;
}

function findClosestGridLevels(entry, dOpen, upLevels, dnLevels, side) {
  const allLevels = [...dnLevels, dOpen, ...upLevels]
    .map(roundLevel)
    .sort((a, b) => a - b);

  console.log('\n=== ALL LEVELS (including dOpen) ===');
  allLevels.forEach((level, idx) => {
    const isEntry = Math.abs(level - entry) < 0.01;
    const isOpen = Math.abs(level - dOpen) < 0.01;
    console.log(`[${idx}] ${level.toFixed(2)} ${isEntry ? '<-- ENTRY' : ''} ${isOpen ? '<-- DAILY OPEN' : ''}`);
  });

  const tolerance = Math.max(Math.abs(entry) * 1e-8, 1e-6);
  const entryIndex = allLevels.findIndex(level => Math.abs(level - entry) <= tolerance);

  const findNextIndex = () => {
    if (entryIndex >= 0 && entryIndex < allLevels.length - 1) {
      return entryIndex + 1;
    }
    for (let i = 0; i < allLevels.length; i++) {
      if (allLevels[i] - entry > tolerance) {
        return i;
      }
    }
    return -1;
  };

  const findPrevIndex = () => {
    if (entryIndex > 0) {
      return entryIndex - 1;
    }
    for (let i = allLevels.length - 1; i >= 0; i--) {
      if (entry - allLevels[i] > tolerance) {
        return i;
      }
    }
    return -1;
  };

  const fallbackLongTp = roundLevel(entry + entry * 0.005);
  const fallbackLongSl = roundLevel(entry - entry * 0.005);
  const fallbackShortTp = roundLevel(entry - entry * 0.005);
  const fallbackShortSl = roundLevel(entry + entry * 0.005);

  if (side === 'LONG') {
    const nextIdx = findNextIndex();
    const prevIdx = findPrevIndex();

    const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackLongTp;
    const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackLongSl;

    console.log(`\n${side} TRADE:`);
    console.log(`  Entry: ${entry.toFixed(2)} (index: ${entryIndex})`);
    console.log(`  TP: ${tp.toFixed(2)} (index: ${nextIdx})`);
    console.log(`  SL: ${sl.toFixed(2)} (index: ${prevIdx})`);

    return { tp, sl };
  } else {
    const nextIdx = findPrevIndex();
    const prevIdx = findNextIndex();

    const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackShortTp;
    const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackShortSl;

    console.log(`\n${side} TRADE:`);
    console.log(`  Entry: ${entry.toFixed(2)} (index: ${entryIndex})`);
    console.log(`  TP: ${tp.toFixed(2)} (index: ${nextIdx})`);
    console.log(`  SL: ${sl.toFixed(2)} (index: ${prevIdx})`);

    return { tp, sl };
  }
}

// Test with example values from screenshot
console.log('=================================');
console.log('TEST 1: Entry at D1 level (first lower level)');
console.log('=================================');

const dOpen = 869.30;
const kPct = 0.0605; // 6.05% from screenshot
const subdivisions = 5;

const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, kPct, subdivisions);

console.log(`\nDaily Open: $${dOpen.toFixed(2)}`);
console.log(`Upper Range: $${upper.toFixed(2)}`);
console.log(`Lower Range: $${lower.toFixed(2)}`);
console.log(`\nUp Levels (${upLevels.length}):`);
upLevels.forEach((level, i) => console.log(`  U${i+1}: $${level.toFixed(2)}`));
console.log(`\nDown Levels (${dnLevels.length}):`);
dnLevels.forEach((level, i) => console.log(`  D${i+1}: $${level.toFixed(2)}`));

// Test LONG at D1 level (first down level)
const d1Entry = dnLevels[0];
console.log(`\n\n--- LONG Entry at D1 Level ($${d1Entry.toFixed(2)}) ---`);
findClosestGridLevels(d1Entry, dOpen, upLevels, dnLevels, 'LONG');

// Test SHORT at U1 level (first up level)
const u1Entry = upLevels[0];
console.log(`\n\n--- SHORT Entry at U1 Level ($${u1Entry.toFixed(2)}) ---`);
findClosestGridLevels(u1Entry, dOpen, upLevels, dnLevels, 'SHORT');

// Test LONG at Daily Open
console.log(`\n\n--- LONG Entry at Daily Open ($${dOpen.toFixed(2)}) ---`);
findClosestGridLevels(dOpen, dOpen, upLevels, dnLevels, 'LONG');
