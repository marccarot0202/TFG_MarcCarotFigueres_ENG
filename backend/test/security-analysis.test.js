const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { decodeKnownTransaction } = require('../services/decoder');
const { buildDeterministicVerdict } = require('../services/rules');
const {
  sanitizeAiReview,
  sanitizeExplanation,
} = require('../services/analyzer');

const MAX_UINT256_HEX = 'f'.repeat(64);
const SPENDER = '1234567890abcdef1234567890abcdef12345678';
const APPROVE_DATA = `0x095ea7b3${'0'.repeat(24)}${SPENDER}${MAX_UINT256_HEX}`;

function buildApproveData(amount) {
  return `0x095ea7b3${'0'.repeat(24)}${SPENDER}${amount
    .toString(16)
    .padStart(64, '0')}`;
}

test('decodes the inherited ERC20 approve selector as an infinite approval', () => {
  const decoded = decodeKnownTransaction({
    method_selector: '0x095ea7b3',
    data: APPROVE_DATA,
  });

  assert.equal(decoded.method, 'approve');
  assert.equal(decoded.spender, `0x${SPENDER}`);
  assert.equal(decoded.is_infinite_approval, true);
});

test('classifies an infinite ERC20 approval as high risk', () => {
  const decoded = decodeKnownTransaction({
    method_selector: '0x095ea7b3',
    data: APPROVE_DATA,
  });
  const verdict = buildDeterministicVerdict({ decoded });

  assert.equal(verdict.risk_level, 'HIGH');
  assert.equal(verdict.risk_score, 90);
  assert.equal(verdict.recommended_action, 'REVIEW');
});

test('keeps a finite ERC20 approval at low risk', () => {
  const data = buildApproveData(2000n);
  const decoded = decodeKnownTransaction({
    method_selector: '0x095ea7b3',
    data,
  });
  const verdict = buildDeterministicVerdict({ decoded });

  assert.equal(decoded.is_infinite_approval, false);
  assert.equal(verdict.risk_level, 'LOW');
  assert.equal(verdict.risk_score, 20);
  assert.equal(verdict.recommended_action, 'ALLOW');
});

test('classifies approve with amount zero as a low-risk revocation', () => {
  const data = buildApproveData(0n);
  const decoded = decodeKnownTransaction({
    method_selector: '0x095ea7b3',
    data,
  });
  const verdict = buildDeterministicVerdict({ decoded });

  assert.equal(decoded.amount, '0');
  assert.equal(verdict.risk_level, 'LOW');
  assert.equal(verdict.risk_score, 5);
  assert.equal(verdict.recommended_action, 'ALLOW');
});

test('prevents AI from escalating low risk without an objective signal', () => {
  const review = sanitizeAiReview(
    {
      ai_risk_hint: 'HIGH',
      confidence: 'medium',
      ai_flags: ['repeated use in local memory'],
      reviewer_summary: 'The operation requires review because of its high risk',
      raw_response: '{"ai_risk_hint":"HIGH"}',
    },
    {
      deterministicRisk: 'LOW',
      isInfiniteApproval: false,
      isGlobalApproval: false,
      sendsValue: false,
      hasKnownAddressRiskLabel: false,
    },
  );

  assert.equal(review.ai_risk_hint, 'LOW');
  assert.equal(
    review.reviewer_summary,
    'No additional observations from the AI.',
  );
  assert.equal(review.confidence, 'medium');
  assert.equal(review.raw_response, '{"ai_risk_hint":"HIGH"}');
});

test('removes invented token permissions from a simple transaction explanation', () => {
  const explanation = sanitizeExplanation(
    'This looks like a simple transfer. It is a permission to move tokens.',
    { risk_level: 'LOW' },
    {
      method: 'unknown',
      deterministicRisk: 'LOW',
      isInfiniteApproval: false,
      isGlobalApproval: false,
      sendsValue: false,
      hasKnownAddressRiskLabel: false,
    },
  );

  assert.match(explanation, /simple transfer/);
  assert.doesNotMatch(explanation, /permission to move tokens/);
});

test('removes equivalent wording that invents token movement', () => {
  const explanation = sanitizeExplanation(
    'The transaction is safe. It allows moving tokens because the computed risk is low.',
    { risk_level: 'LOW' },
    {
      method: 'unknown',
      deterministicRisk: 'LOW',
      isInfiniteApproval: false,
      isGlobalApproval: false,
      sendsValue: false,
      hasKnownAddressRiskLabel: false,
    },
  );

  assert.match(explanation, /simple transfer/);
  assert.doesNotMatch(explanation, /allows moving tokens/);
});

test('migrates and persists the complete analysis without changing old columns', async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tfg-db-test-'),
  );
  const databasePath = path.join(temporaryDirectory, 'history.db');
  process.env.WEB3_SECURITY_DB_PATH = databasePath;

  const database = require('../services/database');

  try {
    await database.initDB();

    const rawTx = {
      chainId: '0xaa36a7',
      from: `0x${'1'.repeat(40)}`,
      to: `0x${'2'.repeat(40)}`,
      value: '0x0',
      data: APPROVE_DATA,
      origin: 'http://localhost:8000',
    };
    const analysis = {
      risk_level: 'HIGH',
      risk_score: 90,
      recommended_action: 'REVIEW',
      findings: ['The approval is unlimited'],
      explanation: 'Test explanation',
      context_summary: 'Method: approve',
      normalized_tx: {
        ...rawTx,
        method_selector: '0x095ea7b3',
      },
      decoded: decodeKnownTransaction({
        method_selector: '0x095ea7b3',
        data: APPROVE_DATA,
      }),
      deterministic_verdict: { risk_level: 'HIGH' },
      local_memory_signals: { findings: ['Local context'] },
      known_address_signals: { matches: {}, findings: [] },
      ai_review: { ai_risk_hint: 'HIGH', confidence: 'medium' },
      final_verdict: {
        risk_level: 'HIGH',
        source: 'deterministic_priority',
        reason: 'Known critical pattern',
      },
      semantic_facts: { isInfiniteApproval: true },
      performance: { total_backend_ms: 125, ai_review_ms: 80 },
      evaluation: { scenario: 'A', repetition: 1, expected_risk: 'HIGH' },
    };

    const id = await database.saveAnalysisHistory(rawTx, analysis);
    const detail = await database.getAnalysisHistoryDetail(id);

    assert.equal(detail.risk_level, 'HIGH');
    assert.equal(detail.final_verdict.source, 'deterministic_priority');
    assert.equal(detail.ai_review.confidence, 'medium');
    assert.equal(detail.known_address_signals.findings.length, 0);
    assert.equal(detail.local_memory_signals.findings[0], 'Local context');
    assert.equal(detail.semantic_facts.isInfiniteApproval, true);
    assert.equal(detail.performance.total_backend_ms, 125);
    assert.equal(detail.evaluation.scenario, 'A');
  } finally {
    await database.closeDB();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    delete process.env.WEB3_SECURITY_DB_PATH;
  }
});
