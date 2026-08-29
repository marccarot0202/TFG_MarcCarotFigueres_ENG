function scoreContext(tx, context) {
  let score = 0;
  const issues = [];

  if (context.knownAddress) {
    if (context.knownAddress.type === 'scam') {
      score += 80;
      issues.push(
        `Address labelled as scam by ${context.knownAddress.source}`,
      );
    } else if (context.knownAddress.type === 'suspicious') {
      score += 50;
      issues.push(`Suspicious address according to ${context.knownAddress.source}`);
    }
  }

  if (tx.is_infinite_approve) {
    score += 70;
    issues.push('Unlimited approve detected');
  }

  if (tx.type === 'setApprovalForAll') {
    score += 70;
    issues.push('setApprovalForAll detected: full permission over NFTs or tokens');
  }

  if (context.contractCache) {
    if (context.contractCache.risk_level === 'HIGH') {
      score += 40;
      issues.push('Contract previously analysed as HIGH risk');
    } else if (context.contractCache.risk_level === 'MEDIUM') {
      score += 20;
      issues.push('Contract previously analysed as MEDIUM risk');
    }
  }

  if (context.etherscan && context.etherscan.fetched) {
    if (!context.etherscan.verified) {
      score += 25;
      issues.push('Contracte no verificat a Etherscan');
    }

    if (context.etherscan.sourceCode) {
      const source = context.etherscan.sourceCode.toLowerCase();

      if (source.includes('delegatecall')) {
        score += 30;
        issues.push('Use of delegatecall was detected');
      }

      if (source.includes('selfdestruct')) {
        score += 35;
        issues.push('Use of selfdestruct was detected');
      }

      if (source.includes('tx.origin')) {
        score += 20;
        issues.push('Use of tx.origin was detected');
      }
    }
  }

  if (context.similarTransactions?.length > 0) {
    const highRiskCount = context.similarTransactions
      .filter((tx) => tx.risk_level === 'HIGH')
      .reduce((acc, tx) => acc + tx.count, 0);

    if (highRiskCount > 0) {
      score += 15;
      issues.push("Hi ha transaccions similars amb risc ALT a l'historial");
    }
  }

  let risk_level = 'LOW';
  if (score >= 70) risk_level = 'HIGH';
  else if (score >= 35) risk_level = 'MEDIUM';

  return {
    risk_score: Math.min(score, 100),
    risk_level,
    issues,
  };
}

module.exports = { scoreContext };
