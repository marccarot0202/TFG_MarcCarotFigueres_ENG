function buildDeterministicVerdict(tx) {
  const findings = [];
  let risk_level = 'LOW';
  let risk_score = 10;
  let recommended_action = 'ALLOW';

  if (tx.decoded?.method === 'approve') {
    findings.push('A token approval was detected');
    findings.push(`Authorised address: ${tx.decoded.spender}`);

    if (tx.decoded.is_infinite_approval) {
      findings.push('Approved amount: unlimited');
      findings.push('The approval is unlimited');
      findings.push(
        'The authorised address could move every allowed token without asking for permission again',
      );
      risk_level = 'HIGH';
      risk_score = 90;
      recommended_action = 'REVIEW';
    } else {
      findings.push(`Approved amount: ${tx.decoded.amount}`);
      findings.push('The approval is not unlimited');

      if (tx.decoded.amount === '0') {
        findings.push('This looks like an approval revocation');
        risk_level = 'LOW';
        risk_score = 5;
        recommended_action = 'ALLOW';
      } else {
        findings.push('A limited approval is being granted');
        risk_level = 'LOW';
        risk_score = 20;
        recommended_action = 'ALLOW';
      }
    }
  } else if (tx.decoded?.method === 'setApprovalForAll') {
    findings.push(
      'A global permission over NFT-like assets was detected',
    );
    findings.push(`Affected operator: ${tx.decoded.operator}`);

    if (tx.decoded.approved) {
      findings.push('A global permission is being enabled');
      findings.push(
        'The operator will be able to manage every asset covered by this permission',
      );
      risk_level = 'HIGH';
      risk_score = 95;
      recommended_action = 'REVIEW';
    } else {
      findings.push('The global permission is being revoked');
      risk_level = 'LOW';
      risk_score = 5;
      recommended_action = 'ALLOW';
    }
  } else if (tx.is_contract_interaction) {
    findings.push('The transaction interacts with a smart contract');

    if (tx.method_selector) {
      findings.push(`Detected selector: ${tx.method_selector}`);
      findings.push(
        'The exact function is not yet supported by the current decoder',
      );
    }

    risk_level = 'MEDIUM';
    risk_score = 50;
    recommended_action = 'REVIEW';
  } else {
    findings.push('This looks like a simple transfer');
    risk_level = 'LOW';
    risk_score = 10;
    recommended_action = 'ALLOW';
  }

  if (tx.has_value) {
    findings.push(`It also sends ETH: ${tx.value}`);
  }

  if (tx.origin) {
    findings.push(`Request origin: ${tx.origin}`);
  }

  return {
    findings,
    risk_level,
    risk_score,
    recommended_action,
  };
}

module.exports = {
  buildDeterministicVerdict,
};
