import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OrderRequestSchema } from '@/lib/types';
import { placeOrder } from '@/lib/bybit';
import { get } from '@vercel/edge-config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = OrderRequestSchema.parse(body);
    const { token } = body;

    // Get credentials from Edge Config if token provided, otherwise use env vars
    let apiKey: string | undefined;
    let apiSecret: string | undefined;
    let testnet = validated.testnet;

    if (token) {
      try {
        const userKey = `user:${token}`;
        const userConfig = await get<any>(userKey);
        
        if (userConfig) {
          apiKey = userConfig.bybitApiKey;
          apiSecret = userConfig.bybitApiSecret;
          testnet = userConfig.testnet !== undefined ? userConfig.testnet : validated.testnet;
        }
      } catch (error) {
        console.error('Error fetching user config:', error);
      }
    }

    // Fallback to env vars if no token or no credentials in Edge Config
    if (!apiKey || !apiSecret) {
      apiKey = process.env.BYBIT_API_KEY;
      apiSecret = process.env.BYBIT_API_SECRET;
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({
        ok: false,
        details: { error: 'No API keys configured. Please provide token with credentials or set BYBIT_API_KEY and BYBIT_API_SECRET environment variables.' },
      });
    }

    // Place order
    const result = await placeOrder(
      validated.symbol,
      validated.side,
      validated.qty,
      validated.price,
      testnet,
      { apiKey, apiSecret }
    );

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
