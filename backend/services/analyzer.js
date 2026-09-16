const { askOllama } = require('./ollama');
const { normalizeTx } = require('./normalizeTx');
const { decodeKnownTransaction } = require('./decoder');
const { buildDeterministicVerdict } = require('./rules');
const {
  saveAnalysisHistory,
  updateAnalysisPerformance,
  upsertAddressCache,
  getAddressCache,
  findRecentAnalysisByTarget,
  lookupAddress,
} = require('./database');

function buildContextSummary(tx) {
  const parts = [];

  if (tx.from) parts.push(`Des de: ${tx.from}`);
  if (tx.to) parts.push(`Cap a: ${tx.to}`);
  if (tx.origin) parts.push(`Origen: ${tx.origin}`);
  if (tx.method_selector) parts.push(`Selector: ${tx.method_selector}`);

  if (tx.decoded?.method === 'approve') {
    parts.push('Method: approve');
    parts.push(`Spender: ${tx.decoded.spender}`);
    parts.push(`Amount: ${tx.decoded.amount}`);
    parts.push(
      `Unlimited approval: ${tx.decoded.is_infinite_approval ? 'yes' : 'no'}`,
    );
  }

  if (tx.decoded?.method === 'setApprovalForAll') {
    parts.push('Method: setApprovalForAll');
    parts.push(`Operator: ${tx.decoded.operator}`);
    parts.push(`Approved: ${tx.decoded.approved ? 'yes' : 'no'}`);
  }

  if (tx.has_value) {
    parts.push(`Value: ${tx.value}`);
  }

  return parts.join(' | ');
}

async function explainTransaction(
  tx,
  verdict,
  localMemorySignals = null,
  semanticFacts = null,
) {
  const findingsText = verdict.findings
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n');

  const memoryText =
    localMemorySignals && localMemorySignals.findings.length > 0
      ? localMemorySignals.findings.map((f, i) => `M${i + 1}. ${f}`).join('\n')
      : 'There are no additional local memory signals';

  const prompt = `
You are a Web3 security assistant.
Explain the transaction IN ENGLISH and VERY SIMPLY, based ONLY on the confirmed findings.

CONFIRMED DATA:
- Risk computed by the rules: ${verdict.risk_level}
- Recommended action: ${verdict.recommended_action}

MAIN FINDINGS:
${findingsText}

LOCAL MEMORY:
${memoryText}

INSTRUCTIONS:
1. Answer in 2 or 3 short sentences, no more
2. Do not use markdown
3. Do not invent functions or purposes that are not confirmed
4. If it is an approve, say it is a permission to move tokens, NOT a transfer
5. If the approval is unlimited, say so clearly
6. If there is local memory, mention it only as additional context
7. Do not use words such as "suspicious", "unusual pattern", "suspicious activity" or similar, unless explicitly confirmed
8. Do not use alarmist language
9. Write for a non-technical person

Explanation:
  `.trim();

  try {
    const rawExplanation = await askOllama(prompt);
    return sanitizeExplanation(rawExplanation, verdict, semanticFacts || {});
  } catch (error) {
    console.error('⚠️ Error generating the AI explanation:', error.message);
    return buildSafeExplanation(verdict, semanticFacts || {});
  }
}

async function persistLocalAddressMemory(tx) {
  const chainId = tx.chainId || null;
  const methodSelector = tx.method_selector || null;

  const tasks = [];

  if (tx.from) {
    tasks.push(
      upsertAddressCache({
        address: tx.from,
        chainId,
        label: 'sender',
        notes: "Sender address seen in a local analysis",
        lastMethodSelector: methodSelector,
      }),
    );
  }

  if (tx.to) {
    tasks.push(
      upsertAddressCache({
        address: tx.to,
        chainId,
        label: 'target',
        notes: 'Recipient address seen in a local analysis',
        lastMethodSelector: methodSelector,
      }),
    );
  }

  if (tx.decoded?.method === 'approve' && tx.decoded.spender) {
    tasks.push(
      upsertAddressCache({
        address: tx.decoded.spender,
        chainId,
        label: 'spender',
        notes: tx.decoded.is_infinite_approval
          ? 'Address seen as spender with an unlimited approval'
          : 'Address seen as spender with a limited approval',
        lastMethodSelector: methodSelector,
      }),
    );
  }

  if (tx.decoded?.method === 'setApprovalForAll' && tx.decoded.operator) {
    tasks.push(
      upsertAddressCache({
        address: tx.decoded.operator,
        chainId,
        label: 'operator',
        notes: tx.decoded.approved
          ? 'Address seen as operator with an active global permission'
          : 'Address seen as operator with a global permission revocation',
        lastMethodSelector: methodSelector,
      }),
    );
  }

  await Promise.all(tasks);
}

async function collectLocalMemorySignals(tx) {
  const chainId = tx.chainId || null;
  const signals = {
    cached_addresses: {},
    recent_similar_analysis: [],
    findings: [],
  };

  const addressesToCheck = [];

  if (tx.to) {
    addressesToCheck.push({ key: 'target', address: tx.to });
  }

  if (tx.decoded?.method === 'approve' && tx.decoded.spender) {
    addressesToCheck.push({ key: 'spender', address: tx.decoded.spender });
  }

  if (tx.decoded?.method === 'setApprovalForAll' && tx.decoded.operator) {
    addressesToCheck.push({ key: 'operator', address: tx.decoded.operator });
  }

  for (const item of addressesToCheck) {
    const cached = await getAddressCache(item.address, chainId);
    if (cached) {
      signals.cached_addresses[item.key] = cached;

      if ((cached.times_seen || 0) > 1) {
        if (item.key === 'target') {
          signals.findings.push(
            `The recipient address has been seen before (${cached.times_seen} times) in local analyses`,
          );
        } else if (item.key === 'spender') {
          signals.findings.push(
            `The authorised address has been seen before (${cached.times_seen} times) in local analyses`,
          );
        } else if (item.key === 'operator') {
          signals.findings.push(
            `The operator has been seen before (${cached.times_seen} times) in local analyses`,
          );
        }
      }
    }
  }

  if (tx.to) {
    const recent = await findRecentAnalysisByTarget(
      tx.to,
      tx.method_selector,
      10,
    );
    signals.recent_similar_analysis = recent;

    const totalSimilar = recent.reduce((acc, row) => acc + (row.count || 0), 0);

    if (totalSimilar > 0) {
      signals.findings.push(
        `There are ${totalSimilar} recent similar analyses for this destination${tx.method_selector ? ' and this selector' : ''}`,
      );
    }
  }

  return signals;
}

async function collectKnownAddressSignals(tx) {
  const signals = {
    matches: {},
    findings: [],
    score_adjustment: 0,
    forced_risk_level: null,
  };

  const addressesToCheck = [];

  if (tx.to) {
    addressesToCheck.push({ key: 'target', address: tx.to });
  }

  if (tx.decoded?.method === 'approve' && tx.decoded.spender) {
    addressesToCheck.push({ key: 'spender', address: tx.decoded.spender });
  }

  if (tx.decoded?.method === 'setApprovalForAll' && tx.decoded.operator) {
    addressesToCheck.push({ key: 'operator', address: tx.decoded.operator });
  }

  for (const item of addressesToCheck) {
    const match = await lookupAddress(item.address);

    if (!match) {
      continue;
    }

    signals.matches[item.key] = match;

    const label = match.label || 'no label';
    const type = String(match.type || '').toLowerCase();
    const source = match.source || 'unknown source';

    if (item.key === 'target') {
      signals.findings.push(
        `The recipient address is labelled as "${label}" (${type || 'no type'})`,
      );
    } else if (item.key === 'spender') {
      signals.findings.push(
        `The authorised address is labelled as "${label}" (${type || 'no type'})`,
      );
    } else if (item.key === 'operator') {
      signals.findings.push(
        `The operator is labelled as "${label}" (${type || 'no type'})`,
      );
    }

    signals.findings.push(`Label source: ${source}`);

    if (type === 'scam' || type === 'blacklist' || type === 'blacklisted') {
      signals.score_adjustment += 50;
      signals.forced_risk_level = 'HIGH';
      signals.findings.push('The label indicates a known critical risk');
      continue;
    }

    if (type === 'warning' || type === 'suspicious') {
      signals.score_adjustment += 25;

      if (signals.forced_risk_level !== 'HIGH') {
        signals.forced_risk_level = 'MEDIUM';
      }

      if (source.includes('darklist')) {
        signals.findings.push(
          'The address appears in an external darklist and must be treated as potentially high risk',
        );
      } else {
        signals.findings.push(
          'The label indicates an address that requires special caution',
        );
      }

      continue;
    }

    if (
      type === 'trusted' ||
      type === 'known_protocol' ||
      type === 'test_contract' ||
      type === 'own_contract'
    ) {
      signals.score_adjustment -= 10;
      signals.findings.push(
        'The label provides trust or test context',
      );
    }
  }

  return signals;
}

function safeJsonParseFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty response or non-textual');
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }

  if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
    try {
      return JSON.parse(`${trimmed}}`);
    } catch (_) {}
  }

  throw new Error('Could not extract valid JSON');
}

function normalizeAiRiskHint(value, fallback) {
  const text = String(value || '')
    .trim()
    .toUpperCase();

  if (text === 'LOW') return 'LOW';
  if (text === 'MEDIUM') return 'MEDIUM';
  if (text === 'HIGH') return 'HIGH';

  return fallback;
}

function normalizeConfidence(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();

  if (text === 'low') return 'low';
  if (text === 'medium') return 'medium';
  if (text === 'high') return 'high';

  return 'medium';
}

function containsAny(text, terms) {
  const normalized = String(text || '').toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

const unlimitedPermissionTerms = [
  'unlimited',
  'infinite',
  'without limit',
  'no limit',
  'unrestricted',
];

const globalPermissionTerms = [
  'global permission',
  'global approval',
  'global',
  'all your assets',
  'all the assets',
  'all your nft',
  'all the nfts',
  'entire collection',
  'whole collection',
];

const ethTransferTerms = ['sends eth', 'send eth', 'sending eth', 'transfers eth'];

const maliciousActivityTerms = [
  'phishing',
  'fraud',
  'malicious',
  'darklist',
  'blacklist',
  'scam',
];

const tokenPermissionTerms = [
  'permission to move token',
  'allowed to move token',
  'allows moving token',
  'allows to move token',
  'authorised to move token',
  'authorized to move token',
  'token approval',
  'token authorisation',
  'token authorization',
  'approve token',
  'spend your token',
  'spend tokens on your behalf',
];

function buildSemanticFacts(
  tx,
  deterministicVerdict,
  knownAddressSignals,
  localMemorySignals,
) {
  const knownMatches = Object.values(knownAddressSignals?.matches || {});
  const knownTypes = knownMatches.map((match) =>
    String(match?.type || '').toLowerCase(),
  );

  const recentSimilarCount = Array.isArray(
    localMemorySignals?.recent_similar_analysis,
  )
    ? localMemorySignals.recent_similar_analysis.reduce(
        (acc, row) => acc + (row.count || 0),
        0,
      )
    : 0;

  return {
    method: tx.decoded?.method || 'unknown',
    isInfiniteApproval: !!tx.decoded?.is_infinite_approval,
    isGlobalApproval:
      tx.decoded?.method === 'setApprovalForAll' && !!tx.decoded?.approved,
    isRevocation:
      (tx.decoded?.method === 'approve' && tx.decoded?.amount === '0') ||
      (tx.decoded?.method === 'setApprovalForAll' &&
        tx.decoded?.approved === false),
    sendsValue: !!tx.has_value,
    deterministicRisk: deterministicVerdict.risk_level,
    hasKnownAddressMatch: knownMatches.length > 0,
    hasKnownAddressRiskLabel: knownTypes.some((type) =>
      ['warning', 'suspicious', 'scam', 'blacklist', 'blacklisted'].includes(
        type,
      ),
    ),
    hasKnownAddressCriticalLabel: knownTypes.some((type) =>
      ['scam', 'blacklist', 'blacklisted'].includes(type),
    ),
    hasKnownAddressTrustedLabel: knownTypes.some((type) =>
      ['trusted', 'known_protocol', 'test_contract', 'own_contract'].includes(
        type,
      ),
    ),
    recentSimilarCount,
    repeatedTarget:
      Number(localMemorySignals?.cached_addresses?.target?.times_seen || 0) > 1,
    repeatedSensitiveAddress:
      Number(localMemorySignals?.cached_addresses?.spender?.times_seen || 0) >
        1 ||
      Number(localMemorySignals?.cached_addresses?.operator?.times_seen || 0) >
        1,
  };
}

function buildSafeReviewerSummary(facts) {
  if (facts.isInfiniteApproval) {
    return 'The operation requires review because it grants an unlimited approval.';
  }

  if (facts.isGlobalApproval) {
    return 'The operation requires review because it enables a global permission.';
  }

  if (facts.hasKnownAddressCriticalLabel) {
    return 'The operation requires review because the address involved is labelled as high risk.';
  }

  if (facts.hasKnownAddressRiskLabel) {
    return 'The operation requires review because the address involved carries a caution label.';
  }

  if (facts.deterministicRisk === 'MEDIUM') {
    return 'The operation requires review because of the detected context.';
  }

  return 'No additional observations from the AI.';
}

function buildSafeExplanation(verdict, facts) {
  let sentence1 = 'An operation that should be reviewed was detected.';
  let sentence2 = '';
  let sentence3 = '';

  if (facts.method === 'approve') {
    if (facts.isInfiniteApproval) {
      sentence1 =
        'A token approval with an unlimited permission was detected.';
      sentence2 =
        'This would let the authorised address move tokens without asking for permission again.';
    } else if (facts.isRevocation) {
      sentence1 = 'A token approval revocation was detected.';
      sentence2 = 'In this case no new broad permission is being granted.';
    } else {
      sentence1 =
        'A token approval with a limited permission was detected.';
      sentence2 =
        'This only allows moving the authorised amount; it does not grant an unlimited permission.';
    }
  } else if (facts.isGlobalApproval) {
    sentence1 = 'A global permission over assets was detected.';
    sentence2 =
      'This would let the operator manage every asset covered by this permission.';
  } else if (facts.method === 'setApprovalForAll' && facts.isRevocation) {
    sentence1 = 'A global permission revocation was detected.';
    sentence2 = 'In this case the previous authorisation is being withdrawn.';
  } else if (facts.deterministicRisk === 'MEDIUM') {
    sentence1 =
      'An interaction with a contract that requires review was detected.';
    sentence2 =
      'The specific function is not clear enough to consider it safe.';
  } else if (facts.deterministicRisk === 'LOW') {
    sentence1 =
      'This looks like a simple transfer with no additional risk indicators.';
    sentence2 = 'No token permission was detected in this operation.';
  }

  if (facts.hasKnownAddressCriticalLabel) {
    sentence3 =
      'In addition, the address involved is labelled as high risk in the local database.';
  } else if (facts.hasKnownAddressRiskLabel) {
    sentence3 =
      'In addition, the address involved carries a caution label in the local database.';
  } else if (facts.recentSimilarCount > 0) {
    sentence3 =
      'In addition, there are previous similar local analyses, which adds extra context.';
  }

  return [sentence1, sentence2, sentence3].filter(Boolean).join(' ');
}

function sanitizeAiReview(aiReview, facts) {
  let aiRiskHint = normalizeAiRiskHint(
    aiReview?.ai_risk_hint,
    facts.deterministicRisk,
  );
  let confidence = normalizeConfidence(aiReview?.confidence);
  let aiFlags = Array.isArray(aiReview?.ai_flags)
    ? aiReview.ai_flags
        .filter((x) => typeof x === 'string' && x.trim())
        .slice(0, 3)
    : [];
  let reviewerSummary =
    typeof aiReview?.reviewer_summary === 'string' &&
    aiReview.reviewer_summary.trim()
      ? aiReview.reviewer_summary.trim()
      : buildSafeReviewerSummary(facts);

  if (facts.isInfiniteApproval || facts.isGlobalApproval) {
    aiRiskHint = 'HIGH';
  }

  const hasObjectiveEscalationSignal =
    facts.isInfiniteApproval ||
    facts.isGlobalApproval ||
    facts.hasKnownAddressRiskLabel;

  if (facts.deterministicRisk === 'LOW' && !hasObjectiveEscalationSignal) {
    aiRiskHint = 'LOW';
    reviewerSummary = buildSafeReviewerSummary(facts);
  }

  if (!facts.isInfiniteApproval) {
    aiFlags = aiFlags.filter(
      (flag) => !containsAny(flag, unlimitedPermissionTerms),
    );
    if (containsAny(reviewerSummary, unlimitedPermissionTerms)) {
      reviewerSummary = buildSafeReviewerSummary(facts);
    }
  }

  if (!facts.isGlobalApproval) {
    aiFlags = aiFlags.filter(
      (flag) => !containsAny(flag, globalPermissionTerms),
    );
    if (containsAny(reviewerSummary, globalPermissionTerms)) {
      reviewerSummary = buildSafeReviewerSummary(facts);
    }
  }

  if (!facts.sendsValue) {
    aiFlags = aiFlags.filter((flag) => !containsAny(flag, ethTransferTerms));
    if (containsAny(reviewerSummary, ethTransferTerms)) {
      reviewerSummary = buildSafeReviewerSummary(facts);
    }
  }

  if (!facts.hasKnownAddressRiskLabel) {
    aiFlags = aiFlags.filter(
      (flag) => !containsAny(flag, maliciousActivityTerms),
    );
    if (containsAny(reviewerSummary, maliciousActivityTerms)) {
      reviewerSummary = buildSafeReviewerSummary(facts);
    }
  }

  if (!reviewerSummary || reviewerSummary.length > 220) {
    reviewerSummary = buildSafeReviewerSummary(facts);
  }

  return {
    ai_risk_hint: aiRiskHint,
    confidence,
    ai_flags: aiFlags,
    reviewer_summary: reviewerSummary,
    raw_response: aiReview?.raw_response || null,
  };
}

function sanitizeExplanation(explanation, verdict, facts) {
  let text = String(explanation || '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\bM\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const hasContradiction =
    (!facts.isInfiniteApproval &&
      containsAny(text, unlimitedPermissionTerms)) ||
    (!facts.isGlobalApproval && containsAny(text, globalPermissionTerms)) ||
    (!facts.sendsValue && containsAny(text, ethTransferTerms)) ||
    (!facts.hasKnownAddressRiskLabel &&
      containsAny(text, maliciousActivityTerms)) ||
    (facts.method !== 'approve' &&
      facts.method !== 'setApprovalForAll' &&
      containsAny(text, tokenPermissionTerms));

  if (!text || text.length > 420 || hasContradiction) {
    return buildSafeExplanation(verdict, facts);
  }

  return text;
}

async function reviewWithAI(
  tx,
  deterministicVerdict,
  localMemorySignals,
  semanticFacts,
) {
  let raw = null;

  const findingsText = deterministicVerdict.findings.slice(0, 6).join(' | ');
  const memoryText =
    localMemorySignals && localMemorySignals.findings.length > 0
      ? localMemorySignals.findings.slice(0, 3).join(' | ')
      : 'No additional signals';

  const prompt = `
Return ONLY valid JSON.
Do not add any text before or after.
Do not use markdown.

You are a complementary Web3 security reviewer.
Do not replace the base risk.

DATA:
- Base risk: ${deterministicVerdict.risk_level}
- Method: ${semanticFacts.method}
- Unlimited approval: ${semanticFacts.isInfiniteApproval ? 'yes' : 'no'}
- Active global permission: ${semanticFacts.isGlobalApproval ? 'yes' : 'no'}
- Revocation: ${semanticFacts.isRevocation ? 'yes' : 'no'}
- Address with risk label: ${semanticFacts.hasKnownAddressRiskLabel ? 'yes' : 'no'}
- Labelled critical risk: ${semanticFacts.hasKnownAddressCriticalLabel ? 'yes' : 'no'}
- Recent similar analyses: ${semanticFacts.recentSimilarCount}
- Findings: ${findingsText}
- Local memory: ${memoryText}

MANDATORY RULES:
- If "Unlimited approval" is "yes", ai_risk_hint must be "HIGH"
- If "Active global permission" is "yes", ai_risk_hint must be "HIGH"
- If there is no unlimited approval, do not talk about unlimited approvals
- If there is no global permission, do not talk about global permissions
- Do not invent phishing, scam or malicious intent if there is no risk label
- confidence can only be: "low", "medium" or "high"
- ai_flags must be an array of 0 to 3 short sentences written in English
- reviewer_summary must be a short, objective sentence written in English

Exact format:
{"ai_risk_hint":"HIGH","confidence":"medium","ai_flags":["unlimited approval detected","repeated use in local memory"],"reviewer_summary":"The operation requires review because of its high risk."}
  `.trim();

  try {
    raw = await askOllama(prompt);
    const parsed = safeJsonParseFromText(raw);

    return sanitizeAiReview(
      {
        ai_risk_hint: parsed.ai_risk_hint,
        confidence: parsed.confidence,
        ai_flags: parsed.ai_flags,
        reviewer_summary: parsed.reviewer_summary,
        raw_response: raw,
      },
      semanticFacts,
    );
  } catch (error) {
    console.error('⚠️ Error in the AI reviewer:', error.message);
    console.error('⚠️ Raw response from the AI reviewer:', raw);

    return sanitizeAiReview(
      {
        ai_risk_hint: deterministicVerdict.risk_level,
        confidence: 'low',
        ai_flags: [],
        reviewer_summary:
          "Additional observations from the AI could not be generated",
        raw_response: raw,
      },
      semanticFacts,
    );
  }
}

function fuseVerdicts(deterministicVerdict, aiReview) {
  const baseRisk = deterministicVerdict.risk_level;
  const aiRisk = aiReview?.ai_risk_hint || baseRisk;

  if (baseRisk === 'HIGH') {
    return {
      risk_level: 'HIGH',
      source: 'deterministic_priority',
      reason: 'The deterministic engine detected a known critical pattern',
    };
  }

  if (baseRisk === 'MEDIUM' && aiRisk === 'HIGH') {
    return {
      risk_level: 'HIGH',
      source: 'hybrid_escalation',
      reason: 'The AI reinforces caution on a case that was already uncertain',
    };
  }

  if (baseRisk === 'LOW' && aiRisk === 'HIGH') {
    return {
      risk_level: 'MEDIUM',
      source: 'ai_escalation',
      reason:
        'The AI detected additional signals that justify more caution',
    };
  }

  return {
    risk_level: baseRisk,
    source: 'deterministic_base',
    reason: 'No sufficient reasons to alter the base verdict',
  };
}

async function analyzeTransaction(rawTxData) {
  const analysisStartedAt = Date.now();
  const tx = normalizeTx(rawTxData);
  tx.decoded = decodeKnownTransaction(tx);

  console.log('🧩 Normalised transaction:', tx);
  console.log('🔎 Decoded transaction:', tx.decoded);

  const localMemorySignals = await collectLocalMemorySignals(tx);
  console.log('🧠 Local memory:', localMemorySignals);

  const knownAddressSignals = await collectKnownAddressSignals(tx);
  console.log('🏷️ Known addresses:', knownAddressSignals);

  const deterministicVerdict = buildDeterministicVerdict(tx);

  if (localMemorySignals.findings.length > 0) {
    deterministicVerdict.findings = [
      ...deterministicVerdict.findings,
      ...localMemorySignals.findings,
    ];
  }

  if (knownAddressSignals.findings.length > 0) {
    deterministicVerdict.findings = [
      ...deterministicVerdict.findings,
      ...knownAddressSignals.findings,
    ];
  }

  if (knownAddressSignals.score_adjustment !== 0) {
    deterministicVerdict.risk_score = Math.max(
      0,
      Math.min(
        100,
        deterministicVerdict.risk_score + knownAddressSignals.score_adjustment,
      ),
    );
  }

  if (knownAddressSignals.forced_risk_level === 'HIGH') {
    deterministicVerdict.risk_level = 'HIGH';
    deterministicVerdict.recommended_action = 'REVIEW';
  } else if (
    knownAddressSignals.forced_risk_level === 'MEDIUM' &&
    deterministicVerdict.risk_level === 'LOW'
  ) {
    deterministicVerdict.risk_level = 'MEDIUM';
    deterministicVerdict.recommended_action = 'REVIEW';
  }

  const semanticFacts = buildSemanticFacts(
    tx,
    deterministicVerdict,
    knownAddressSignals,
    localMemorySignals,
  );
  console.log('🧱 Semantic facts:', semanticFacts);

  const aiReviewStartedAt = Date.now();
  const aiReview = await reviewWithAI(
    tx,
    deterministicVerdict,
    localMemorySignals,
    semanticFacts,
  );
  const aiReviewMs = Date.now() - aiReviewStartedAt;
  console.log('🤖 AI review:', aiReview);

  const finalVerdict = fuseVerdicts(deterministicVerdict, aiReview);
  console.log('⚖️ Final verdict:', finalVerdict);

  console.log('🛡️ Deterministic verdict:', deterministicVerdict);

  const explanationStartedAt = Date.now();
  const explanation = await explainTransaction(
    tx,
    deterministicVerdict,
    localMemorySignals,
    semanticFacts,
  );
  const explanationMs = Date.now() - explanationStartedAt;

  const performance = {
    started_at: new Date(analysisStartedAt).toISOString(),
    ai_review_ms: aiReviewMs,
    explanation_ms: explanationMs,
    pre_persistence_ms: Date.now() - analysisStartedAt,
    persistence_ms: null,
    total_backend_ms: null,
  };

  const analysisResult = {
    risk_level: deterministicVerdict.risk_level,
    risk_score: deterministicVerdict.risk_score,
    recommended_action: deterministicVerdict.recommended_action,
    issues: deterministicVerdict.findings,
    findings: deterministicVerdict.findings,
    explanation,
    context_summary: buildContextSummary(tx),
    normalized_tx: tx,
    decoded: tx.decoded,
    deterministic_verdict: deterministicVerdict,
    local_memory_signals: localMemorySignals,
    known_address_signals: knownAddressSignals,
    ai_review: aiReview,
    final_verdict: finalVerdict,
    semantic_facts: semanticFacts,
    analysis_id: null,
    performance,
    evaluation: rawTxData.evaluation || null,
  };

  try {
    const persistenceStartedAt = Date.now();
    const analysisId = await saveAnalysisHistory(rawTxData, analysisResult);
    analysisResult.analysis_id = analysisId;
    await persistLocalAddressMemory(tx);
    performance.persistence_ms = Date.now() - persistenceStartedAt;
    performance.total_backend_ms = Date.now() - analysisStartedAt;
    await updateAnalysisPerformance(analysisId, performance);
    console.log('💾 Analysis saved to the database');
  } catch (dbError) {
    performance.total_backend_ms = Date.now() - analysisStartedAt;
    console.error(
      '⚠️ Error saving the analysis to the database:',
      dbError.message,
    );
  }

  return analysisResult;
}

module.exports = {
  analyzeTransaction,
  sanitizeAiReview,
  sanitizeExplanation,
};
