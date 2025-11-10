const { Client } = require('pg');
const fs = require('fs');

async function runSchema() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || 'postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    const sql = fs.readFileSync('schema.sql', 'utf8');
    await client.query(sql);
    
    console.log('✅ Schema created successfully!');
    
    // Verify tables
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📋 Tables created:');
    result.rows.forEach(row => console.log(`  ✓ ${row.table_name}`));

    // Check demo user
    const userResult = await client.query(`SELECT * FROM users WHERE email = 'demo@example.com'`);
    if (userResult.rows.length > 0) {
      console.log('\n👤 Demo user created: demo@example.com');
    }

    // Check bot config
    const botResult = await client.query(`SELECT * FROM bot_configs`);
    console.log(`\n🤖 Bot configs: ${botResult.rows.length}`);
    
    console.log('\n🎉 Database setup complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSchema();
