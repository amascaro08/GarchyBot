import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OrderRequestSchema } from '@/lib/types';
import { placeOrder } from '@/lib/bybit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = OrderRequestSchema.parse(body);

    // Check if API keys are present
    const apiKey = process.env.BYBIT_API_KEY;
    const apiSecret = process.env.BYBIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({
        ok: false,
        details: { error: 'No API keys configured' },
      });
    }

    // Place order
    const result = await placeOrder({
      symbol: validated.symbol,
      side: validated.side,
      qty: validated.qty,
      price: validated.price,
      testnet: validated.testnet,
      apiKey,
      apiSecret,
    });

    return NextResponse.json({
      ok: true,
      details: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, details: { error: 'Invalid request body', zodErrors: error.errors } },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: false,
      details: {
        error: error instanceof Error ? error.message : 'Failed to place order',
      },
    });
  }
}
