import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, createSession } from '@/lib/auth';
import { getUserByEmail, createUser, createBotConfig } from '@/lib/db';

/**
 * Register a new user
 * POST /api/auth/register
 * Body: { email, password, invitationCode }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, invitationCode } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password length
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Validate invitation code
    const requiredCode = process.env.REGISTRATION_CODE;
    if (!requiredCode) {
      return NextResponse.json(
        { error: 'Registration is not configured. Please contact administrator.' },
        { status: 500 }
      );
    }

    if (!invitationCode || invitationCode !== requiredCode) {
      return NextResponse.json(
        { error: 'Invalid invitation code' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user with password hash
    const { sql } = await import('@/lib/db');
    const result = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id, email, created_at, updated_at
    `;
    const user = result.rows[0];

    // Create default bot config for user
    await createBotConfig(user.id);

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
    console.error('Error registering user:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to register user' },
      { status: 500 }
    );
  }
}

