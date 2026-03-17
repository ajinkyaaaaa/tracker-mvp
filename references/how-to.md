# Expo / EAS — Build & Distribution Guide

---

## Env Variable Setup

Three variables the backend reads — set these in the Railway dashboard (and locally in `backend/.env`):

| Variable     | Value                                        | Notes                           |
| ------------ | -------------------------------------------- | ------------------------------- |
| `JWT_SECRET` | `vispl-tracking-secret-change-in-production` | Set in Railway Variables tab    |
| `DB_PATH`    | `database.sqlite`                            | Set in Railway Variables tab    |
| `PORT`       | —                                            | Railway sets this automatically |

Frontend points to Railway via `EXPO_PUBLIC_API_URL` in `frontend/.env`:
```
EXPO_PUBLIC_API_URL=https://tracker-mvp-production.up.railway.app
```
This is also baked into `eas.json` for the `preview` and `production` build profiles.

---

## Three Workflows — Mental Model

| Workflow              | Tool                              | API URL source           | Use case                                                      |
| --------------------- | --------------------------------- | ------------------------ | ------------------------------------------------------------- |
| Expo Go               | `expo start`                      | `.env` → Railway         | Quick JS-only iteration (background location won't work here) |
| Dev client build      | `eas build --profile development` | `eas.json` env → Railway | Full native dev on your own phone — hot reload, background GPS |
| Preview/release build | `eas build --profile preview`     | `eas.json` env → Railway | Distributing to testers                                       |

---

## When Do You Need to Rebuild?

| Change type                             | Rebuild needed?                      |
| --------------------------------------- | ------------------------------------ |
| Backend code (Railway)                  | Never — deploy to Railway separately |
| JS / screens / logic / styles           | No — use OTA update (see below)      |
| New npm package with native code        | Yes                                  |
| `app.json` changes (permissions, icons) | Yes                                  |
| Adding a new Expo plugin                | Yes                                  |

**Rule of thumb**: native code touched → rebuild. Pure JS → OTA push.

---

## Getting the App on Your Phone (Dev)

Once you have the dev client APK installed from `eas build --profile development`:

```bash
cd frontend
expo start
```

Scan the QR code in the Expo dev client app. Full hot reload, no rebuild needed. Equivalent to the old local tunnel setup — but only works while `expo start` is running on your machine.

---

## Distributing to Testers

### Android — APK sideload
```bash
eas build --profile preview --platform android
```
EAS produces a download link + QR code. Testers enable "Install from unknown sources" and install directly. No app store needed.

### iOS — TestFlight (recommended)
iOS cannot sideload like Android. TestFlight is the easiest path:
```bash
eas build --profile production --platform ios
eas submit --platform ios
```
Add testers in App Store Connect → TestFlight tab → they receive an email invite.

**Alternative (ad-hoc, for 1–5 people)**: collect each tester's UDID, register in Apple Developer portal, set `distribution: "internal"` in the iOS section of `eas.json`, then build and share the IPA link.

---

## Instant OTA Updates (No Reinstall)

After making JS-only changes, push an over-the-air update to all installed tester builds:

```bash
cd frontend
eas update --branch preview --message "describe your change"
```

The next time testers open the app it silently downloads and applies the update.

One-time setup (if not already done):
```bash
eas update:configure
```

---

## Resetting an Existing iPhone Setup (Expo Go + TestFlight)

**You don't need to delete anything.** Here's what each install actually is:

| What's on your phone     | What it is                                                                  | Action needed                    |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------- |
| Expo Go                  | Generic app from App Store — reads URL live from `.env` at `expo start`     | Nothing, already works           |
| Old TestFlight build     | `EXPO_PUBLIC_API_URL` baked in at build time — OTA cannot change it         | Build + submit a new version     |

`EXPO_PUBLIC_API_URL` is embedded during the EAS build, not part of the JS bundle. An old build pointing at a dead hotspot IP cannot be fixed via `eas update` — a new build is required.

**Fix (no manual deletion needed):**
```bash
cd frontend
eas build --profile production --platform ios
eas submit --platform ios
```
TestFlight shows it as a new build, existing testers are notified automatically, and the old broken build is superseded.

Only wipe and start from scratch if you're changing the bundle ID or app name — otherwise a new build is all you need.

---

## Summary Cheat Sheet

```
Backend change  →  git push → Railway auto-deploys. Done.
JS change       →  eas update --branch preview. Done.
Native change   →  eas build --profile preview → new APK/IPA to testers.
```
