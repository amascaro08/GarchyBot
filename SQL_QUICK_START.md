# 🚀 Quick Start: Run SQL Schema

## Method 1: Neon Console (Easiest)

1. Open: https://console.neon.tech
2. Select your project
3. Click "SQL Editor"
4. Copy everything from `schema.sql`
5. Paste and click "Run"

## Method 2: Command Line

```bash
psql "postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require" -f schema.sql
```

## Method 3: Node.js Script

Save this as `run-schema.js`:

```javascript
const { Client } = require('pg');
const fs = require('fs');

async function runSchema() {
  const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'
  });

  try {
    await client.connect();
    console.log('Connected to database');

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
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

runSchema();
```

Then run:
```bash
node run-schema.js
```

## Verify Installation

Run this query to check if everything is set up:

```sql
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output:
```
table_name       | column_count
-----------------+-------------
activity_logs    | 7
bot_configs      | 22
trades           | 18
users            | 5
```

## Test Queries

```sql
-- Check demo user exists
SELECT * FROM users WHERE email = 'demo@example.com';

-- Check demo bot config exists
SELECT * FROM bot_configs;

-- View all tables
\dt
```

## Troubleshooting

**Error: relation already exists**
- Tables already created, you're good!

**Error: permission denied**
- Check your connection string
- Verify you're using the correct credentials

**Error: connection refused**
- Check your internet connection
- Verify Neon project is active
