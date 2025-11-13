import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, createSession } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db';
import { sql } from '@/lib/db';

/**
 * Login a user
 * POST /api/auth/login
 * Body: { email, password }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Get user by email
    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Get password hash from database
    const result = await sql<{ password_hash: string | null }>`
      SELECT password_hash FROM users WHERE id = ${user.id} LIMIT 1
    `;
    const passwordHash = result.rows[0]?.password_hash;

    if (!passwordHash) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Create session
    await createSession(user.id, user.email);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Error logging in user:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to login' },
      { status: 500 }
    );
  }
}

