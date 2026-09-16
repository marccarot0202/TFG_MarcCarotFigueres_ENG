const axios = require('axios');

const OLLAMA_URL = 'http://localhost:11434/api/generate';

async function askOllama(prompt, model = 'llama3.2') {
  try {
    console.log('📤 Sending prompt to Ollama...');
    console.log('📏 Length of prompt:', prompt.length);

    const response = await axios.post(
      OLLAMA_URL,
      {
        model,
        prompt,
        stream: false,
      },
      {
        timeout: 0,
      },
    );

    console.log("📥 Received raw response from Ollama");

    return response.data.response;
  } catch (error) {
    console.error('Error calling Ollama:', error.message);

    if (error.response) {
      console.error("Ollama status:", error.response.status);
      console.error("Ollama data:", error.response.data);
    }

    throw error;
  }
}

module.exports = { askOllama };
