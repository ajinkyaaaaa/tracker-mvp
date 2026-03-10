// locationService.js — Background GPS tracking service
// Registers a background task that fires every 30 s (or 10 m of movement).
// Points are cached in AsyncStorage and synced to the backend by MapScreen.js → syncLocations().
// Only records during work hours (09:00–18:00) to avoid off-hours data.

import * as Location   from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage    from '@react-native-async-storage/async-storage';

const LOCATION_TASK      = 'background-location-task';
const LOCATION_CACHE_KEY = 'cached_locations';

// ── Background task definition ────────────────────────────────────────────────
// Must be defined at module level (not inside a component) per Expo TaskManager rules.
// Fired by the OS; caches points to AsyncStorage for later sync via api.syncLocations()
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) { console.error('Background location error:', error); return; }
  if (!data)  return;

  const { locations } = data;
  const hour = new Date().getHours();

  // Skip outside work hours — no point storing off-clock GPS data
  if (hour < 9 || hour >= 18) return;

  const newPoints = locations.map((loc) => ({
    latitude:    loc.coords.latitude,
    longitude:   loc.coords.longitude,
    recorded_at: new Date(loc.timestamp).toISOString(),
  }));

  // Append to the local cache; MapScreen.js → syncLocations() flushes this every 60 s
  try {
    const cached   = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
    const existing = cached ? JSON.parse(cached) : [];
    await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify([...existing, ...newPoints]));
  } catch (err) {
    console.error('Location cache write error:', err);
  }
});

// ── startTracking ─────────────────────────────────────────────────────────────
// Called by MapScreen.js → initTracking() after login.
// Requests permissions and starts the background location task if not already running.
export async function startTracking() {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') throw new Error('Location permissions not granted');

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') throw new Error('Background location permissions not granted');

  // Guard against double-starting (e.g. hot reload)
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (isTracking) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy:                       Location.Accuracy.High,
    timeInterval:                   30000,  // minimum 30 s between updates
    distanceInterval:               10,     // or 10 m of movement — whichever fires first
    deferredUpdatesInterval:        60000,  // batch delivery hint to OS
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'VISPL Tracking',
      notificationBody:  'Tracking your location during work hours',
    },
  });
}

// ── stopTracking ──────────────────────────────────────────────────────────────
// Called by MapScreen.js → handleLogout() before logout to stop background updates.
export async function stopTracking() {
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

// ── getCachedLocations ────────────────────────────────────────────────────────
// Read by MapScreen.js → syncLocations() every 60 s before posting to the backend.
export async function getCachedLocations() {
  const cached = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
  return cached ? JSON.parse(cached) : [];
}

// ── clearCachedLocations ──────────────────────────────────────────────────────
// Called by MapScreen.js → syncLocations() after a successful POST /api/locations/sync.
export async function clearCachedLocations() {
  await AsyncStorage.removeItem(LOCATION_CACHE_KEY);
}

// ── getCurrentLocation ────────────────────────────────────────────────────────
// One-shot high-accuracy fix used by MapScreen.js for recentring, idle detection,
// marking a location, and navigating (openInMaps).
export async function getCurrentLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}
