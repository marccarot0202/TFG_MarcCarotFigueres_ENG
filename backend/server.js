const express = require('express');
const cors = require('cors');

const {
  initDB,
  getDashboardStats,
  getRecentAnalysisHistory,
  getKnownAddresses,
  addKnownAddress,
  getDashboardMetrics,
  getAnalysisHistoryDetail,
} = require('./services/database');

const { analyzeTransaction } = require('./services/analyzer');
let databaseReady = false;

const app = express();
app.use(cors());
app.use(express.json());

async function checkOllama() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        status: 'error',
        message: `Ollama replied with status ${response.status}`,
      };
    }

    return {
      status: 'ok',
      message: 'Ollama available',
    };
  } catch (error) {
    console.warn('⚠️ Could not connect to Ollama:', error.message);
    return {
      status: 'error',
      message: 'Could not connect to Ollama',
    };
  }
}

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Backend working' });
});

app.get('/health', async (req, res) => {
  const ollamaStatus = await checkOllama();

  const health = {
    backend: {
      status: 'ok',
      message: 'Backend working',
    },
    database: {
      status: databaseReady ? 'ok' : 'error',
      message: databaseReady
        ? 'Database initialised'
        : 'Database not initialised',
    },
    ollama: ollamaStatus,
    timestamp: new Date().toISOString(),
  };

  const hasError =
    health.database.status !== 'ok' || health.ollama.status !== 'ok';

  res.status(hasError ? 503 : 200).json(health);
});

app.get('/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats();

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error retrieving the statistics:', error.message);

    res.status(500).json({
      success: false,
      error: 'Error retrieving the statistics',
      details: error.message,
    });
  }
});

app.get('/dashboard-metrics', async (req, res) => {
  try {
    const metrics = await getDashboardMetrics();

    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error retrieving the dashboard metrics:', error.message);

    res.status(500).json({
      success: false,
      error: 'Error retrieving the dashboard metrics',
      details: error.message,
    });
  }
});

app.get('/analysis-history', async (req, res) => {
  try {
    const limit = req.query.limit || 10;
    const rows = await getRecentAnalysisHistory(limit);

    res.json({
      success: true,
      history: rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error getting the analysis history:", error.message);

    res.status(500).json({
      success: false,
      error: "Error getting the analysis history",
      details: error.message,
    });
  }
});

app.get('/analysis-history/:id', async (req, res) => {
  try {
    const detail = await getAnalysisHistoryDetail(req.params.id);

    if (!detail) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found',
      });
    }

    res.json({
      success: true,
      detail,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error retrieving the analysis detail:', error.message);

    res.status(500).json({
      success: false,
      error: 'Error retrieving the analysis detail',
      details: error.message,
    });
  }
});

app.get('/known-addresses', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const type = req.query.type || null;
    const search = req.query.search || null;

    const addresses = await getKnownAddresses({
      limit,
      type,
      search,
    });

    res.json({
      success: true,
      addresses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error getting the known addresses:', error.message);

    res.status(500).json({
      success: false,
      error: 'Error getting the known addresses',
      details: error.message,
    });
  }
});

app.post('/known-addresses/manual', async (req, res) => {
  try {
    const { address, label, type } = req.body;

    if (!isValidEthereumAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'The Ethereum address is not valid',
      });
    }

    const cleanAddress = address.trim().toLowerCase();
    const cleanLabel =
      typeof label === 'string' && label.trim()
        ? label.trim()
        : "User's manual label";

    const cleanType = normalizeManualAddressType(type);

    await addKnownAddress(
      cleanAddress,
      cleanLabel,
      cleanType,
      'user_manual_report',
    );

    res.json({
      success: true,
      message: 'Address successfully added to the local dataset',
      address: {
        address: cleanAddress,
        label: cleanLabel,
        type: cleanType,
        source: 'user_manual_report',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error adding the manual address:', error.message);

    res.status(500).json({
      success: false,
      error: 'Error adding the manual address',
      details: error.message,
    });
  }
});

function isValidEthereumAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address || '').trim());
}

function normalizeManualAddressType(type) {
  const allowedTypes = [
    'warning',
    'suspicious',
    'scam',
    'blacklisted',
    'trusted',
    'test_contract',
    'own_contract',
  ];

  const normalized = String(type || '')
    .trim()
    .toLowerCase();

  if (allowedTypes.includes(normalized)) {
    return normalized;
  }

  return 'warning';
}

app.post('/analyze', async (req, res) => {
  try {
    const txData = req.body;

    console.log('📥 Analyzing:', txData);

    const analysis = await analyzeTransaction(txData);

    res.json({
      success: true,

      risk: analysis.final_verdict?.risk_level || analysis.risk_level,
      risk_score: analysis.risk_score,
      issues: analysis.issues,

      verdict: {
        risk: analysis.final_verdict?.risk_level || analysis.risk_level,
        risk_score: analysis.risk_score,
        recommended_action: analysis.recommended_action,
        source: analysis.final_verdict?.source || 'deterministic_base',
        reason: analysis.final_verdict?.reason || 'No additional reason',
      },

      findings: analysis.findings,
      explanation: analysis.explanation,
      context_summary: analysis.context_summary,
      normalized_tx: analysis.normalized_tx,
      decoded: analysis.decoded,
      deterministic_verdict: analysis.deterministic_verdict,
      local_memory_signals: analysis.local_memory_signals,
      ai_review: analysis.ai_review,
      final_verdict: analysis.final_verdict,
      analysis_id: analysis.analysis_id,
      performance: analysis.performance,
      evaluation: analysis.evaluation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error analyzing the transaction:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error analyzing the transaction',
      details: error.message,
    });
  }
});

const PORT = 3000;

async function bootstrap() {
  try {
    await initDB();
    databaseReady = true;

    app.listen(PORT, () => {
      console.log(`🚀 Backend working at http://localhost:${PORT}`);
      console.log(`🤖 Ollama waiting at http://localhost:11434`);
    });
  } catch (error) {
    console.error('❌ Error initializing the backend:', error.message);
    process.exit(1);
  }
}

bootstrap();
