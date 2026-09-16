const axios = require('axios');

async function testBackend() {
  try {
    console.log('🧪 Testing the backend with Ollama...\n');

    const response = await axios.post('http://localhost:3000/analyze', {
      type: 'approve',
      contract: '0x1234...',
      amount: 'unlimited',
    });

    console.log('✅ Correct response:\n');
    console.log('🔴 Risk:', response.data.risk);
    console.log('\n📝 Explanation:');
    console.log(response.data.explanation);
    console.log('\n⏰ Timestamp:', response.data.timestamp);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Answer:', error.response.data);
    }
  }
}

testBackend();
