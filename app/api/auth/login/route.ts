import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { get } from '@vercel/edge-config';

/**
 * Login endpoint - creates or validates authentication token
 * POST /api/auth/login
 * Body: { token?: string, bybitApiKey?: string, bybitApiSecret?: string, testnet?: boolean }
 * 
 * If token is provided, validates it and updates credentials if provided
 * If no token, generates a new one
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, bybitApiKey, bybitApiSecret, testnet } = body;

    // If token provided, validate and update
    if (token) {
      // Validate token format (should match the label pattern)
      if (typeof token !== 'string' || token.length < 10) {
        return NextResponse.json(
          { error: 'Invalid token format' },
          { status: 400 }
        );
      }

      // Store user config via Edge Config API
      // Note: We'll use Vercel's Edge Config API via fetch
      const edgeConfigToken = process.env.EDGE_CONFIG_TOKEN;
      const edgeConfigUrl = process.env.EDGE_CONFIG_URL;

      if (!edgeConfigToken || !edgeConfigUrl) {
        return NextResponse.json(
          { error: 'Edge Config not configured. Please set EDGE_CONFIG_TOKEN and EDGE_CONFIG_URL environment variables.' },
          { status: 500 }
        );
      }

      const userKey = `user:${token}`;
      const userConfig = {
        token,
        bybitApiKey: bybitApiKey || undefined,
        bybitApiSecret: bybitApiSecret || undefined,
        testnet: testnet !== undefined ? testnet : true,
        createdAt: Date.now(),
        lastActive: Date.now(),
      };

      // Update Edge Config via Vercel API
      try {
        // Extract connection string ID from URL (format: https://edge-config.vercel.com/ecfg_xxx)
        const connectionStringId = edgeConfigUrl.split('/').pop()?.split('?')[0];
        
        const response = await fetch(
          `https://api.vercel.com/v1/edge-config/${connectionStringId}/items`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${edgeConfigToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              items: [
                {
                  operation: 'upsert',
                  key: userKey,
                  value: userConfig,
                },
              ],
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Edge Config API error:', errorText);
          return NextResponse.json(
            { error: 'Failed to store user configuration' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          token,
          message: 'Token validated and credentials updated',
        });
      } catch (error) {
        console.error('Error updating Edge Config:', error);
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        );
      }
    }

    // Generate new token if none provided
    const newToken = crypto.randomBytes(32).toString('hex');
    
    const edgeConfigToken = process.env.EDGE_CONFIG_TOKEN;
    const edgeConfigUrl = process.env.EDGE_CONFIG_URL;

    if (!edgeConfigToken || !edgeConfigUrl) {
      return NextResponse.json(
        { error: 'Edge Config not configured' },
        { status: 500 }
      );
    }

    const userKey = `user:${newToken}`;
    const userConfig = {
      token: newToken,
      bybitApiKey: bybitApiKey || undefined,
      bybitApiSecret: bybitApiSecret || undefined,
      testnet: testnet !== undefined ? testnet : true,
      createdAt: Date.now(),
      lastActive: Date.now(),
    };

    try {
      // Extract connection string ID from URL
      const connectionStringId = edgeConfigUrl.split('/').pop()?.split('?')[0];
      
      // Get existing active tokens
      let activeTokens: string[] = [];
      try {
        const activeTokensStr = await get<string>('active_tokens');
        if (activeTokensStr) {
          activeTokens = JSON.parse(activeTokensStr);
        }
      } catch (e) {
        // Ignore if active_tokens doesn't exist yet
      }
      
      // Add new token to active tokens list
      const updatedActiveTokens = [...new Set([...activeTokens, newToken])];
      
      const response = await fetch(
        `https://api.vercel.com/v1/edge-config/${connectionStringId}/items`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${edgeConfigToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [
              {
                operation: 'upsert',
                key: userKey,
                value: userConfig,
              },
              // Also add token to active tokens list
              {
                operation: 'upsert',
                key: 'active_tokens',
                value: JSON.stringify(updatedActiveTokens),
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Edge Config API error:', errorText);
        return NextResponse.json(
          { error: 'Failed to create user configuration' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        token: newToken,
        message: 'New token generated',
      });
    } catch (error) {
      console.error('Error creating Edge Config:', error);
      return NextResponse.json(
        { error: 'Failed to create configuration' },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 500 }
    );
  }
}
