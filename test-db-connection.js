// Test database connection with Vercel's @vercel/postgres
// Load .env.local file (Next.js convention)
require('dotenv').config({ path: '.env.local' });

// Copy STORAGE_POSTGRES_URL to POSTGRES_URL if needed
if (!process.env.POSTGRES_URL && process.env.STORAGE_POSTGRES_URL) {
  process.env.POSTGRES_URL = process.env.STORAGE_POSTGRES_URL;
  console.log('✓ Using STORAGE_POSTGRES_URL');
}

const { sql } = require('@vercel/postgres');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    console.log('Using env var:', process.env.POSTGRES_URL ? 'POSTGRES_URL (or STORAGE_POSTGRES_URL)' : 'Not found');
    
    const result = await sql`SELECT NOW() as current_time`;
    console.log('✅ Connected successfully!');
    console.log('Current time:', result.rows[0].current_time);
    
    // Check if our tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    
    console.log('\n📋 Tables in database:');
    if (tables.rows.length === 0) {
      console.log('  ⚠️  No tables found - run: node run-schema.js');
    } else {
      tables.rows.forEach(row => console.log(`  ✓ ${row.table_name}`));
    }
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testConnection();
