const RISK_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  UNKNOWN: 'Unknown',
};

const ACTION_LABELS: Record<string, string> = {
  ALLOW: 'Allow',
  REVIEW: 'Review',
  BLOCK: 'Block',
};

const ADDRESS_TYPE_LABELS = new Map<string, string>([
  ['warning', 'Warning'],
  ['suspicious', 'Suspicious'],
  ['scam', 'Scam'],
  ['blacklist', 'Blacklist'],
  ['blacklisted', 'Blacklist'],
  ['trusted', 'Trusted'],
  ['known_protocol', 'Known protocol'],
  ['test_contract', 'Test contract'],
  ['own_contract', 'Own contract'],
]);

const SOURCE_LABELS = new Map<string, string>([
  ['user_manual_report', 'Manual report'],
  ['mew_ethereum_lists_darklist', 'MEW public list'],
]);

export const getRiskLabel = (risk?: string) => {
  if (!risk) {
    return 'Unknown';
  }

  return RISK_LABELS[risk.toUpperCase()] ?? risk;
};

export const getActionLabel = (action?: string) => {
  if (!action) {
    return 'No decision';
  }

  return ACTION_LABELS[action.toUpperCase()] ?? action;
};

export const getAddressTypeLabel = (type?: string) => {
  if (!type) {
    return 'No type';
  }

  return ADDRESS_TYPE_LABELS.get(type.toLowerCase()) ?? type;
};

export const getSourceLabel = (source?: string) => {
  if (!source) {
    return 'No source';
  }

  return SOURCE_LABELS.get(source.toLowerCase()) ?? source;
};

export const getMetricLabel = (label?: string) => {
  if (!label) {
    return 'Unknown';
  }

  return RISK_LABELS[label.toUpperCase()] ?? label;
};
