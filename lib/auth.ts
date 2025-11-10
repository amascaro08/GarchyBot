/**
 * Auth utilities for the trading bot
 * Demo mode - add Clerk later if needed
 */

/**
 * Get authenticated user ID (demo mode)
 */
export async function getUserId(): Promise<string | null> {
  return 'demo-user-id';
}

/**
 * Get authenticated user email (demo mode)
 */
export async function getUserEmail(): Promise<string | null> {
  return process.env.DEMO_USER_EMAIL || 'demo@example.com';
}

/**
 * Require authentication (demo mode - always allowed)
 */
export async function requireAuth() {
  return {
    id: 'demo-user-id',
    email: process.env.DEMO_USER_EMAIL || 'demo@example.com',
  };
}
