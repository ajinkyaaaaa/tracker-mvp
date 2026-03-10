# VISPL Tracker — Coding Standards

## Comment Style

Every file starts with a module-level comment block that describes:
- What the file does
- Key data flows (which function calls which endpoint, where values go)

```python
# routes/auth.py — Authentication routes
# Frontend entry point: src/services/api.js → api.login / api.register
```

```js
// MapScreen.js — Primary employee tracking screen
// Data flows:
//   locationService.js → syncLocations() → POST /api/locations/sync
//   GET /api/locations/today → loadTodayPathOnly() → Polyline on map
```

Each route or function includes a one-liner (or short block) explaining:
- What it receives and from where
- What it returns and where that value is consumed

```python
# POST /api/auth/login
# Receives: { email, password } from api.js → api.login()
# Returns:  { token, user, loginTime } → consumed by AuthContext.login()
```

```js
// Fetches today's GPS trail → GET /api/locations/today (routes/locations.py)
// Result is rendered as a black Polyline on the MapView.
async function loadTodayPathOnly() { ... }
```

Cross-boundary references (frontend → backend or service → screen) always name
the calling function and the destination file/route.

---

## General Rules

- No unused variables, imports, or dead code — remove them, don't comment them out.
- No inline imports (e.g. `import x` inside a function body).
- Keep comments crisp — one line where possible. Never restate what the code already says.
- Prefer clarity over cleverness.

---

## UI / Styling

- **Palette**: black & white throughout all screens.
  ```
  BG    = '#FFFFFF'   // page backgrounds
  CARD  = '#F2F2F7'   // input fields, chips, secondary surfaces
  BLACK = '#000000'   // primary text, filled buttons
  GRAY  = '#6D6D72'   // secondary / placeholder text
  GRAY2 = '#C7C7CC'   // borders, dividers, handle bars
  GRAY3 = '#E5E5EA'   // subtle separators
  WHITE = '#FFFFFF'   // text on black buttons
  ```
- **Semantic colours** (retained for usability):
  - `#FF3B30` — errors, pending status indicators
  - `#34C759` — LIVE dot only
- Primary buttons: `BLACK` background, `WHITE` text.
- Secondary / cancel buttons: `CARD` background, `BLACK` text, `GRAY3` border.
- Map controls: white rounded-square cards with drop shadows (Apple Maps style).
- All icon buttons use `@expo/vector-icons` (MaterialIcons / Ionicons) — no emoji for UI controls.
