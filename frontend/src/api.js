import { getConfig } from './config.js';
import { INITIAL_MOCK_GYMS } from './mockData.js';

let mockStore = INITIAL_MOCK_GYMS.map((g) => ({ ...g }));
const photoCache = new Map(); // key (fileId or mock key) -> { dataUrl, name }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits a gym's Photo cell (newline-separated URLs) into individual entries.
 */
export function parsePhotoLinks(photoCell) {
  return String(photoCell || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extracts a Google Drive file ID from a Drive URL.
 */
export function extractDriveFileId(url) {
  const str = String(url || '').trim();
  const byPath = str.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (byPath) return byPath[1];
  const byQuery = str.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (byQuery) return byQuery[1];
  return null;
}

/**
 * Fetches all gyms from Google Apps Script (or local mock store when useMock is enabled).
 */
export async function fetchGyms() {
  const cfg = getConfig();

  if (cfg.useMock) {
    await sleep(220);
    return {
      gyms: mockStore.map((g) => ({ ...g })),
      meta: {
        total: mockStore.length,
        geocodedThisRequest: 0,
        remainingToGeocode: 0,
        updatedAt: new Date().toISOString(),
        mock: true
      }
    };
  }

  if (!cfg.apiUrl || !cfg.apiToken) {
    const err = new Error('Veuillez configurer l’URL Apps Script et votre API Token.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const url = new URL(cfg.apiUrl);
  url.searchParams.set('token', cfg.apiToken);

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Erreur réseau (${response.status})`);
  }

  const data = await response.json();
  if (!data || data.ok !== true) {
    const err = new Error(data?.error || 'Réponse invalide du serveur Apps Script.');
    err.status = data?.status;
    throw err;
  }

  return {
    gyms: Array.isArray(data.gyms) ? data.gyms : [],
    meta: data.meta || {}
  };
}

/**
 * Updates fields for a single gym row via POST (text/plain CORS workaround for GAS).
 */
export async function updateGym(rowIndex, expectedNom, updates) {
  const cfg = getConfig();

  if (cfg.useMock) {
    await sleep(300);
    const idx = mockStore.findIndex((g) => g.rowIndex === rowIndex);
    if (idx === -1) {
      throw new Error(`Ligne ${rowIndex} introuvable.`);
    }
    mockStore[idx] = { ...mockStore[idx], ...updates };
    return { ...mockStore[idx] };
  }

  if (!cfg.apiUrl || !cfg.apiToken) {
    const err = new Error('Configuration API manquante.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const response = await fetch(cfg.apiUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      token: cfg.apiToken,
      rowIndex,
      expectedNom,
      updates
    })
  });

  if (!response.ok) {
    throw new Error(`Erreur réseau (${response.status})`);
  }

  const data = await response.json();
  if (!data || data.ok !== true) {
    const err = new Error(data?.error || 'Échec de la mise à jour.');
    err.status = data?.status;
    throw err;
  }

  return data.gym;
}

/**
 * Uploads a compressed proof-of-delivery photo to the private Drive folder
 * and appends its link to the gym's Photo cell.
 */
export async function uploadGymPhoto(rowIndex, expectedNom, { base64, mimeType, dataUrl }) {
  const cfg = getConfig();

  if (cfg.useMock) {
    await sleep(350);
    const idx = mockStore.findIndex((g) => g.rowIndex === rowIndex);
    if (idx === -1) {
      throw new Error(`Ligne ${rowIndex} introuvable.`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const mockKey = `mock://photo_${rowIndex}_${stamp}.jpg`;
    photoCache.set(mockKey, { dataUrl, name: `${expectedNom || 'Salle'}_${stamp}.jpg` });

    const existing = String(mockStore[idx]['Photo'] || '').trim();
    mockStore[idx] = {
      ...mockStore[idx],
      Photo: existing ? `${existing}\n${mockKey}` : mockKey
    };
    return { gym: { ...mockStore[idx] }, url: mockKey };
  }

  if (!cfg.apiUrl || !cfg.apiToken) {
    const err = new Error('Configuration API manquante.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const response = await fetch(cfg.apiUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      token: cfg.apiToken,
      action: 'uploadPhoto',
      rowIndex,
      expectedNom,
      photo: { base64, mimeType }
    })
  });

  if (!response.ok) {
    throw new Error(`Erreur réseau (${response.status})`);
  }

  const data = await response.json();
  if (!data || data.ok !== true) {
    const err = new Error(data?.error || 'Échec de l’envoi de la photo.');
    err.status = data?.status;
    throw err;
  }

  if (data.photo?.fileId && dataUrl) {
    photoCache.set(data.photo.fileId, {
      dataUrl,
      name: data.photo.name || 'Photo'
    });
  }

  return { gym: data.gym, photo: data.photo };
}

/**
 * Fetches a private Drive photo via the Apps Script proxy (authenticated with API_TOKEN)
 * and caches the resulting dataUrl in memory for instant reuse.
 */
export async function fetchPhotoDataUrl(entry) {
  if (!entry) throw new Error('Lien photo vide.');

  if (entry.startsWith('data:')) {
    return { dataUrl: entry, name: 'Photo' };
  }

  if (photoCache.has(entry)) {
    return photoCache.get(entry);
  }

  const fileId = extractDriveFileId(entry);
  if (!fileId) {
    throw new Error('Lien photo non reconnu.');
  }

  if (photoCache.has(fileId)) {
    return photoCache.get(fileId);
  }

  const cfg = getConfig();
  if (!cfg.apiUrl || !cfg.apiToken) {
    throw new Error('Configuration API manquante.');
  }

  const url = new URL(cfg.apiUrl);
  url.searchParams.set('token', cfg.apiToken);
  url.searchParams.set('action', 'photo');
  url.searchParams.set('fileId', fileId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Erreur réseau (${response.status})`);
  }

  const data = await response.json();
  if (!data || data.ok !== true || !data.dataUrl) {
    throw new Error(data?.error || 'Impossible de charger la photo.');
  }

  const result = { dataUrl: data.dataUrl, name: data.name || 'Photo' };
  photoCache.set(fileId, result);
  return result;
}
