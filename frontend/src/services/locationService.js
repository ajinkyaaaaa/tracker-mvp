// locationService.js — Background GPS tracking service
// Registers a background task that the OS fires every ~3 s (foreground service keeps it alive).
// Smart interval filtering inside the task handler:
//   Inside any saved-location geofence → save at most once per idle_interval seconds (default 30)
//   Outside all geofences              → save at most once per active_interval seconds (default 3)
// This gives smooth road polylines when moving and battery-friendly idle tracking when parked.
//
// Geofences written to AsyncStorage by MapScreen.js → syncAllGeofencesToTracking()
// Intervals written to AsyncStorage by MapScreen.js → loadTrackingIntervals()
// Points cached in AsyncStorage and drained to local SQLite by MapScreen.js → drainCacheToSQLite() every 60 s

import * as Location    from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage     from '@react-native-async-storage/async-storage';

const LOCATION_TASK      = 'background-location-task';
const LOCATION_CACHE_KEY = 'cached_locations';
const GEOFENCES_KEY      = 'geofences_data';     // [{ latitude, longitude, radius }]
const INTERVALS_KEY      = 'tracking_intervals'; // { active: number, idle: number } (seconds)
const LAST_SAVE_KEY      = 'last_location_save'; // ms timestamp of last cached point

// Haversine distance in metres — needed at module level for the background task context
function distanceMetres(lat1, lon1, lat2, lon2) {
  const R  = 6371e3;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Background task ────────────────────────────────────────────────────────────
// Must be defined at module level per Expo TaskManager rules.
// Fires every ~3 s; reads geofences + intervals from AsyncStorage to decide whether to save.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) { console.warn('Background location error:', error); return; }
  if (!data)  return;

  const hour = new Date().getHours();
  if (hour < 9 || hour >= 18) return; // skip outside work hours

  const { locations } = data;
  const latest = locations[locations.length - 1];
  if (!latest) return;
  const { latitude, longitude } = latest.coords;

  try {
    const [geofencesRaw, intervalsRaw, lastSaveRaw] = await Promise.all([
      AsyncStorage.getItem(GEOFENCES_KEY),
      AsyncStorage.getItem(INTERVALS_KEY),
      AsyncStorage.getItem(LAST_SAVE_KEY),
    ]);

    const geofences = geofencesRaw ? JSON.parse(geofencesRaw) : [];
    const intervals = intervalsRaw ? JSON.parse(intervalsRaw) : { active: 3, idle: 30 };
    const lastSave  = lastSaveRaw  ? parseInt(lastSaveRaw)    : 0;

    // Choose interval based on whether user is inside any saved-location geofence
    const inGeofence    = geofences.some(g =>
      distanceMetres(latitude, longitude, g.latitude, g.longitude) <= (g.radius ?? 100)
    );
    const minIntervalMs = (inGeofence ? intervals.idle : intervals.active) * 1000;

    const now = Date.now();
    if (now - lastSave < minIntervalMs) return; // too soon — skip this tick

    await AsyncStorage.setItem(LAST_SAVE_KEY, String(now));

    // Append all points from this batch to the cache
    const newPoints = locations.map(loc => ({
      latitude:    loc.coords.latitude,
      longitude:   loc.coords.longitude,
      recorded_at: new Date(loc.timestamp).toISOString(),
    }));
    const cached   = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
    const existing = cached ? JSON.parse(cached) : [];
    await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify([...existing, ...newPoints]));
  } catch (err) {
    console.error('Location task error:', err);
  }
});

// ── startTracking ──────────────────────────────────────────────────────────────
// Called by MapScreen.js → initTracking() after login.
// Always starts at 3 s / High accuracy — interval logic lives inside the task handler.
export async function startTracking() {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') throw new Error('Location permissions not granted');

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') throw new Error('Background location permissions not granted');

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (isTracking) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy:                         Location.Accuracy.High, // GPS needed for accurate road polylines
    timeInterval:                     3000,                   // OS fires task every ~3 s
    distanceInterval:                 0,                      // no distance gate — time-based filtering in task
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'VISPL Tracking',
      notificationBody:  'Tracking your location during work hours',
    },
  });
}

// ── stopTracking ───────────────────────────────────────────────────────────────
// Called by MapScreen.js → handleLogout() before logout.
export async function stopTracking() {
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

// ── syncGeofences ──────────────────────────────────────────────────────────────
// Called by MapScreen.js → syncAllGeofencesToTracking() after loading any location set.
// Writes all active geofence boundaries to AsyncStorage so the background task can read them.
export async function syncGeofences(geofences) {
  try {
    await AsyncStorage.setItem(GEOFENCES_KEY, JSON.stringify(geofences));
  } catch {}
}

// ── syncTrackingIntervals ──────────────────────────────────────────────────────
// Called by MapScreen.js → loadTrackingIntervals() after fetching admin settings.
// Writes { active, idle } (seconds) to AsyncStorage for the background task.
export async function syncTrackingIntervals(active, idle) {
  try {
    await AsyncStorage.setItem(INTERVALS_KEY, JSON.stringify({ active, idle }));
  } catch {}
}

// ── getCachedLocations ─────────────────────────────────────────────────────────
// Read by MapScreen.js → drainCacheToSQLite() every 60 s
export async function getCachedLocations() {
  const cached = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
  return cached ? JSON.parse(cached) : [];
}

// ── clearCachedLocations ───────────────────────────────────────────────────────
// Called by MapScreen.js → drainCacheToSQLite() after inserting points into local SQLite
export async function clearCachedLocations() {
  await AsyncStorage.removeItem(LOCATION_CACHE_KEY);
}

// ── getCurrentLocation ─────────────────────────────────────────────────────────
// One-shot fix: tries last known position (≤5 min old, instant) then fresh Balanced fix.
// Used by MapScreen.js for idle detection and mark-location pin snap.
export async function getCurrentLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 300000, requiredAccuracy: 200 }).catch(() => null);
  if (last) return last;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, timeout: 10000 }).catch(() => null);
}

// ── getFreshLocation ───────────────────────────────────────────────────────────
// Forces a raw GPS ping — skips all caches. Used by MapScreen.js → recenterMap()
export async function getFreshLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, timeout: 10000 }).catch(() => null);
}
