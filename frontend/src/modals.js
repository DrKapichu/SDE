import { getConfig, resetConfig, saveConfig } from './config.js';
import { getGymStatus, STATUS_META } from './status.js';

/* ---------- Toast Notifications ---------- */

export function showToast(message, type = 'info', durationMs = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

/* ---------- Settings / API Config Modal ---------- */

export function initSettingsModal({ onSaved }) {
  const modal = document.getElementById('settings-modal');
  const form = document.getElementById('settings-form');
  const closeBtn = document.getElementById('close-settings-btn');
  const resetBtn = document.getElementById('reset-settings-btn');

  const urlInput = document.getElementById('cfg-api-url');
  const tokenInput = document.getElementById('cfg-api-token');
  const nameInput = document.getElementById('cfg-user-name');
  const mockCheckbox = document.getElementById('cfg-use-mock');

  function populate() {
    const cfg = getConfig();
    urlInput.value = cfg.apiUrl;
    tokenInput.value = cfg.apiToken;
    nameInput.value = cfg.userName;
    mockCheckbox.checked = cfg.useMock;
  }

  function open() {
    populate();
    modal.classList.remove('hidden');
  }

  function close() {
    modal.classList.add('hidden');
  }

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  resetBtn.addEventListener('click', () => {
    resetConfig();
    populate();
    showToast('Paramètres réinitialisés.', 'info');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = saveConfig({
      apiUrl: urlInput.value.trim(),
      apiToken: tokenInput.value.trim(),
      userName: nameInput.value.trim(),
      useMock: mockCheckbox.checked
    });
    close();
    if (onSaved) onSaved(next);
  });

  return { open, close };
}

/* ---------- Unmapped Gyms Modal ---------- */

export function initUnmappedModal({ onSelectGym }) {
  const modal = document.getElementById('unmapped-modal');
  const listEl = document.getElementById('unmapped-list');
  const closeBtn = document.getElementById('close-unmapped-btn');

  function open() {
    modal.classList.remove('hidden');
  }

  function close() {
    modal.classList.add('hidden');
  }

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  function render(unmappedGyms) {
    listEl.innerHTML = '';

    if (unmappedGyms.length === 0) {
      const li = document.createElement('li');
      li.className = 'unmapped-empty';
      li.textContent = 'Toutes les salles sont géolocalisées !';
      listEl.appendChild(li);
      return;
    }

    for (const gym of unmappedGyms) {
      const status = getGymStatus(gym);
      const meta = STATUS_META[status];

      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'unmapped-item';

      const info = document.createElement('div');
      info.className = 'unmapped-item-info';

      const nameEl = document.createElement('strong');
      nameEl.textContent = gym['NOM'] || `Ligne ${gym.rowIndex}`;

      const subEl = document.createElement('span');
      subEl.textContent = gym['Adresse'] || gym['Localisation'] || 'Aucune adresse renseignée';

      info.appendChild(nameEl);
      info.appendChild(subEl);

      const badge = document.createElement('span');
      badge.className = 'status-badge';
      badge.style.backgroundColor = meta.badgeBg;
      badge.style.color = meta.badgeText;
      badge.textContent = meta.label;

      btn.appendChild(info);
      btn.appendChild(badge);

      btn.addEventListener('click', () => {
        close();
        if (onSelectGym) onSelectGym(gym);
      });

      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  return { open, close, render };
}
