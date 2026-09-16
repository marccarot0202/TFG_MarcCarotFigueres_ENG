const { initDB, getStats, addKnownAddress, closeDB } = require('./services/database');

async function test() {
  try {
    console.log('🧪 Initialising the database...');
    await initDB();
    
    console.log('📊 Initial statistics:');
    const stats = await getStats();
    console.log(stats);
    
    console.log('✅ Test completed');
    await closeDB();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

test();
