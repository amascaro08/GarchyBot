/**
 * Simple auth utilities for the trading bot
 * Currently using demo mode - can be upgraded to full auth later
 */

/**
 * Get user ID (demo mode for now)
 */
export async function getUserId(): Promise<string | null> {
  // Always use demo mode for now
  return 'demo-user-id';
}

/**
 * Get user email (demo mode for now)
 */
export async function getUserEmail(): Promise<string | null> {
  // Always use demo mode for now
  return process.env.DEMO_USER_EMAIL || 'demo@example.com';
}

/**
 * Require authentication - always allows in demo mode
 */
export async function requireAuth() {
  // Demo mode - always authenticated
  return {
    id: 'demo-user-id',
    email: process.env.DEMO_USER_EMAIL || 'demo@example.com',
  };
}
