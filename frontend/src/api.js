import { getConfig } from './config.js';
import { INITIAL_MOCK_GYMS } from './mockData.js';

let mockStore = INITIAL_MOCK_GYMS.map((g) => ({ ...g }));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Used in Step 3 by the mobile bottom sheet.
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
