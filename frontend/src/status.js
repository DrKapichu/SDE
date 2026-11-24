export const STATUS = {
  DELIVERED: 'delivered',
  TO_DELIVER: 'to_deliver'
};

export const STATUS_META = {
  [STATUS.DELIVERED]: {
    label: 'Delivered',
    color: '#16a34a',
    ring: '#bbf7d0',
    badgeBg: '#dcfce7',
    badgeText: '#166534'
  },
  [STATUS.TO_DELIVER]: {
    label: 'To Deliver',
    color: '#2563eb',
    ring: '#bfdbfe',
    badgeBg: '#dbeafe',
    badgeText: '#1e40af'
  }
};

/**
 * Computes delivery status for a gym record (two states only):
 *  - Green (delivered):  BOTH "Déposées en salle par" AND "Nombre d'affiches" are valued.
 *  - Blue  (to_deliver): All other gyms.
 */
export function getGymStatus(gym) {
  const deliveredBy = String(gym['Déposées en salle par'] ?? '').trim();
  const rawPosters = String(gym["Nombre d'affiches"] ?? '').trim();
  const parsedPosters = Number(rawPosters);
  const hasPosters = rawPosters.length > 0 && (Number.isNaN(parsedPosters) || parsedPosters > 0);

  if (deliveredBy.length > 0 && hasPosters) {
    return STATUS.DELIVERED;
  }

  return STATUS.TO_DELIVER;
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
