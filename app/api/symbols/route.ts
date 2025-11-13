import { NextResponse } from 'next/server';
import { fetchLinearInstruments } from '@/lib/bybit';

export async function GET() {
  try {
    const mainnetSymbols = await fetchLinearInstruments(false);
    let testnetSymbols: string[] = [];

    try {
      testnetSymbols = await fetchLinearInstruments(true);
    } catch (err) {
      console.warn('[SYMBOLS] Failed to fetch testnet instruments:', err);
    }

    const symbols = Array.from(new Set([...mainnetSymbols, ...testnetSymbols])).sort();

    return NextResponse.json({
      success: true,
      symbols,
    }, {
      headers: {
        'Cache-Control': 's-maxage=600, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('[SYMBOLS] Failed to fetch instruments:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch symbols',
    }, { status: 500 });
  }
}

