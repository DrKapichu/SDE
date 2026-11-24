# Climbing Gym Poster Delivery Map — Setup Guide

This repository contains two parts:
1. [`/gas/Code.gs`](./gas/Code.gs) — Google Apps Script backend bound to your Google Sheet.
2. `/frontend` — Mobile-first Vite + Leaflet web app.

---

## 1. Google Apps Script Backend Setup

### 1.1 Paste the script
1. Open your Google Sheet containing the climbing gym data.
2. Verify Row 1 contains the expected headers (`Contacté le`, `NOM`, `Localisation`, `Contact`, `Déposées en salle par`, `Accord`, `Mail`, `Adresse`, `Nombre d'affiches`, `Format`, `Nombre de places offertes`).
   - You do **not** need to add `Lat` and `Lng` manually — the script automatically appends them if missing.
3. In Google Sheets, click **Extensions → Apps Script**.
4. Delete any default code in `Code.gs` and paste the entire contents of [`gas/Code.gs`](./gas/Code.gs).
5. Save the project (**Ctrl+S** / **Cmd+S**).

### 1.2 Set `API_TOKEN` in Script Properties
1. In the Apps Script editor left sidebar, click **Project Settings** (gear icon).
2. Scroll down to **Script Properties** → click **Add script property**.
3. Add:
   - **Property**: `API_TOKEN`
   - **Value**: a strong random secret string (e.g., `climb-jan-2026-x9k2p7m4`)
4. *(Optional)* If your data is not on the first tab of the spreadsheet, add another property:
   - **Property**: `SHEET_NAME`
   - **Value**: exact name of the target tab
5. Click **Save script properties**.

### 1.3 Initialize & Authorize
1. Return to the **Editor** tab, select `initializeSheet` in the function dropdown at the top, and click **Run**.
2. Review and grant permissions (Sheets access + external URL fetch for the `api-adresse.data.gouv.fr` geocoding fallback).
3. Check the **Execution log** to confirm your headers and `API_TOKEN configured: true`.

### 1.4 Deploy as a Web App
1. Click **Deploy → New deployment**.
2. Click the gear icon next to *Select type* → choose **Web app**.
3. Configure:
   - **Description**: `Climbing Gym Delivery API v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` *(access is protected by your `API_TOKEN`)*
4. Click **Deploy** and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
   - Deployment ID: `AKfycby7UoxeIexFCx_emSriqzNnLEnIYOsHOuAfylr9ZXnqdSo99wwIg39oNqn0cJi0Hfu0`
   - URL: `https://script.google.com/macros/s/AKfycby7UoxeIexFCx_emSriqzNnLEnIYOsHOuAfylr9ZXnqdSo99wwIg39oNqn0cJi0Hfu0/exec`

> **Note on updates:** Whenever you edit `Code.gs`, you must create a new version via **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** for changes to take effect.

### 1.5 Quick API Test
Open in your browser (replace placeholders):
```
https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec?token=YOUR_API_TOKEN
```
You should receive JSON with `"ok": true` and your `"gyms"` array. On the first call, up to 25 gyms without coordinates will be geocoded and cached into the `Lat`/`Lng` columns; refresh once more if `remainingToGeocode > 0`.

---

## 2. Frontend Local Development

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:
```env
# Set to "true" to test the UI with local mock data (no Google Sheet needed)
VITE_USE_MOCK=true

# Live Google Apps Script Web App URL & token (used when VITE_USE_MOCK=false)
VITE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec
VITE_API_TOKEN=your-secret-token
```

Start the dev server:
```bash
npm run dev
```

---

## 3. Deploying the Frontend to GitHub Pages

> **Security tip:** For a public GitHub Pages site, leave `VITE_API_TOKEN` empty in your build environment and enter the token once on your phone via the in-app **Settings** modal (stored in `localStorage`).

### Option A: GitHub Actions (Recommended)
1. Push this repository to GitHub.
2. In `frontend/vite.config.js`, ensure `base` matches your repository name (e.g., `base: '/YOUR_REPO_NAME/'` or set via `VITE_BASE_PATH`).
3. In your GitHub repo, go to **Settings → Pages → Source** and select **GitHub Actions**.
4. *(Optional)* Add `VITE_API_URL` as a repository **Variable** under **Settings → Secrets and variables → Actions → Variables**.
5. Add `.github/workflows/deploy.yml`:

```yaml
name: Deploy Frontend to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - working-directory: frontend
        run: npm ci
      - working-directory: frontend
        env:
          VITE_USE_MOCK: "false"
          VITE_API_URL: ${{ vars.VITE_API_URL }}
          VITE_BASE_PATH: /${{ github.event.repository.name }}/
        run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Option B: Manual Build
```bash
cd frontend
VITE_BASE_PATH=/YOUR_REPO_NAME/ npm run build
```
Upload the contents of `frontend/dist/` to your static host or `gh-pages` branch.
