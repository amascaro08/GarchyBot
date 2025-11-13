/**
 * Authentication utilities for the trading bot
 * Uses cookie-based sessions with password authentication
 */

import { cookies } from 'next/headers';
import bcrypt from 'bcrypt';
import { sql } from './db';
import type { User } from './db';

const SESSION_COOKIE_NAME = 'garchy_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create a session for a user
 */
export async function createSession(userId: string, email: string): Promise<string> {
  const cookieStore = await cookies();
  
  // Store user ID in cookie (in production, you'd want to sign/encrypt this)
  cookieStore.set(SESSION_COOKIE_NAME, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });

  return userId;
}

/**
 * Get the current session user
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!userId) {
      return null;
    }

    // Verify user exists in database
    const result = await sql<User>`
      SELECT id, email FROM users WHERE id = ${userId} LIMIT 1
    `;
    
    const user = result.rows[0];
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
    };
  } catch (error) {
    console.error('Error getting session user:', error);
    return null;
  }
}

/**
 * Get authenticated user ID
 */
export async function getUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id || null;
}

/**
 * Get authenticated user email
 */
export async function getUserEmail(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.email || null;
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Destroy the current session
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
