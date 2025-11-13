import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchWalletBalance } from '@/lib/bybit';

const TestConnectionSchema = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  mode: z.enum(['demo', 'live']).default('demo'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, apiSecret, mode } = TestConnectionSchema.parse(body);

    const testnet = mode !== 'live';
    const result = await fetchWalletBalance({
      apiKey,
      apiSecret,
      testnet,
    });

    return NextResponse.json({
      success: true,
      wallet: result.result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to test connection';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

