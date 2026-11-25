import { fetchPhotoDataUrl, parsePhotoLinks, updateGym, uploadGymPhoto } from './api.js';
import { getConfig, saveConfig } from './config.js';
import { showToast } from './modals.js';
import { compressImageFile } from './photo.js';
import { getGymStatus, hasValidCoords, STATUS_META } from './status.js';

const FORMAT_PRESETS = ['A3', 'A4', 'A3 + A4'];
const ACCORD_PRESETS = ['Oui', 'Non'];

/**
 * Extracts a callable phone number from free-text Contact field (supports French & intl formats).
 */
function extractPhone(contactText) {
  const str = String(contactText || '');
  const match = str.match(/(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4}/) || str.match(/\+?\d[\d\s.-]{7,}\d/);
  if (!match) return null;
  const display = match[0].trim();
  const href = display.replace(/[\s.-]+/g, '');
  return { display, href };
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNavUrl(gym) {
  const query = hasValidCoords(gym)
    ? `${gym.Lat},${gym.Lng}`
    : encodeURIComponent(gym['Adresse'] || `${gym['NOM'] || ''} ${gym['Localisation'] || ''}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function initGymSheet({ onClose, onSaved, onRoute }) {
  const sheetEl = document.getElementById('gym-sheet');
  const backdropEl = document.getElementById('sheet-backdrop');

  // Lightbox elements
  const lightboxEl = document.getElementById('photo-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxCloseBtn = document.getElementById('lightbox-close-btn');

  let currentGym = null;
  let isSaving = false;
  let isUploadingPhoto = false;
  let openRenderToken = 0;

  function openLightbox(dataUrl, caption) {
    lightboxImg.src = dataUrl;
    lightboxCaption.textContent = caption || 'Photo';
    lightboxEl.classList.remove('hidden');
  }

  function closeLightbox() {
    lightboxEl.classList.add('hidden');
    lightboxImg.removeAttribute('src');
  }

  lightboxCloseBtn.addEventListener('click', closeLightbox);
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl) closeLightbox();
  });

  function close() {
    if (isSaving || isUploadingPhoto) return;
    currentGym = null;
    openRenderToken++;
    sheetEl.classList.remove('open');
    backdropEl.classList.add('hidden');
    if (onClose) onClose();
    setTimeout(() => {
      if (!sheetEl.classList.contains('open')) {
        sheetEl.classList.add('hidden');
      }
    }, 240);
  }

  backdropEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!lightboxEl.classList.contains('hidden')) {
        closeLightbox();
      } else if (currentGym) {
        close();
      }
    }
  });

  function open(gym) {
    currentGym = { ...gym };
    openRenderToken++;
    render(currentGym, openRenderToken);
    backdropEl.classList.remove('hidden');
    sheetEl.classList.remove('hidden');
    sheetEl.scrollTop = 0;
    requestAnimationFrame(() => sheetEl.classList.add('open'));
  }

  function render(gym, renderToken) {
    const cfg = getConfig();
    const status = getGymStatus(gym);
    const meta = STATUS_META[status];
    const phone = extractPhone(gym['Contact']);
    const mail = String(gym['Mail'] || '').trim();
    const navUrl = buildNavUrl(gym);
    const quickName = cfg.userName || 'Moi';
    const canRoute = hasValidCoords(gym);

    const postersVal = gym["Nombre d'affiches"] === '' || gym["Nombre d'affiches"] === null || gym["Nombre d'affiches"] === undefined
      ? ''
      : String(gym["Nombre d'affiches"]);
    const placesVal = gym['Nombre de places offertes'] === '' || gym['Nombre de places offertes'] === null || gym['Nombre de places offertes'] === undefined
      ? ''
      : String(gym['Nombre de places offertes']);

    sheetEl.innerHTML = `
      <div class="sheet-handle"></div>

      <div class="sheet-header">
        <div class="sheet-title-col">
          <h2 class="sheet-title">${escapeHtml(gym['NOM'] || `Salle #${gym.rowIndex}`)}</h2>
          <div class="sheet-badges-row">
            <span id="sheet-status-badge" class="status-badge" style="background:${meta.badgeBg};color:${meta.badgeText}">
              ${escapeHtml(meta.label)}
            </span>
            ${!canRoute ? '<span class="status-badge badge-warn">Non géolocalisée</span>' : ''}
          </div>
        </div>
        <button id="sheet-close-btn" type="button" class="icon-btn-sm" aria-label="Fermer">&times;</button>
      </div>

      <p class="sheet-address">${escapeHtml(gym['Adresse'] || gym['Localisation'] || 'Adresse non renseignée')}</p>

      <div class="quick-actions-row">
        ${canRoute ? `
          <button id="sheet-route-btn" type="button" class="action-pill action-pill-primary">
            <svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="6" cy="19" r="3"/>
              <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>
              <circle cx="18" cy="5" r="3"/>
            </svg>
            Itinéraire
          </button>
        ` : ''}
        <a class="action-pill${canRoute ? '' : ' action-pill-primary'}" href="${navUrl}" target="_blank" rel="noopener noreferrer">
          <svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" stroke-linejoin="round"/>
          </svg>
          Google Maps
        </a>
        ${mail ? `
          <a class="action-pill" href="mailto:${escapeHtml(mail)}">
            <svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-10 6L2 7"/>
            </svg>
            Mail
          </a>
        ` : ''}
        ${phone ? `
          <a class="action-pill" href="tel:${escapeHtml(phone.href)}">
            <svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            Appeler
          </a>
        ` : ''}
      </div>

      <form id="gym-edit-form" class="sheet-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="edit-delivered-by">Déposées en salle par</label>
          <div class="input-with-action">
            <input
              id="edit-delivered-by"
              name="Déposées en salle par"
              type="text"
              value="${escapeHtml(gym['Déposées en salle par'] || '')}"
              placeholder="Nom du livreur…"
              autocomplete="name"
            />
            <button id="quick-fill-name-btn" type="button" class="quick-btn" title="Pré-remplir avec votre nom">
              ${escapeHtml(quickName)}
            </button>
          </div>
        </div>

        <div class="stepper-grid">
          <div class="form-group">
            <label class="form-label" for="edit-posters">Nombre d'affiches</label>
            <div class="stepper">
              <button type="button" class="stepper-btn" data-stepper-target="edit-posters" data-delta="-1" aria-label="Diminuer le nombre d'affiches">−</button>
              <input
                id="edit-posters"
                name="Nombre d'affiches"
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                value="${escapeHtml(postersVal)}"
                placeholder="0"
              />
              <button type="button" class="stepper-btn" data-stepper-target="edit-posters" data-delta="1" aria-label="Augmenter le nombre d'affiches">+</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="edit-places">Places offertes</label>
            <div class="stepper">
              <button type="button" class="stepper-btn" data-stepper-target="edit-places" data-delta="-1" aria-label="Diminuer le nombre de places">−</button>
              <input
                id="edit-places"
                name="Nombre de places offertes"
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                value="${escapeHtml(placesVal)}"
                placeholder="0"
              />
              <button type="button" class="stepper-btn" data-stepper-target="edit-places" data-delta="1" aria-label="Augmenter le nombre de places">+</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="edit-format">Format</label>
          <input
            id="edit-format"
            name="Format"
            type="text"
            value="${escapeHtml(gym['Format'] || '')}"
            placeholder="Ex: A3, A4…"
          />
          <div class="preset-chips" data-preset-target="edit-format">
            ${FORMAT_PRESETS.map((p) => `<button type="button" class="preset-chip${String(gym['Format'] || '').trim() === p ? ' active' : ''}" data-value="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="edit-accord">Accord</label>
          <input
            id="edit-accord"
            name="Accord"
            type="text"
            value="${escapeHtml(gym['Accord'] || '')}"
            placeholder="Oui, Non, commentaire…"
          />
          <div class="preset-chips" data-preset-target="edit-accord">
            ${ACCORD_PRESETS.map((p) => `<button type="button" class="preset-chip${String(gym['Accord'] || '').trim().toLowerCase() === p.toLowerCase() ? ' active' : ''}" data-value="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
          </div>
        </div>

        <!-- Proof of delivery photos (stored privately in Drive, viewed through Web App) -->
        <div class="photo-section">
          <div class="photo-section-header">
            <span class="form-label">Photos (preuve de dépôt)</span>
            <span id="photo-count-label" class="photo-count"></span>
          </div>

          <div class="photo-actions">
            <label class="photo-upload-btn" id="camera-upload-label">
              <input id="photo-camera-input" type="file" accept="image/*" capture="environment" class="sr-only" />
              <span>📷 Prendre une photo</span>
            </label>
            <label class="photo-upload-btn photo-upload-secondary" id="gallery-upload-label">
              <input id="photo-gallery-input" type="file" accept="image/*" class="sr-only" />
              <span>🖼️ Galerie</span>
            </label>
          </div>

          <div id="photo-grid" class="photo-grid"></div>
        </div>

        <details class="other-info-details">
          <summary>Autres infos (Contact, Mail, Adresse, Localisation)</summary>
          <div class="other-info-body">
            <div class="form-group">
              <label class="form-label" for="edit-contact">Contact</label>
              <input id="edit-contact" name="Contact" type="text" value="${escapeHtml(gym['Contact'] || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-mail">Mail</label>
              <input id="edit-mail" name="Mail" type="email" value="${escapeHtml(gym['Mail'] || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-adresse">Adresse</label>
              <input id="edit-adresse" name="Adresse" type="text" value="${escapeHtml(gym['Adresse'] || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-localisation">Localisation</label>
              <input id="edit-localisation" name="Localisation" type="text" value="${escapeHtml(gym['Localisation'] || '')}" />
            </div>
          </div>
        </details>

        <div class="sheet-footer">
          <button id="sheet-save-btn" type="submit" class="btn btn-primary btn-save">
            <span class="btn-spinner hidden" aria-hidden="true"></span>
            <span class="btn-label">Enregistrer</span>
          </button>
        </div>
      </form>
    `;

    bindFormInteractions(gym, renderToken);
    renderPhotoGallery(gym['Photo'], renderToken);
  }

  function renderPhotoGallery(photoCell, renderToken) {
    const grid = document.getElementById('photo-grid');
    const countLabel = document.getElementById('photo-count-label');
    if (!grid) return;

    const links = parsePhotoLinks(photoCell);
    countLabel.textContent = links.length > 0 ? `${links.length} photo${links.length > 1 ? 's' : ''}` : 'Aucune photo';
    grid.innerHTML = '';

    if (links.length === 0) return;

    links.forEach((entry, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'photo-thumb photo-thumb-loading';
      tile.setAttribute('aria-label', `Voir la photo ${index + 1}`);
      tile.innerHTML = '<span class="photo-thumb-status">…</span>';
      grid.appendChild(tile);

      fetchPhotoDataUrl(entry)
        .then(({ dataUrl, name }) => {
          if (renderToken !== openRenderToken) return;
          tile.classList.remove('photo-thumb-loading');
          tile.innerHTML = '';
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = name || `Photo ${index + 1}`;
          tile.appendChild(img);
          tile.addEventListener('click', () => openLightbox(dataUrl, name || `Photo ${index + 1}`));
        })
        .catch(() => {
          if (renderToken !== openRenderToken) return;
          tile.classList.remove('photo-thumb-loading');
          tile.classList.add('photo-thumb-error');
          tile.innerHTML = '<span class="photo-thumb-status">Erreur</span>';
        });
    });
  }

  function bindFormInteractions(gym, renderToken) {
    const closeBtn = document.getElementById('sheet-close-btn');
    const routeBtn = document.getElementById('sheet-route-btn');
    const form = document.getElementById('gym-edit-form');
    const deliveredByInput = document.getElementById('edit-delivered-by');
    const postersInput = document.getElementById('edit-posters');
    const quickFillBtn = document.getElementById('quick-fill-name-btn');
    const statusBadge = document.getElementById('sheet-status-badge');
    const saveBtn = document.getElementById('sheet-save-btn');
    const spinner = saveBtn.querySelector('.btn-spinner');
    const btnLabel = saveBtn.querySelector('.btn-label');

    const cameraInput = document.getElementById('photo-camera-input');
    const galleryInput = document.getElementById('photo-gallery-input');
    const cameraLabel = document.getElementById('camera-upload-label');
    const galleryLabel = document.getElementById('gallery-upload-label');

    closeBtn.addEventListener('click', close);

    if (routeBtn) {
      routeBtn.addEventListener('click', () => {
        const targetGym = { ...gym };
        close();
        if (onRoute) onRoute(targetGym);
      });
    }

    // Photo capture / gallery upload handler
    async function handleFileSelection(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      inputEl.value = '';
      if (!file || isUploadingPhoto) return;

      isUploadingPhoto = true;
      cameraLabel.classList.add('is-uploading');
      galleryLabel.classList.add('is-uploading');
      cameraLabel.querySelector('span').textContent = '⏳ Envoi…';

      try {
        const compressed = await compressImageFile(file);
        const { gym: updatedGym } = await uploadGymPhoto(gym.rowIndex, gym['NOM'], compressed);

        // Update local reference & parent state without closing the sheet or losing unsaved edits
        gym['Photo'] = updatedGym['Photo'];
        if (currentGym && currentGym.rowIndex === updatedGym.rowIndex) {
          currentGym['Photo'] = updatedGym['Photo'];
        }
        if (onSaved) onSaved(updatedGym);

        renderPhotoGallery(updatedGym['Photo'], renderToken);
        showToast('Photo ajoutée !', 'success');
      } catch (err) {
        const msg = !navigator.onLine
          ? 'Hors ligne : impossible d’envoyer la photo.'
          : err.message || 'Échec de l’envoi de la photo.';
        showToast(msg, 'error', 4500);
      } finally {
        isUploadingPhoto = false;
        cameraLabel.classList.remove('is-uploading');
        galleryLabel.classList.remove('is-uploading');
        if (cameraLabel.querySelector('span')) {
          cameraLabel.querySelector('span').textContent = '📷 Prendre une photo';
        }
      }
    }

    cameraInput.addEventListener('change', () => handleFileSelection(cameraInput));
    galleryInput.addEventListener('change', () => handleFileSelection(galleryInput));

    // Live status badge update as delivery fields change
    function refreshLiveStatusBadge() {
      const draftStatus = getGymStatus({
        ...gym,
        'Déposées en salle par': deliveredByInput.value,
        "Nombre d'affiches": postersInput.value
      });
      const meta = STATUS_META[draftStatus];
      statusBadge.style.backgroundColor = meta.badgeBg;
      statusBadge.style.color = meta.badgeText;
      statusBadge.textContent = meta.label;
    }

    deliveredByInput.addEventListener('input', refreshLiveStatusBadge);
    postersInput.addEventListener('input', refreshLiveStatusBadge);

    // Quick-fill user name
    quickFillBtn.addEventListener('click', () => {
      const cfg = getConfig();
      if (cfg.userName) {
        deliveredByInput.value = cfg.userName;
      } else {
        const entered = window.prompt('Entrez votre prénom/nom (sauvegardé pour les prochaines livraisons) :');
        if (entered && entered.trim()) {
          const clean = entered.trim();
          saveConfig({ userName: clean });
          deliveredByInput.value = clean;
          quickFillBtn.textContent = clean;
        }
      }
      refreshLiveStatusBadge();
    });

    // +/- Stepper buttons
    sheetEl.querySelectorAll('.stepper-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.stepperTarget);
        const delta = Number(btn.dataset.delta);
        const current = parseInt(target.value, 10);
        const next = Math.max(0, (Number.isNaN(current) ? 0 : current) + delta);
        target.value = String(next);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // Preset chips (Format, Accord)
    sheetEl.querySelectorAll('.preset-chips').forEach((group) => {
      const target = document.getElementById(group.dataset.presetTarget);
      const chips = Array.from(group.querySelectorAll('.preset-chip'));

      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const val = chip.dataset.value;
          if (target.value.trim().toLowerCase() === val.toLowerCase()) {
            target.value = '';
            chip.classList.remove('active');
          } else {
            target.value = val;
            chips.forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
          }
        });
      });

      target.addEventListener('input', () => {
        const curr = target.value.trim().toLowerCase();
        chips.forEach((c) => {
          c.classList.toggle('active', c.dataset.value.toLowerCase() === curr);
        });
      });
    });

    // Submit -> POST updates to Google Apps Script (or mock store)
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSaving || isUploadingPhoto) return;

      const formData = new FormData(form);
      const updates = {};

      for (const [key, rawVal] of formData.entries()) {
        const trimmed = String(rawVal).trim();
        let normalized = trimmed;

        if (key === "Nombre d'affiches" || key === 'Nombre de places offertes') {
          normalized = trimmed === '' ? '' : Number(trimmed);
        }

        const prevRaw = gym[key] ?? '';
        const prevNormalized =
          (key === "Nombre d'affiches" || key === 'Nombre de places offertes') && prevRaw !== ''
            ? Number(prevRaw)
            : String(prevRaw).trim();

        if (normalized !== prevNormalized) {
          updates[key] = normalized;
        }
      }

      if (Object.keys(updates).length === 0) {
        showToast('Aucune modification à enregistrer.', 'info');
        return;
      }

      if (updates['Déposées en salle par'] && !getConfig().userName) {
        saveConfig({ userName: String(updates['Déposées en salle par']).trim() });
      }

      isSaving = true;
      saveBtn.disabled = true;
      spinner.classList.remove('hidden');
      btnLabel.textContent = 'Enregistrement…';

      try {
        const updatedGym = await updateGym(gym.rowIndex, gym['NOM'], updates);
        isSaving = false;
        showToast('Enregistré !', 'success');
        if (onSaved) onSaved(updatedGym);
        close();
      } catch (err) {
        isSaving = false;
        saveBtn.disabled = false;
        spinner.classList.add('hidden');
        btnLabel.textContent = 'Enregistrer';

        const msg = !navigator.onLine
          ? 'Hors ligne : impossible de synchroniser.'
          : err.message || 'Erreur lors de la sauvegarde.';
        showToast(msg, 'error', 4500);
      }
    });
  }

  return { open, close };
}
