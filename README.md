# REPS

A personal gym tracker, built as an offline-first Progressive Web App. Single user, no auth, all data in IndexedDB on the device.

## Features

- **Three set types** — Standard (N rounds × 1 min work / 1 min rest), Bilateral (3 rounds × L / R / rest), Continuous (single 10-min block with a tap counter).
- **Auto-advancing timer** with WebAudio cues at the last 3 seconds and on phase changes; tap the ring to skip.
- **Strength scoring** — Epley estimated 1RM, percentile lookup against embedded standards, level (Beginner → Elite), "X kg to next level".
- **7-day rest rule** per exercise — soft warning, can be overridden.
- **Weekly dashboard** with sessions, exercises, total volume, and week-over-week deltas.
- **History** grouped by day, filterable Week / Month / All.
- **Profile** with DOB, sex, height, monthly weight log + JSON export/import.
- **Installable** to the iOS / Android home screen, works fully offline once cached.

## Tech

- Vanilla HTML / CSS / ES modules — no build step.
- IndexedDB via a thin promise-wrapped repo layer (`src/db/`).
- Pure-function domain layer (`src/domain/`) — unit-tested with `node --test`.
- Service worker with cache-first app shell.
- Web app manifest configured for standalone iOS / Android install.

## Project layout

```
index.html                  # single-page shell
manifest.webmanifest        # PWA manifest
service-worker.js           # offline cache
styles/                     # locked design tokens + components
src/
  app.js                    # bootstrap: SW, seed, router
  router.js                 # hash router
  db/                       # IndexedDB schema + typed repo
  data/                     # starter exercises + strength standards
  domain/                   # scoring, volume, rest rule, week aggregates
  ui/                       # timer engine, tap counter, render helpers
  views/                    # 6 screens
tests/                      # node --test domain tests
.github/workflows/deploy.yml
```

## Running locally

The app is static — any HTTP server works. From the repo root:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Service workers require HTTPS or localhost; `file://` won't work.

To run the domain tests:

```sh
node --test tests/
```

## Deploying to GitHub Pages

1. Create a public GitHub repo (e.g. `reps`).
2. Push `main`.
3. In the repo settings → Pages, set **Source** to **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` runs the tests and publishes on every push to `main`.

The site will be served at `https://<username>.github.io/<repo>/`. All paths in `index.html`, `manifest.webmanifest`, and `service-worker.js` are relative, so it works at any subpath without changes.

## Strength standards data

`src/data/strength-standards.js` contains placeholder approximate values per movement, sex, and bodyweight. The schema is documented at the top of the file. To replace with verified Strength Level data, swap the numbers — the scoring logic in `src/domain/scoring.js` does not need to change.

Movements without a standards entry render "no benchmark available" and only show the estimated 1RM.

## Backup

IndexedDB lives in your browser profile. Clearing site data wipes it. Use **Profile → Backup → Export JSON** periodically. Importing replaces all local data.

## Why no framework?

The app is small and the surface area (~6 screens, no real-time, no networking) doesn't warrant a build step. Vanilla modules ship as-is, the service worker can list its own dependencies, and there are no toolchain upgrades to maintain.
