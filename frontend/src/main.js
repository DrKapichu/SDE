import './styles.css';
import { fetchGyms } from './api.js';
import { getConfig, isLiveConfigReady } from './config.js';
import { createGymMap } from './map.js';
import { initSettingsModal, initUnmappedModal, showToast } from './modals.js';
import { fetchRoute, formatDistance, formatDuration } from './routing.js';
import { initGymSheet } from './sheet.js';
import { getGymStatus, hasValidCoords, matchesFilter, STATUS } from './status.js';

const state = {
  gyms: [],
  filter: 'all',
  search: '',
  selectedRowIndex: null,
  loading: false,
  activeRoute: null // { gym, mode }
};

// DOM references
const appEl = document.getElementById('app');
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

// Route banner DOM references
const routeBannerEl = document.getElementById('route-banner');
const routeDestNameEl = document.getElementById('route-dest-name');
const routeMetaEl = document.getElementById('route-meta');
const routeCloseBtn = document.getElementById('route-close-btn');
const routeGmapsLink = document.getElementById('route-gmaps-link');
const routeModeBtns = Array.from(document.querySelectorAll('.route-mode-btn[data-mode]'));

const gymMap = createGymMap('map', {
  onSelectGym: (gym) => selectGym(gym),
  onMapClick: () => gymSheet.close()
});

const gymSheet = initGymSheet({
  onClose: () => {
    state.selectedRowIndex = null;
    gymMap.setSelected(null, { pan: false });
  },
  onSaved: (updatedGym) => {
    const idx = state.gyms.findIndex((g) => g.rowIndex === updatedGym.rowIndex);
    if (idx !== -1) {
      state.gyms[idx] = updatedGym;
    } else {
      state.gyms.push(updatedGym);
    }
    renderAll({ fitBounds: false });
  },
  onRoute: (gym) => {
    const mode = state.activeRoute?.mode || 'car';
    showRouteToGym(gym, mode);
  }
});

const settingsModal = initSettingsModal({
  onSaved: () => {
    updateModeBadge();
    loadGyms({ fitBounds: true });
  }
});

const unmappedModal = initUnmappedModal({
  onSelectGym: (gym) => selectGym(gym)
});

/* ---------- Selection & Rendering ---------- */

function selectGym(gym) {
  state.selectedRowIndex = gym.rowIndex;
  gymMap.setSelected(gym.rowIndex, { pan: hasValidCoords(gym) });
  gymSheet.open(gym);
}

function updateModeBadge() {
  const cfg = getConfig();
  mockBadgeEl.classList.toggle('hidden', !cfg.useMock);
}

function renderAll({ fitBounds = false } = {}) {
  const filtered = state.gyms.filter((g) => matchesFilter(g, state.filter, state.search));
  const unmapped = filtered.filter((g) => !hasValidCoords(g));

  gymMap.renderGyms(filtered, { fitBounds });

  const totalCount = state.gyms.length;
  const deliveredCount = state.gyms.filter((g) => getGymStatus(g) === STATUS.DELIVERED).length;
  summaryCounterEl.textContent = `${deliveredCount}/${totalCount} livrées`;

  const totalUnmapped = state.gyms.filter((g) => !hasValidCoords(g));
  unmappedCountEl.textContent = String(totalUnmapped.length);
  unmappedBtn.classList.toggle('hidden', totalUnmapped.length === 0);
  unmappedModal.render(unmapped.length > 0 ? unmapped : totalUnmapped);
}

/* ---------- In-App Routing ---------- */

async function showRouteToGym(gym, mode = 'car') {
  if (!hasValidCoords(gym)) {
    showToast('Coordonnées GPS manquantes pour cette salle.', 'error');
    return;
  }

  state.activeRoute = { gym, mode };
  routeDestNameEl.textContent = gym['NOM'] || `Salle #${gym.rowIndex}`;
  routeMetaEl.textContent = 'Localisation & calcul de l’itinéraire…';
  routeGmapsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${gym.Lat},${gym.Lng}&travelmode=${mode === 'bike' ? 'bicycling' : mode === 'foot' ? 'walking' : 'driving'}`;

  for (const btn of routeModeBtns) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }

  routeBannerEl.classList.remove('hidden');
  appEl.classList.add('has-route-banner');

  try {
    const origin = await gymMap.locateUser({ fly: false });
    const dest = { lat: Number(gym.Lat), lng: Number(gym.Lng) };
    const route = await fetchRoute(origin, dest, mode);

    // Ensure user hasn't cancelled or switched route while awaiting
    if (!state.activeRoute || state.activeRoute.gym.rowIndex !== gym.rowIndex || state.activeRoute.mode !== mode) {
      return;
    }

    gymMap.drawRoute(route.coordinates);
    routeMetaEl.textContent = `${formatDuration(route.durationSeconds)} • ${formatDistance(route.distanceMeters)}`;
  } catch (err) {
    routeMetaEl.textContent = err.message || 'Impossible de calculer l’itinéraire.';
    showToast(err.message || 'Impossible de calculer l’itinéraire.', 'error', 4000);
  }
}

function clearActiveRoute() {
  state.activeRoute = null;
  gymMap.clearRoute();
  routeBannerEl.classList.add('hidden');
  appEl.classList.remove('has-route-banner');
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

for (const btn of routeModeBtns) {
  btn.addEventListener('click', () => {
    if (!state.activeRoute) return;
    showRouteToGym(state.activeRoute.gym, btn.dataset.mode);
  });
}

routeCloseBtn.addEventListener('click', clearActiveRoute);

refreshBtn.addEventListener('click', () => loadGyms({ fitBounds: false }));
settingsBtn.addEventListener('click', () => settingsModal.open());
unmappedBtn.addEventListener('click', () => unmappedModal.open());

locateBtn.addEventListener('click', async () => {
  locateBtn.classList.add('is-loading');
  try {
    await gymMap.locateUser({ fly: true });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    locateBtn.classList.remove('is-loading');
  }
});

/* ---------- Bootstrap ---------- */

updateModeBadge();
loadGyms({ fitBounds: true });
