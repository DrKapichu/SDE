/**
 * Climbing Gym Poster Delivery Map — Google Apps Script Backend
 *
 * Bound to the Google Sheet containing climbing gym delivery tracking data.
 * Exposes:
 *   - doGet(e):  Returns all gyms as JSON, auto-geocoding missing Lat/Lng rows
 *                and caching coordinates back into the sheet.
 *   - doPost(e): Updates specific fields for a given rowIndex (with a NOM
 *                safety check to prevent overwriting shifted rows).
 *
 * Required Script Property:
 *   - API_TOKEN : Shared secret validated on every GET and POST request.
 *
 * Optional Script Property:
 *   - SHEET_NAME : Exact tab name to read/write (defaults to the first sheet).
 */

var CONFIG = {
  LAT_HEADER: 'Lat',
  LNG_HEADER: 'Lng',
  NOM_HEADER: 'NOM',
  ADDRESS_HEADER: 'Adresse',
  LOCALISATION_HEADER: 'Localisation',
  // Keep geocoding well within Apps Script's execution time & rate limits
  MAX_GEOCODE_PER_REQUEST: 25,
  MAX_GEOCODE_MS: 20000,
  GEOCODE_DELAY_MS: 150,
  // Editable fields accepted in doPost updates
  EDITABLE_HEADERS: [
    'Contacté le',
    'NOM',
    'Localisation',
    'Contact',
    'Déposées en salle par',
    'Accord',
    'Mail',
    'Adresse',
    "Nombre d'affiches",
    'Format',
    'Nombre de places offertes',
    'Lat',
    'Lng'
  ]
};

/**
 * HTTP GET handler: returns all gyms and geocodes any missing coordinates.
 * Query params:
 *   - token (required): must match Script Property API_TOKEN
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    if (!isValidToken_(params.token)) {
      return jsonResponse_({ ok: false, status: 401, error: 'Unauthorized: invalid or missing token.' });
    }

    var sheet = getTargetSheet_();
    var headerInfo = ensureGeoColumns_(sheet);
    var headers = headerInfo.headers;
    var colMap = headerInfo.colMap;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonResponse_({
        ok: true,
        gyms: [],
        meta: {
          total: 0,
          geocodedThisRequest: 0,
          remainingToGeocode: 0,
          updatedAt: new Date().toISOString()
        }
      });
    }

    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var numCols = headers.length;
    var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    var latColIdx = colMap[CONFIG.LAT_HEADER]; // 0-based
    var lngColIdx = colMap[CONFIG.LNG_HEADER]; // 0-based

    var gyms = [];
    var geocodedCount = 0;
    var remainingToGeocode = 0;
    var startMs = Date.now();

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var rowIndex = i + 2; // 1-based sheet row

      var record = rowToRecord_(headers, row, rowIndex, tz);

      // Skip completely blank rows (no NOM and no Adresse)
      if (!record[CONFIG.NOM_HEADER] && !record[CONFIG.ADDRESS_HEADER]) {
        continue;
      }

      var hasLat = isFiniteNumber_(record[CONFIG.LAT_HEADER]);
      var hasLng = isFiniteNumber_(record[CONFIG.LNG_HEADER]);

      if (!hasLat || !hasLng) {
        var address = String(record[CONFIG.ADDRESS_HEADER] || '').trim();
        var localisation = String(record[CONFIG.LOCALISATION_HEADER] || '').trim();
        var nom = String(record[CONFIG.NOM_HEADER] || '').trim();

        if (address || localisation) {
          var withinBudget =
            geocodedCount < CONFIG.MAX_GEOCODE_PER_REQUEST &&
            (Date.now() - startMs) < CONFIG.MAX_GEOCODE_MS;

          if (withinBudget) {
            var coords = geocodeGym_(address, localisation, nom);
            if (coords) {
              // Persist immediately so progress is cached even if later rows time out
              sheet.getRange(rowIndex, latColIdx + 1).setValue(coords.lat);
              sheet.getRange(rowIndex, lngColIdx + 1).setValue(coords.lng);
              record[CONFIG.LAT_HEADER] = coords.lat;
              record[CONFIG.LNG_HEADER] = coords.lng;
              geocodedCount++;
            }
            Utilities.sleep(CONFIG.GEOCODE_DELAY_MS);
          } else {
            remainingToGeocode++;
          }
        }
      }

      gyms.push(record);
    }

    return jsonResponse_({
      ok: true,
      gyms: gyms,
      meta: {
        total: gyms.length,
        geocodedThisRequest: geocodedCount,
        remainingToGeocode: remainingToGeocode,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      status: 500,
      error: 'Server error: ' + (err && err.message ? err.message : String(err))
    });
  }
}

/**
 * HTTP POST handler: updates fields for a single gym row.
 * Expects JSON body sent as Content-Type: text/plain;charset=utf-8 (to avoid CORS preflight):
 * {
 *   "token": "...",
 *   "rowIndex": 5,
 *   "expectedNom": "Arkose Nation",
 *   "updates": {
 *     "Déposées en salle par": "Alex",
 *     "Nombre d'affiches": 5,
 *     ...
 *   }
 * }
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, status: 400, error: 'Missing request body.' });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse_({ ok: false, status: 400, error: 'Invalid JSON payload.' });
    }

    if (!isValidToken_(payload.token)) {
      return jsonResponse_({ ok: false, status: 401, error: 'Unauthorized: invalid or missing token.' });
    }

    var rowIndex = parseInt(payload.rowIndex, 10);
    if (isNaN(rowIndex) || rowIndex < 2) {
      return jsonResponse_({ ok: false, status: 400, error: 'Invalid rowIndex.' });
    }

    var updates = payload.updates;
    if (!updates || typeof updates !== 'object') {
      return jsonResponse_({ ok: false, status: 400, error: 'Missing updates object.' });
    }

    if (!lock.tryLock(10000)) {
      return jsonResponse_({ ok: false, status: 503, error: 'Sheet is busy, please retry.' });
    }

    var sheet = getTargetSheet_();
    var headerInfo = ensureGeoColumns_(sheet);
    var headers = headerInfo.headers;
    var colMap = headerInfo.colMap;

    if (rowIndex > sheet.getLastRow()) {
      return jsonResponse_({ ok: false, status: 404, error: 'Row ' + rowIndex + ' does not exist.' });
    }

    var numCols = headers.length;
    var currentRow = sheet.getRange(rowIndex, 1, 1, numCols).getValues()[0];

    // Safety check: verify NOM matches so we never overwrite a shifted row
    var nomColIdx = colMap[CONFIG.NOM_HEADER];
    if (nomColIdx !== undefined) {
      var expectedNom = payload.expectedNom !== undefined ? payload.expectedNom : payload.NOM;
      if (expectedNom === undefined || expectedNom === null) {
        return jsonResponse_({
          ok: false,
          status: 400,
          error: 'Missing expectedNom safety check field.'
        });
      }
      var actualNom = String(currentRow[nomColIdx] || '').trim();
      if (actualNom !== String(expectedNom).trim()) {
        return jsonResponse_({
          ok: false,
          status: 409,
          error: 'Row mismatch: expected "' + expectedNom + '" at row ' + rowIndex + ', found "' + actualNom + '". Please refresh.'
        });
      }
    }

    var addressChanged = false;
    var updatedFields = [];

    for (var key in updates) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
      if (CONFIG.EDITABLE_HEADERS.indexOf(key) === -1) continue;
      if (colMap[key] === undefined) continue;

      var colIdx = colMap[key];
      var newVal = updates[key];

      if (key === CONFIG.ADDRESS_HEADER && String(newVal || '').trim() !== String(currentRow[colIdx] || '').trim()) {
        addressChanged = true;
      }

      currentRow[colIdx] = newVal;
      updatedFields.push(key);
    }

    // If address changed and caller didn't explicitly supply new Lat/Lng, re-geocode
    if (addressChanged && updates[CONFIG.LAT_HEADER] === undefined && updates[CONFIG.LNG_HEADER] === undefined) {
      var newAddress = String(currentRow[colMap[CONFIG.ADDRESS_HEADER]] || '').trim();
      var loc = colMap[CONFIG.LOCALISATION_HEADER] !== undefined
        ? String(currentRow[colMap[CONFIG.LOCALISATION_HEADER]] || '').trim()
        : '';
      var nomVal = nomColIdx !== undefined ? String(currentRow[nomColIdx] || '').trim() : '';

      var newCoords = geocodeGym_(newAddress, loc, nomVal);
      currentRow[colMap[CONFIG.LAT_HEADER]] = newCoords ? newCoords.lat : '';
      currentRow[colMap[CONFIG.LNG_HEADER]] = newCoords ? newCoords.lng : '';
    }

    sheet.getRange(rowIndex, 1, 1, numCols).setValues([currentRow]);
    SpreadsheetApp.flush();

    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var updatedRecord = rowToRecord_(headers, currentRow, rowIndex, tz);

    return jsonResponse_({
      ok: true,
      gym: updatedRecord,
      updatedFields: updatedFields
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      status: 500,
      error: 'Server error: ' + (err && err.message ? err.message : String(err))
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * Utility: run manually once from the Apps Script editor to verify permissions,
 * ensure Lat/Lng columns exist, and check whether API_TOKEN is configured.
 */
function initializeSheet() {
  var sheet = getTargetSheet_();
  var headerInfo = ensureGeoColumns_(sheet);
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  Logger.log('Sheet: ' + sheet.getName());
  Logger.log('Headers (' + headerInfo.headers.length + '): ' + headerInfo.headers.join(', '));
  Logger.log('API_TOKEN configured: ' + Boolean(token));
}

/* ============================================================================
 * Internal Helpers
 * ========================================================================== */

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = PropertiesService.getScriptProperties().getProperty('SHEET_NAME');
  if (sheetName) {
    var named = ss.getSheetByName(sheetName);
    if (!named) {
      throw new Error('Sheet "' + sheetName + '" not found.');
    }
    return named;
  }
  return ss.getSheets()[0];
}

function isValidToken_(providedToken) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !expected.trim()) {
    throw new Error('API_TOKEN is not configured in Script Properties.');
  }
  return typeof providedToken === 'string' && providedToken.trim().length > 0 && providedToken.trim() === expected.trim();
}

/**
 * Reads row 1 headers and appends Lat / Lng columns if missing.
 */
function ensureGeoColumns_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = rawHeaders.map(function (h) {
    return String(h || '').trim();
  });

  // Trim trailing empty header cells
  while (headers.length > 0 && headers[headers.length - 1] === '') {
    headers.pop();
  }

  var toAppend = [];
  if (headers.indexOf(CONFIG.LAT_HEADER) === -1) {
    toAppend.push(CONFIG.LAT_HEADER);
  }
  if (headers.indexOf(CONFIG.LNG_HEADER) === -1) {
    toAppend.push(CONFIG.LNG_HEADER);
  }

  if (toAppend.length > 0) {
    var startCol = headers.length + 1;
    sheet.getRange(1, startCol, 1, toAppend.length).setValues([toAppend]);
    headers = headers.concat(toAppend);
  }

  var colMap = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) {
      colMap[headers[i]] = i;
    }
  }

  return { headers: headers, colMap: colMap };
}

/**
 * Converts a raw sheet row array into a JSON-friendly object keyed by header name.
 */
function rowToRecord_(headers, row, rowIndex, tz) {
  var obj = { rowIndex: rowIndex };
  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    if (!header) continue;
    var val = row[c];

    if (val instanceof Date) {
      obj[header] = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    } else if (header === CONFIG.LAT_HEADER || header === CONFIG.LNG_HEADER) {
      var parsed = parseFloat(val);
      obj[header] = (val === '' || val === null || isNaN(parsed)) ? null : parsed;
    } else if (val === null || val === undefined) {
      obj[header] = '';
    } else {
      obj[header] = val;
    }
  }
  return obj;
}

function isFiniteNumber_(val) {
  return typeof val === 'number' && isFinite(val);
}

/**
 * Geocodes a gym using Google Maps Geocoder first, then falls back to
 * France's official BAN API (api-adresse.data.gouv.fr).
 */
function geocodeGym_(address, localisation, nom) {
  var queries = [];
  if (address) {
    queries.push(ensureCountry_(address));
  }
  if (localisation && localisation !== address) {
    if (nom) {
      queries.push(ensureCountry_(nom + ', ' + localisation));
    }
    queries.push(ensureCountry_(localisation));
  }

  // 1. Primary: Google Maps Geocoder
  for (var i = 0; i < queries.length; i++) {
    var coords = geocodeWithGoogleMaps_(queries[i]);
    if (coords) return coords;
  }

  // 2. Fallback: French Government BAN API (api-adresse.data.gouv.fr)
  var banQueries = [];
  if (address) banQueries.push(address);
  if (localisation && localisation !== address) banQueries.push(localisation);

  for (var j = 0; j < banQueries.length; j++) {
    var banCoords = geocodeWithDataGouv_(banQueries[j]);
    if (banCoords) return banCoords;
  }

  return null;
}

function ensureCountry_(query) {
  if (/france/i.test(query)) return query;
  return query + ', France';
}

function geocodeWithGoogleMaps_(query) {
  try {
    var response = Maps.newGeocoder().setRegion('fr').geocode(query);
    if (response && response.status === 'OK' && response.results && response.results.length > 0) {
      var loc = response.results[0].geometry.location;
      if (isFiniteNumber_(loc.lat) && isFiniteNumber_(loc.lng)) {
        return { lat: roundCoord_(loc.lat), lng: roundCoord_(loc.lng) };
      }
    }
  } catch (e) {
    // Fall through to secondary geocoder
  }
  return null;
}

function geocodeWithDataGouv_(query) {
  try {
    var url = 'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(query) + '&limit=1';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    var data = JSON.parse(res.getContentText());
    if (data && data.features && data.features.length > 0) {
      var coords = data.features[0].geometry.coordinates; // [lng, lat]
      if (coords && coords.length === 2 && isFiniteNumber_(coords[1]) && isFiniteNumber_(coords[0])) {
        return { lat: roundCoord_(coords[1]), lng: roundCoord_(coords[0]) };
      }
    }
  } catch (e) {
    // Ignore and return null
  }
  return null;
}

function roundCoord_(num) {
  return Math.round(num * 1000000) / 1000000;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
