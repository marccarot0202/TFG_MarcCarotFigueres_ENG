import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { Box, Text, Bold, Heading } from '@metamask/snaps-sdk/jsx';

/**
 * Calls the backend to analyse a transaction.
 */

function formatBulletList(items: string[], maxItems = 5): string {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Sense elements';
  }

  return items
    .slice(0, maxItems)
    .map((item) => `• ${item}`)
    .join('\n');
}

function renderBulletTexts(items: string[], maxItems = 5, prefix = 'item') {
  if (!Array.isArray(items) || items.length === 0) {
    return <Text>• Sense elements</Text>;
  }

  return (
    <Box>
      {items.slice(0, maxItems).map((item, index) => (
        <Text key={`${prefix}-${index}`}>• {item}</Text>
      ))}
    </Box>
  );
}

async function analyzeTransaction(txData: any) {
  try {
    const response = await fetch('http://localhost:3000/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(txData),
    });

    if (!response.ok) {
      throw new Error(`Error del backend: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error cridant el backend:', error);
    return {
      success: false,
      error: "No s'ha pogut connectar amb el backend",
      risk: 'UNKNOWN',
      risk_score: 0,
      issues: ['Could not retrieve the analysis from the backend'],
      findings: ['Could not retrieve the analysis from the backend'],
      explanation: 'Connection error',
      verdict: {
        risk: 'UNKNOWN',
        risk_score: 0,
        recommended_action: 'REVIEW',
      },
      final_verdict: {
        risk_level: 'UNKNOWN',
        source: 'fallback',
        reason: "No s'ha pogut obtenir el veredicte final",
      },
      ai_review: {
        ai_risk_hint: 'UNKNOWN',
        confidence: 'baja',
        ai_flags: [],
        reviewer_summary: 'Could not retrieve the AI review',
      },
      local_memory_signals: {
        findings: [],
      },
    };
  }
}

/**
 * Emoji segons el risc.
 */
function getRiskEmoji(risk: string): string {
  switch ((risk || '').toUpperCase()) {
    case 'LOW':
      return '✅';
    case 'MEDIUM':
      return '⚠️';
    case 'HIGH':
      return '🔴';
    default:
      return '❓';
  }
}

/**
 * Main risk shown in the interface: the final verdict takes priority.
 */
function getDisplayedRisk(analysis: any): string {
  return (
    analysis?.final_verdict?.risk_level ||
    analysis?.verdict?.risk ||
    analysis?.risk ||
    'UNKNOWN'
  );
}

function getRecommendedAction(analysis: any): string {
  const finalRisk =
    analysis?.final_verdict?.risk_level ||
    analysis?.verdict?.risk ||
    analysis?.risk ||
    'UNKNOWN';

  if (finalRisk === 'HIGH' || finalRisk === 'MEDIUM') {
    return 'REVIEW';
  }

  if (finalRisk === 'LOW') {
    return analysis?.verdict?.recommended_action || 'ALLOW';
  }

  return 'REVIEW';
}

function getRiskLabel(risk: string): string {
  switch ((risk || '').toUpperCase()) {
    case 'LOW':
      return 'LOW';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'HIGH':
      return 'HIGH';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return risk || 'UNKNOWN';
  }
}

function getActionLabel(action: string): string {
  switch ((action || '').toUpperCase()) {
    case 'ALLOW':
      return 'Allow';
    case 'REVIEW':
      return 'Review carefully';
    case 'BLOCK':
      return 'Block';
    default:
      return 'Review';
  }
}

function getExplanation(analysis: any): string {
  return analysis?.explanation || 'No explanation available';
}

function getFindings(analysis: any): string[] {
  if (Array.isArray(analysis?.findings) && analysis.findings.length > 0) {
    return analysis.findings;
  }

  if (Array.isArray(analysis?.issues) && analysis.issues.length > 0) {
    return analysis.issues;
  }

  return ['No specific findings were detected'];
}

function getLocalContextFindings(analysis: any): string[] {
  if (
    Array.isArray(analysis?.local_memory_signals?.findings) &&
    analysis.local_memory_signals.findings.length > 0
  ) {
    return analysis.local_memory_signals.findings;
  }

  return [];
}

function getAiFlags(analysis: any): string[] {
  if (
    Array.isArray(analysis?.ai_review?.ai_flags) &&
    analysis.ai_review.ai_flags.length > 0
  ) {
    return analysis.ai_review.ai_flags;
  }

  return [];
}

function getAiSummary(analysis: any): string {
  return (
    analysis?.ai_review?.reviewer_summary ||
    'Sense observacions addicionals de la IA'
  );
}

function getAiConfidence(analysis: any): string {
  return analysis?.ai_review?.confidence || 'baja';
}

function getConfidenceLabel(confidence: string): string {
  switch ((confidence || '').toLowerCase()) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return confidence || 'low';
  }
}

function getFinalReason(analysis: any): string {
  return analysis?.final_verdict?.reason || 'Sense cap motiu addicional';
}

function getFinalSource(analysis: any): string {
  return analysis?.final_verdict?.source || 'deterministic_base';
}

function splitPrimaryAndLocalFindings(analysis: any): {
  primaryFindings: string[];
  localContextFindings: string[];
} {
  const allFindings = getFindings(analysis);
  const localContextFindings = getLocalContextFindings(analysis);

  const localSet = new Set(localContextFindings);

  const primaryFindings = allFindings.filter(
    (finding: string) => !localSet.has(finding),
  );

  return {
    primaryFindings,
    localContextFindings,
  };
}

function prioritizeFindings(findings: string[]): string[] {
  const highPriority = findings.filter((finding) => {
    const text = finding.toLowerCase();

    return (
      text.includes('is labelled as') ||
      text.includes('label source') ||
      text.includes('known critical risk') ||
      text.includes('requires special caution') ||
      text.includes('local database') ||
      text.includes('darklist') ||
      text.includes('blacklist')
    );
  });

  const rest = findings.filter((finding) => !highPriority.includes(finding));

  return [...highPriority, ...rest];
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'deterministic_priority':
      return 'Deterministic rules (priority)';
    case 'hybrid_escalation':
      return 'Hybrid escalation';
    case 'ai_escalation':
      return 'Escalated by AI review';
    case 'deterministic_base':
      return 'Deterministic baseline';
    case 'fallback':
      return 'Fallback mode';
    default:
      return source || 'Unknown';
  }
}

/**
 * Main analysis interface.
 */
function renderAnalysisCard(analysis: any, chainId: string, origin?: string) {
  const displayedRisk = getDisplayedRisk(analysis);
  const recommendedAction = getRecommendedAction(analysis);
  const explanation = getExplanation(analysis);
  const { primaryFindings, localContextFindings } =
    splitPrimaryAndLocalFindings(analysis);
  const orderedPrimaryFindings = prioritizeFindings(primaryFindings);
  const aiFlags = getAiFlags(analysis);
  const aiSummary = getAiSummary(analysis);
  const aiConfidence = getAiConfidence(analysis);
  const finalReason = getFinalReason(analysis);
  const finalSource = getFinalSource(analysis);

  return (
    <Box>
      <Heading>{getRiskEmoji(displayedRisk)} Security analysis</Heading>

      <Text>
        <Bold>Veredicte final:</Bold> {getRiskLabel(displayedRisk)}
      </Text>

      <Text>
        <Bold>Recommended action:</Bold> {getActionLabel(recommendedAction)}
      </Text>

      <Text>
        <Bold>Font del veredicte:</Bold> {getSourceLabel(finalSource)}
      </Text>

      <Text>
        <Bold>Motiu principal:</Bold> {finalReason}
      </Text>

      <Text>
        <Bold>Indicis principals:</Bold>
      </Text>
      {renderBulletTexts(orderedPrimaryFindings, 8, 'primary')}

      {localContextFindings.length > 0 ? (
        <Box>
          <Text>
            <Bold>Context local:</Bold>
          </Text>
          {renderBulletTexts(localContextFindings, 3, 'local')}
        </Box>
      ) : null}

      <Text>
        <Bold>AI review:</Bold>
      </Text>

      <Text>{aiSummary}</Text>

      <Text>
        <Bold>AI confidence:</Bold> {getConfidenceLabel(aiConfidence)}
      </Text>

      {aiFlags.length > 0 ? renderBulletTexts(aiFlags, 3, 'ai-flag') : null}

      <Text>
        <Bold>Final explanation:</Bold>
      </Text>

      <Text>{explanation}</Text>

      <Text>
        <Bold>Xarxa:</Bold> {chainId}
      </Text>

      <Text>
        <Bold>Origin:</Bold> {origin || 'Unknown'}
      </Text>
    </Box>
  );
}

/**
 * Automatic hook for outgoing transactions.
 */
export const onTransaction = async ({
  transaction,
  chainId,
  transactionOrigin,
}: {
  transaction: any;
  chainId: string;
  transactionOrigin?: string;
}) => {
  console.log('🔍 Intercepting a real transaction:', transaction);

  const txData = {
    type: 'transaction',
    chainId,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value || '0',
    data: transaction.data || '0x',
    origin: transactionOrigin,
  };

  const analysis = await analyzeTransaction(txData);

  return {
    content: renderAnalysisCard(analysis, chainId, transactionOrigin),
  };
};

/**
 * Manual RPC methods.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({
  origin,
  request,
}) => {
  switch (request.method) {
    case 'hello':
      return snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: (
            <Box>
              <Text>
                Hola, <Bold>{origin}</Bold>!
              </Text>
              <Text>
                This confirmation checks the communication with the Snap.
              </Text>
              <Text>The connection is working correctly.</Text>
            </Box>
          ),
        },
      });

    case 'analyzeTransaction': {
      const txData = (request as any).params?.transaction || {
        type: 'approve',
        contract: '0x1234...',
        amount: 'unlimited',
      };

      const analysis = await analyzeTransaction(txData);

      return snap.request({
        method: 'snap_dialog',
        params: {
          type: 'alert',
          content: renderAnalysisCard(
            analysis,
            txData.chainId || 'Desconeguda',
            origin,
          ),
        },
      });
    }

    default:
      throw new Error('Method not found.');
  }
};
