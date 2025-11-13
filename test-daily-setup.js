/**
 * Test script to manually run daily setup and see GARCH debug logs
 * 
 * Usage: 
 * 1. Make sure dev server is running: npm run dev
 * 2. Run this script: node test-daily-setup.js
 * 
 * The logs will appear in the terminal where you ran "npm run dev"
 */

// Use global fetch if available (Node 18+), otherwise need node-fetch
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testDailySetup() {
  try {
    console.log('🚀 Testing daily setup endpoint...');
    console.log(`📡 Calling: ${BASE_URL}/api/cron/daily-setup`);
    console.log('📝 Note: Check the terminal running "npm run dev" for detailed GARCH debug logs\n');
    
    // Use GET method (endpoint allows GET for testing)
    const response = await fetch(`${BASE_URL}/api/cron/daily-setup`, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error response:', response.status, response.statusText);
      console.error('Response body:', errorText);
      process.exit(1);
    }
    
    const data = await response.json();
    
    console.log('\n✅ Daily setup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`  Processed: ${data.processed || 0} symbols`);
    console.log(`  Successful: ${data.successful || 0}`);
    console.log(`  Failed: ${data.failed || 0}`);
    
    if (data.results && Array.isArray(data.results)) {
      console.log('\n📈 Results for each symbol:');
      data.results.forEach((result, idx) => {
        if (result.success) {
          console.log(`\n  ${result.symbol || `Symbol ${idx + 1}`}:`);
          console.log(`    Volatility: ${((result.volatility || 0) * 100).toFixed(4)}%`);
          console.log(`    Daily Open: $${(result.dailyOpenPrice || 0).toFixed(2)}`);
          console.log(`    Upper Range: $${(result.upperRange || 0).toFixed(2)}`);
          console.log(`    Lower Range: $${(result.lowerRange || 0).toFixed(2)}`);
          console.log(`    Data Points: ${result.dataPoints || 0} days`);
        } else {
          console.log(`\n  ${result.symbol || `Symbol ${idx + 1}`}: ❌ Failed - ${result.error || 'Unknown error'}`);
        }
      });
    }
    
    console.log('\n💡 Tip: Check the terminal running "npm run dev" for detailed [GARCH-DEBUG] logs');
    console.log('   The logs show forecasted sigmas for each model and the averaging process.\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure the dev server is running:');
      console.error('   Run "npm run dev" in another terminal first\n');
    }
    console.error(error.stack);
    process.exit(1);
  }
}

testDailySetup();

