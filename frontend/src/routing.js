const PROFILE_ENDPOINTS = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving'
};

const FALLBACK_CAR_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

async function queryOsrm(baseUrl, from, to) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${baseUrl}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Erreur routing (${res.status})`);
  }

  const data = await res.json();
  if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('Aucun itinéraire trouvé.');
  }

  const route = data.routes[0];
  // Convert GeoJSON [lng, lat] -> Leaflet [lat, lng]
  const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

  return {
    coordinates: latLngs,
    distanceMeters: route.distance,
    durationSeconds: route.duration
  };
}

/**
 * Fetches an in-app route between two { lat, lng } points for mode: 'car' | 'bike' | 'foot'.
 */
export async function fetchRoute(from, to, mode = 'car') {
  const primary = PROFILE_ENDPOINTS[mode] || PROFILE_ENDPOINTS.car;
  try {
    return await queryOsrm(primary, from, to);
  } catch (err) {
    if (mode === 'car') {
      return await queryOsrm(FALLBACK_CAR_ENDPOINT, from, to);
    }
    throw err;
  }
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1).replace('.', ',')} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) {
    return `${totalMin} min`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
