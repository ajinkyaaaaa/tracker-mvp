# Expo / EAS — Build & Distribution Guide

Everything is on the preview branch on eas for the released app.
Push new updates: eas update --channel preview --message "<commit message>"

For backend: Railway (just git push)
For frontend: EAS update (expo)

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

## What is a Dev Client Build?

A dev client is a custom version of your app built specifically for development. Think of it as a replacement for Expo Go that is tailored to your exact project.

**Why you can't use Expo Go:**

| Reason | Detail |
| ------ | ------ |
| SDK version mismatch | This project uses Expo SDK 55. Expo Go on the App Store only supports the last 1–2 SDK versions. If your SDK is newer, Expo Go will refuse to open it. |
| Background location | Expo Go sandboxes native features. Background GPS (used by this app) does not work inside Expo Go at all. |

**The fix — build a dev client once:**
```bash
eas build --profile development --platform ios
```
EAS builds a custom `.ipa` with your full native config (permissions, background modes, etc.) and registers it to your device via ad-hoc distribution. Install it from the EAS dashboard link.

**After that, hot reload works exactly like Expo Go:**
```bash
cd frontend
npx expo start
```
Scan the QR → choose **development build** → full hot reload on every save. You only ever need to rebuild the dev client if you change native code (new package, `app.json` permissions, etc.). Pure JS changes never need a rebuild.

---

## Getting the App on Your Phone (Dev)

Once you have the dev client installed from `eas build --profile development --platform ios`:

```bash
cd frontend
npx expo start
```

Scan the QR code → choose **development build**. Full hot reload, no rebuild needed. Only works while `npx expo start` is running on your machine.

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

## Switching Between Local and Railway

Only one file changes: `frontend/.env`

### → Switch to Local

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

- Replace `192.168.x.x` with your machine's current IP: `ipconfig getifaddr en0`
- Your phone and laptop must be on the **same Wi-Fi network**
- Start the local backend: `cd backend && python app.py`
- Start Expo: `cd frontend && npx expo start` → scan QR in dev client app

### → Switch to Railway

```
EXPO_PUBLIC_API_URL=https://tracker-mvp-production.up.railway.app
```

- No backend to run locally — Railway handles it
- Start Expo: `cd frontend && expo start` → scan QR in dev client app

### What is and isn't affected

| Thing                          | Affected by `.env` change? |
| ------------------------------ | -------------------------- |
| Expo Go / dev client (local)   | Yes — reads `.env` at `expo start` time |
| EAS preview/production builds  | No — URL is baked in via `eas.json` env, always Railway |
| Railway deployment             | No                         |
| Backend code                   | No                         |

---

## Summary Cheat Sheet

```
Backend change  →  git push → Railway auto-deploys. Done.
JS change       →  eas update --branch preview. Done.
Native change   →  eas build --profile preview → new APK/IPA to testers.
```
