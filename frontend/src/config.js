const STORAGE_KEY = 'sde_poster_map_config_v1';

const envDefaults = {
  apiUrl: (import.meta.env.VITE_API_URL || '').trim(),
  apiToken: (import.meta.env.VITE_API_TOKEN || '').trim(),
  useMock: String(import.meta.env.VITE_USE_MOCK || '').toLowerCase() === 'true',
  userName: ''
};

export function getConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...envDefaults };
    const saved = JSON.parse(raw);
    return {
      apiUrl: (saved.apiUrl ?? envDefaults.apiUrl).trim(),
      apiToken: (saved.apiToken ?? envDefaults.apiToken).trim(),
      useMock: typeof saved.useMock === 'boolean' ? saved.useMock : envDefaults.useMock,
      userName: (saved.userName ?? envDefaults.userName).trim()
    };
  } catch {
    return { ...envDefaults };
  }
}

export function saveConfig(partial) {
  const next = { ...getConfig(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function resetConfig() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...envDefaults };
}

export function isLiveConfigReady(cfg = getConfig()) {
  return cfg.useMock || (Boolean(cfg.apiUrl) && Boolean(cfg.apiToken));
}
