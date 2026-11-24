import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getGymStatus, hasValidCoords, STATUS_META } from './status.js';

function createPinIcon(status, isSelected = false) {
  const meta = STATUS_META[status] || STATUS_META.to_deliver;
  const size = isSelected ? 36 : 28;
  const height = isSelected ? 44 : 36;

  return L.divIcon({
    className: `gym-pin-wrapper${isSelected ? ' is-selected' : ''}`,
    iconSize: [size, height],
    iconAnchor: [size / 2, height - 2],
    html: `
      <svg width="${size}" height="${height}" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M14 1.5C7.1 1.5 1.5 7.1 1.5 14C1.5 23.1 14 34.5 14 34.5C14 34.5 26.5 23.1 26.5 14C26.5 7.1 20.9 1.5 14 1.5Z"
              fill="${meta.color}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="14" cy="13.5" r="4.5" fill="#ffffff" fill-opacity="0.92"/>
      </svg>
    `
  });
}

export function createGymMap(containerId, { onSelectGym, onMapClick }) {
  const map = L.map(containerId, {
    center: [46.603354, 1.888334], // France center fallback
    zoom: 6,
    zoomControl: false,
    attributionControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // Move attribution slightly out of the way on mobile
  map.attributionControl.setPrefix(false);

  const markersLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markersByRow = new Map();
  let selectedRowIndex = null;
  let hasFittedOnce = false;
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let lastUserCoords = null;

  map.on('click', () => {
    if (onMapClick) onMapClick();
  });

  function renderGyms(gyms, { fitBounds = false } = {}) {
    markersLayer.clearLayers();
    markersByRow.clear();

    const bounds = [];

    for (const gym of gyms) {
      if (!hasValidCoords(gym)) continue;

      const lat = Number(gym.Lat);
      const lng = Number(gym.Lng);
      const status = getGymStatus(gym);
      const isSelected = gym.rowIndex === selectedRowIndex;

      const marker = L.marker([lat, lng], {
        icon: createPinIcon(status, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
        title: gym['NOM'] || ''
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (onSelectGym) onSelectGym(gym);
      });

      marker.addTo(markersLayer);
      markersByRow.set(gym.rowIndex, { marker, gym });
      bounds.push([lat, lng]);
    }

    if ((fitBounds || !hasFittedOnce) && bounds.length > 0) {
      hasFittedOnce = true;
      if (bounds.length === 1) {
        map.setView(bounds[0], 14, { animate: true });
      } else {
        map.fitBounds(bounds, {
          paddingTopLeft: [24, 120],
          paddingBottomRight: [24, 48],
          maxZoom: 14
        });
      }
    }
  }

  function setSelected(rowIndex, { pan = true } = {}) {
    const prevRow = selectedRowIndex;
    selectedRowIndex = rowIndex;

    if (prevRow !== null && markersByRow.has(prevRow)) {
      const prev = markersByRow.get(prevRow);
      prev.marker.setIcon(createPinIcon(getGymStatus(prev.gym), false));
      prev.marker.setZIndexOffset(0);
    }

    if (rowIndex !== null && markersByRow.has(rowIndex)) {
      const curr = markersByRow.get(rowIndex);
      curr.marker.setIcon(createPinIcon(getGymStatus(curr.gym), true));
      curr.marker.setZIndexOffset(1000);

      if (pan) {
        const latLng = curr.marker.getLatLng();
        const targetZoom = Math.max(map.getZoom(), 13);
        map.setView(latLng, targetZoom, { animate: true });
      }
    }
  }

  function drawRoute(latLngs) {
    routeLayer.clearLayers();
    if (!latLngs || latLngs.length === 0) return;

    // White casing + blue route line for crisp legibility over OSM roads
    L.polyline(latLngs, {
      color: '#ffffff',
      weight: 9,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    const routeLine = L.polyline(latLngs, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    map.fitBounds(routeLine.getBounds(), {
      paddingTopLeft: [32, 130],
      paddingBottomRight: [32, 160],
      maxZoom: 16
    });
  }

  function clearRoute() {
    routeLayer.clearLayers();
  }

  function locateUser({ fly = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Géolocalisation non supportée par ce navigateur.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const latLng = [latitude, longitude];
          lastUserCoords = { lat: latitude, lng: longitude };

          if (userAccuracyCircle) {
            userAccuracyCircle.setLatLng(latLng).setRadius(Math.min(accuracy, 500));
          } else {
            userAccuracyCircle = L.circle(latLng, {
              radius: Math.min(accuracy, 500),
              color: '#2563eb',
              fillColor: '#3b82f6',
              fillOpacity: 0.14,
              weight: 1
            }).addTo(map);
          }

          if (userLocationMarker) {
            userLocationMarker.setLatLng(latLng);
          } else {
            userLocationMarker = L.marker(latLng, {
              interactive: false,
              zIndexOffset: 900,
              icon: L.divIcon({
                className: 'user-location-pin',
                iconSize: [20, 20],
                iconAnchor: [10, 10],
                html: '<span class="user-dot"></span>'
              })
            }).addTo(map);
          }

          if (fly) {
            map.flyTo(latLng, Math.max(map.getZoom(), 13), { duration: 0.7 });
          }
          resolve({ lat: latitude, lng: longitude, accuracy });
        },
        (err) => {
          const msg =
            err.code === 1
              ? 'Permission GPS refusée.'
              : err.code === 3
                ? 'Délai GPS dépassé.'
                : 'Position GPS indisponible.';
          reject(new Error(msg));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000
        }
      );
    });
  }

  function getLastUserCoords() {
    return lastUserCoords;
  }

  return {
    map,
    renderGyms,
    setSelected,
    drawRoute,
    clearRoute,
    locateUser,
    getLastUserCoords
  };
}
