import './styles.css';
import { fetchGyms } from './api.js';
import { getConfig, isLiveConfigReady } from './config.js';
import { createGymMap } from './map.js';
import { initSettingsModal, initUnmappedModal, showToast } from './modals.js';
import { getGymStatus, hasValidCoords, matchesFilter, STATUS, STATUS_META } from './status.js';

const state = {
  gyms: [],
  filter: 'all',
  search: '',
  selectedRowIndex: null,
  loading: false
};

// DOM references
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const locateBtn = document.getElementById('locate-btn');
const unmappedBtn = document.getElementById('unmapped-btn');
const unmappedCountEl = document.getElementById('unmapped-count');
const summaryCounterEl = document.getElementById('summary-counter');
const mockBadgeEl = document.getElementById('mock-badge');
const filterChips = Array.from(document.querySelectorAll('.chip[data-filter]'));

const sheetEl = document.getElementById('gym-sheet');
const sheetBackdrop = document.getElementById('sheet-backdrop');

const gymMap = createGymMap('map', {
  onSelectGym: (gym) => openGymPreview(gym),
  onMapClick: () => closeGymPreview()
});

const settingsModal = initSettingsModal({
  onSaved: () => {
    updateModeBadge();
    loadGyms({ fitBounds: true });
  }
});

const unmappedModal = initUnmappedModal({
  onSelectGym: (gym) => openGymPreview(gym)
});

/* ---------- Rendering ---------- */

function updateModeBadge() {
  const cfg = getConfig();
  mockBadgeEl.classList.toggle('hidden', !cfg.useMock);
}

function renderAll({ fitBounds = false } = {}) {
  const filtered = state.gyms.filter((g) => matchesFilter(g, state.filter, state.search));
  const unmapped = filtered.filter((g) => !hasValidCoords(g));

  gymMap.renderGyms(filtered, { fitBounds });

  // Summary counter reflects total gyms (or filtered if searching)
  const totalCount = state.gyms.length;
  const deliveredCount = state.gyms.filter((g) => getGymStatus(g) === STATUS.DELIVERED).length;
  summaryCounterEl.textContent = `${deliveredCount}/${totalCount} livrées`;

  // Unmapped gyms badge
  const totalUnmapped = state.gyms.filter((g) => !hasValidCoords(g));
  unmappedCountEl.textContent = String(totalUnmapped.length);
  unmappedBtn.classList.toggle('hidden', totalUnmapped.length === 0);
  unmappedModal.render(unmapped.length > 0 ? unmapped : totalUnmapped);
}

/* ---------- Step 2 Preview Sheet (upgraded to full quick-edit sheet in Step 3) ---------- */

function openGymPreview(gym) {
  state.selectedRowIndex = gym.rowIndex;
  gymMap.setSelected(gym.rowIndex, { pan: hasValidCoords(gym) });

  const status = getGymStatus(gym);
  const meta = STATUS_META[status];
  const navQuery = hasValidCoords(gym)
    ? `${gym.Lat},${gym.Lng}`
    : encodeURIComponent(gym['Adresse'] || gym['NOM'] || '');
  const navUrl = `https://www.google.com/maps/search/?api=1&query=${navQuery}`;

  sheetEl.innerHTML = '';

  const handle = document.createElement('div');
  handle.className = 'sheet-handle';

  const header = document.createElement('div');
  header.className = 'sheet-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'sheet-title';
  title.textContent = gym['NOM'] || `Salle #${gym.rowIndex}`;

  const badge = document.createElement('span');
  badge.className = 'status-badge';
  badge.style.backgroundColor = meta.badgeBg;
  badge.style.color = meta.badgeText;
  badge.style.marginTop = '6px';
  badge.textContent = meta.label;

  titleWrap.appendChild(title);
  titleWrap.appendChild(badge);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn-sm';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeGymPreview);

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  const addr = document.createElement('p');
  addr.className = 'sheet-address';
  addr.textContent = gym['Adresse'] || gym['Localisation'] || 'Adresse non renseignée';

  const grid = document.createElement('div');
  grid.className = 'sheet-meta-grid';

  const fields = [
    ['Déposées par', gym['Déposées en salle par'] || '—'],
    ['Affiches', gym["Nombre d'affiches"] !== '' && gym["Nombre d'affiches"] !== undefined ? `${gym["Nombre d'affiches"]} (${gym['Format'] || '—'})` : '—'],
    ['Accord', gym['Accord'] || '—'],
    ['Places offertes', gym['Nombre de places offertes'] !== '' && gym['Nombre de places offertes'] !== undefined ? gym['Nombre de places offertes'] : '—']
  ];

  for (const [label, value] of fields) {
    const card = document.createElement('div');
    card.className = 'sheet-meta-card';
    const small = document.createElement('small');
    small.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    card.appendChild(small);
    card.appendChild(strong);
    grid.appendChild(card);
  }

  const navLink = document.createElement('a');
  navLink.className = 'btn btn-primary';
  navLink.style.width = '100%';
  navLink.href = navUrl;
  navLink.target = '_blank';
  navLink.rel = 'noopener noreferrer';
  navLink.textContent = 'Ouvrir dans Google Maps';

  sheetEl.appendChild(handle);
  sheetEl.appendChild(header);
  sheetEl.appendChild(addr);
  sheetEl.appendChild(grid);
  sheetEl.appendChild(navLink);

  sheetBackdrop.classList.remove('hidden');
  sheetEl.classList.remove('hidden');
  requestAnimationFrame(() => sheetEl.classList.add('open'));
}

function closeGymPreview() {
  state.selectedRowIndex = null;
  gymMap.setSelected(null, { pan: false });
  sheetEl.classList.remove('open');
  sheetBackdrop.classList.add('hidden');
  setTimeout(() => {
    if (!sheetEl.classList.contains('open')) {
      sheetEl.classList.add('hidden');
    }
  }, 240);
}

/* ---------- Data Loading ---------- */

async function loadGyms({ fitBounds = false } = {}) {
  if (state.loading) return;

  if (!isLiveConfigReady()) {
    settingsModal.open();
    showToast('Configurez l’URL Apps Script et le Token (ou activez le mode Mock).', 'info', 4000);
    return;
  }

  state.loading = true;
  refreshBtn.classList.add('is-loading');

  try {
    const { gyms, meta } = await fetchGyms();
    state.gyms = gyms;
    renderAll({ fitBounds });

    if (meta.remainingToGeocode > 0) {
      showToast(
        `${meta.geocodedThisRequest} salles géolocalisées. Actualisez pour les ${meta.remainingToGeocode} restantes.`,
        'info',
        4500
      );
    } else if (meta.geocodedThisRequest > 0) {
      showToast(`${meta.geocodedThisRequest} nouvelles salles géolocalisées !`, 'success');
    }
  } catch (err) {
    showToast(err.message || 'Erreur lors du chargement.', 'error', 4500);
    if (err.code === 'CONFIG_MISSING' || err.status === 401) {
      settingsModal.open();
    }
  } finally {
    state.loading = false;
    refreshBtn.classList.remove('is-loading');
  }
}

/* ---------- Event Listeners ---------- */

searchInput.addEventListener('input', () => {
  state.search = searchInput.value;
  clearSearchBtn.classList.toggle('hidden', state.search.length === 0);
  renderAll();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  state.search = '';
  clearSearchBtn.classList.add('hidden');
  renderAll();
  searchInput.focus();
});

for (const chip of filterChips) {
  chip.addEventListener('click', () => {
    for (const c of filterChips) c.classList.remove('active');
    chip.classList.add('active');
    state.filter = chip.dataset.filter;
    renderAll();
  });
}

refreshBtn.addEventListener('click', () => loadGyms({ fitBounds: false }));
settingsBtn.addEventListener('click', () => settingsModal.open());
unmappedBtn.addEventListener('click', () => unmappedModal.open());
sheetBackdrop.addEventListener('click', closeGymPreview);

locateBtn.addEventListener('click', async () => {
  locateBtn.classList.add('is-loading');
  try {
    await gymMap.locateUser();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    locateBtn.classList.remove('is-loading');
  }
});

/* ---------- Bootstrap ---------- */

updateModeBadge();
loadGyms({ fitBounds: true });
