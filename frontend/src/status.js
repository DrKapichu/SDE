export const STATUS = {
  DELIVERED: 'delivered',
  READY: 'ready',
  PENDING: 'pending',
  NONE: 'none'
};

export const STATUS_META = {
  [STATUS.DELIVERED]: {
    label: 'Livrée',
    shortLabel: 'Delivered',
    color: '#16a34a',
    ring: '#bbf7d0',
    badgeBg: '#dcfce7',
    badgeText: '#166534'
  },
  [STATUS.READY]: {
    label: 'À livrer',
    shortLabel: 'To Deliver',
    color: '#2563eb',
    ring: '#bfdbfe',
    badgeBg: '#dbeafe',
    badgeText: '#1e40af'
  },
  [STATUS.PENDING]: {
    label: 'Contactée',
    shortLabel: 'Pending',
    color: '#ea580c',
    ring: '#fed7aa',
    badgeBg: '#ffedd5',
    badgeText: '#9a3412'
  },
  [STATUS.NONE]: {
    label: 'Non contactée',
    shortLabel: 'Not Contacted',
    color: '#64748b',
    ring: '#e2e8f0',
    badgeBg: '#f1f5f9',
    badgeText: '#334155'
  }
};

const POSITIVE_ACCORD_REGEX = /^(oui|ok|okay|yes|valid[eé]e?|d'?accord|accept[eé]e?|confirm[eé]e?|positif|true|1|✓|✔|👍)/i;

/**
 * Determines whether the Accord column indicates a positive agreement.
 */
export function isAccordPositive(accordValue) {
  const str = String(accordValue ?? '').trim();
  if (!str) return false;
  if (/^(non|no|refus|pas\s)/i.test(str)) return false;
  return POSITIVE_ACCORD_REGEX.test(str);
}

/**
 * Computes delivery status for a gym record according to business rules:
 *  - Green (delivered): "Déposées en salle par" non-empty OR "Nombre d'affiches" > 0
 *  - Blue  (ready):     "Accord" looks positive and not yet delivered
 *  - Orange (pending):  "Contacté le" non-empty, no positive "Accord" yet
 *  - Gray  (none):      Default
 */
export function getGymStatus(gym) {
  const deliveredBy = String(gym['Déposées en salle par'] ?? '').trim();
  const posterCount = Number(gym["Nombre d'affiches"]);

  if (deliveredBy.length > 0 || (Number.isFinite(posterCount) && posterCount > 0)) {
    return STATUS.DELIVERED;
  }

  if (isAccordPositive(gym['Accord'])) {
    return STATUS.READY;
  }

  const contactedOn = String(gym['Contacté le'] ?? '').trim();
  if (contactedOn.length > 0) {
    return STATUS.PENDING;
  }

  return STATUS.NONE;
}

export function hasValidCoords(gym) {
  const lat = Number(gym.Lat);
  const lng = Number(gym.Lng);
  return (
    gym.Lat !== null &&
    gym.Lat !== '' &&
    gym.Lng !== null &&
    gym.Lng !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function matchesFilter(gym, filterKey, searchQuery) {
  const status = getGymStatus(gym);
  if (filterKey !== 'all' && status !== filterKey) {
    return false;
  }

  const q = String(searchQuery || '').trim().toLowerCase();
  if (!q) return true;

  const nom = String(gym['NOM'] ?? '').toLowerCase();
  const loc = String(gym['Localisation'] ?? '').toLowerCase();
  const addr = String(gym['Adresse'] ?? '').toLowerCase();
  return nom.includes(q) || loc.includes(q) || addr.includes(q);
}
