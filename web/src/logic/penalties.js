export const LIMITS = { label: 40, description: 200, custom: 6 };

/** Options offered on the penalty setup screen for a scheme. */
export function penaltyOptions(settings) {
  switch (settings.penaltyScheme) {
    case 'drink': return [{ type: 'drink', label: 'drink' }];
    case 'dare': return [{ type: 'dare', label: 'dare' }];
    case 'custom': return settings.customPenalties.slice(0, LIMITS.custom).map((p) => ({ type: 'custom', label: p.label, description: p.description || '' }));
    default: return [{ type: 'drink', label: 'drink' }, { type: 'dare', label: 'dare' }];
  }
}

export function validatePenalty(p) {
  const errors = [];
  if (!p || !p.type) errors.push('type');
  if (p && p.label && p.label.length > LIMITS.label) errors.push('label');
  if (p && p.description && p.description.length > LIMITS.description) errors.push('description');
  return errors;
}

export function validateCustomList(list) {
  if (!Array.isArray(list) || list.length > LIMITS.custom) return false;
  return list.every((p) => p.label && p.label.trim() && p.label.length <= LIMITS.label && (!p.description || p.description.length <= LIMITS.description));
}
