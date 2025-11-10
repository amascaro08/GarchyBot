import { get } from '@vercel/edge-config';

export interface UserConfig {
  token: string; // Authentication token
  bybitApiKey?: string;
  bybitApiSecret?: string;
  testnet?: boolean;
  createdAt: number;
  lastActive: number;
}

export interface BotState {
  userId: string;
  botRunning: boolean;
  symbol: string;
  candleInterval: string;
  maxTrades: number;
  leverage: number;
  capital: number;
  riskAmount: number;
  riskType: 'fixed' | 'percent';
  dailyTargetType: 'fixed' | 'percent';
  dailyTargetAmount: number;
  dailyStopType: 'fixed' | 'percent';
  dailyStopAmount: number;
  dailyPnL: number;
  dailyStartDate: string;
  sessionPnL: number;
  trades: any[];
  garchMode: 'auto' | 'custom';
  customKPct: number;
  useOrderBookConfirm: boolean;
  lastPollTime?: number;
}

/**
 * Get user configuration from Edge Config
 * Uses the token as the key
 */
export async function getUserConfig(token: string): Promise<UserConfig | null> {
  try {
    const key = `user:${token}`;
    const config = await get<UserConfig>(key);
    return config || null;
  } catch (error) {
    console.error('Error fetching user config:', error);
    return null;
  }
}

/**
 * Store user configuration in Edge Config
 * Note: Edge Config is read-only via API, so we'll need to use Vercel's API
 * For now, we'll use a workaround with environment variables or a separate storage
 * Actually, Edge Config can be written via Vercel API, but we'll create an API route for this
 */
export async function setUserConfig(token: string, config: Partial<UserConfig>): Promise<boolean> {
  // This will be handled by an API route that uses Vercel's Edge Config API
  // For now, return true as a placeholder
  return true;
}

/**
 * Get bot state from Edge Config
 */
export async function getBotState(userId: string): Promise<BotState | null> {
  try {
    const key = `bot:${userId}`;
    const state = await get<BotState>(key);
    return state || null;
  } catch (error) {
    console.error('Error fetching bot state:', error);
    return null;
  }
}

/**
 * Store bot state in Edge Config
 */
export async function setBotState(userId: string, state: Partial<BotState>): Promise<boolean> {
  // This will be handled by an API route
  return true;
}

/**
 * Verify authentication token
 */
export async function verifyToken(token: string): Promise<UserConfig | null> {
  const userConfig = await getUserConfig(token);
  if (!userConfig) {
    return null;
  }
  
  // Update last active time
  userConfig.lastActive = Date.now();
  await setUserConfig(token, { lastActive: userConfig.lastActive });
  
  return userConfig;
}
