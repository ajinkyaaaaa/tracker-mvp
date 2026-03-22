// MapScreen.js — Primary employee tracking screen
// Shows a full-screen live map with today's GPS trail, saved location pins,
// idle-stop detection, and a drop-pin overlay (step 1 of Register Location flow).
// Also renders a login-time widget (below nav pill) with an "i" button
// that opens LoginCalendarModal showing past login/logout history.
//
// Data flows (offline-first):
//   locationService.js  → caches GPS points in AsyncStorage (3 s outside geofence, 30 s inside)
//   drainCacheToSQLite()→ every 60 s moves cache → localDatabase.js → local_locations
//   localDatabase.js    → getTodayPath()          → Polyline on map
//   AsyncStorage saved_locations_data → loadSavedLocations() → map pins + idle suppression
//   syncAllGeofencesToTracking() → writes combined geofences to AsyncStorage for background task
//   GET /api/settings/tracking-intervals → loadTrackingIntervals() → syncTrackingIntervals()
//   idle detection → onIdleThresholdReached() → insertStop() / insertClientVisit() immediately → local DB only
//   loginTime (AuthContext) → insertLoginSession() → local_login_sessions on mount
//   handleConfirmPin() → navigation.navigate('RegisterLocation') → RegisterLocationScreen.js

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, Platform, AppState,
  Animated,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Notifications from 'expo-notifications';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api }            from '../services/api';
import {
  startTracking, stopTracking, getCurrentLocation, getFreshLocation,
  getCachedLocations, clearCachedLocations,
  syncGeofences, syncTrackingIntervals,
} from '../services/locationService';
import {
  insertLocation, getTodayPath,
  insertStop, updateStopDwell, insertClientVisit, getStopsByDate,
  insertLoginSession, getLoginSessionsByDateRange,
} from '../services/localDatabase';
import NavPill from '../components/NavPill';

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';

const LOGIN_DEADLINE_DEFAULT = '09:00'; // fallback until the server value is fetched
const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sun → Sat

// Returns 7 ISO date strings for the current Sun→Sat week
function getWeekDates() {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Returns the current week index (1-based) within the month
function getCurrentWeekNum() {
  return Math.ceil(new Date().getDate() / 7);
}

const MUTE_STORAGE_KEY      = 'muted_locations';
const IDLE_THRESHOLD_MS     = 15 * 60 * 1000;
const GRACE_PERIOD_MS       = 10 * 60 * 1000;
const SAVED_LOCATION_RADIUS = 200;
const MUTE_RADIUS           = 25;
const LUNCH_START = 13;
const LUNCH_END   = 14;

// Haversine distance in metres between two GPS coordinates
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3, r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CATEGORIES = [
  { key: 'client',    label: 'Client',    icon: 'people' },
  { key: 'rest-stop', label: 'Rest stop', icon: 'pause' },
  { key: 'site',      label: 'Site',      icon: 'factory' },
];
// Includes legacy keys so existing saved locations still display correct icons
const CATEGORY_ICON = {
  ...CATEGORIES.reduce((acc, c) => ({ ...acc, [c.key]: c.icon }), {}),
  office:    'business',
  warehouse: 'warehouse',
  home:      'home',
  food:      'restaurant',
  other:     'place',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

// Acquiring/acquired location overlay — shown on first mount until GPS fix is confirmed
function LocationAcquiringOverlay({ status }) {
  const spinAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'acquiring') {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 2200, useNativeDriver: true })
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1,   duration: 750, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
        ])
      ).start();
    }
    if (status === 'acquired') {
      spinAnim.stopAnimation();
      pulseAnim.stopAnimation();
      Animated.timing(fadeAnim, { toValue: 0, duration: 600, delay: 1200, useNativeDriver: true }).start();
    }
  }, [status]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[overlayStyles.wrap, { opacity: fadeAnim }]}>
      <View style={overlayStyles.card}>
        {status === 'acquiring' ? (
          <>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <MaterialIcons name="explore" size={42} color={BLACK} />
            </Animated.View>
            <Animated.Text style={[overlayStyles.text, { opacity: pulseAnim }]}>
              Acquiring location…
            </Animated.Text>
          </>
        ) : (
          <>
            <MaterialIcons name="check-circle" size={42} color={BLACK} />
            <Text style={overlayStyles.text}>Location acquired</Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const overlayStyles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    zIndex: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  card: {
    alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 24, paddingVertical: 32, paddingHorizontal: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10, shadowRadius: 20, elevation: 12,
  },
  text: { color: '#000000', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
});

// Pulsating green live-location dot — replaces the native blue marker
function LiveLocationMarker({ coordinate }) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = (anim, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: false }),
          Animated.timing(anim, { toValue: 0, duration: 0,    useNativeDriver: false }),
        ])
      ).start();
    pulse(ring1, 0);
    pulse(ring2, 900);
  }, [ring1, ring2]);

  const ringStyle = (anim) => ({
    position: 'absolute',
    width:        anim.interpolate({ inputRange: [0, 1], outputRange: [14, 54] }),
    height:       anim.interpolate({ inputRange: [0, 1], outputRange: [14, 54] }),
    borderRadius: anim.interpolate({ inputRange: [0, 1], outputRange: [7,  27] }),
    opacity:      anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.55, 0.3, 0] }),
    backgroundColor: '#34C759',
  });

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges zIndex={100}>
      <View style={{ width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}>
        <Animated.View style={ringStyle(ring1)} />
        <Animated.View style={ringStyle(ring2)} />
        <View style={styles.liveDot} />
      </View>
    </Marker>
  );
}

// GlowSweepText — white italic word with a subtle opacity fade loop
// Used for "away..." and "moving..." in the at-card status row
function GlowSweepText({ label }) {
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fade, { toValue: 0.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1,   duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.Text style={{ color: '#89ff33', fontStyle: 'italic', fontSize: 16, fontWeight: '800', letterSpacing: -0.3, opacity: fade }}>
      {label}...
    </Animated.Text>
  );
}

function ScalePress({ onPress, style, children }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={() => Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, speed: 60 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 60 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

export default function MapScreen({ navigation }) {
  const { user, loginTime, logout } = useAuth();
  const [path,             setPath]             = useState([]);
  const [region,           setRegion]           = useState(null);
  const [mapType,          setMapType]          = useState('standard');
  // Mark-location overlay — Step 1: drop pin, see live GPS coordinates
  const [markMode,   setMarkMode]   = useState(false);
  const [markCenter, setMarkCenter] = useState(null); // live map crosshair position (updates via onRegionChange)
  const [savedLocations,   setSavedLocations]   = useState([]);
  const [baseLocations,    setBaseLocations]    = useState([]);  // Array<{ name, latitude, longitude, radius }>
  const [homeLocations,    setHomeLocations]    = useState([]);  // Array<{ name, latitude, longitude, radius }>
  const [pendingCount,     setPendingCount]     = useState(0);
  const [weekLoginMap,     setWeekLoginMap]     = useState({});
  const [loginDeadline,    setLoginDeadline]    = useState(LOGIN_DEADLINE_DEFAULT); // "HH:MM"
  const [showLoginStatus,  setShowLoginStatus]  = useState(false);
  const loginStatusAnim    = useRef(new Animated.Value(0)).current;
  const loginStatusTimerRef = useRef(null);

  const mapRef          = useRef(null);
  const appState        = useRef(AppState.currentState);
  const markCardAnim    = useRef(new Animated.Value(0)).current;    // step-1 bottom card fade/slide
  const markPinDropAnim = useRef(new Animated.Value(-80)).current;  // crosshair drop animation

  const idleTimerRef         = useRef(null);
  const graceTimerRef        = useRef(null);
  const idleStartTimeRef     = useRef(null);
  const idleAnchorRef        = useRef(null);
  const notificationFiredRef = useRef(false);
  const activeStopIdRef      = useRef(null);   // local DB id of the in-progress stop; null when idle
  const cooldownZonesRef     = useRef([]);
  const movingResetRef       = useRef(null);

  const [isMoving, setIsMoving] = useState(false);

  const navAnim = useRef(new Animated.Value(0)).current;

  const liveLocRef    = useRef(null);   // latest GPS position, synced from path state
  const [locationStatus, setLocationStatus] = useState('acquiring'); // 'acquiring' | 'acquired' | null
  const [liveGpsPoint,   setLiveGpsPoint]   = useState(null); // set immediately from getCurrentLocation() on mount
  const [reacquiring,    setReacquiring]    = useState(false); // true while re-acquire GPS tap is in flight
  const hasAcquiredRef      = useRef(false);
  const acquireTimeoutRef   = useRef(null);
  const overlayDismissedRef = useRef(false); // true once overlay is hidden by timeout (prevents re-flash)

  // Today's date as YYYY-MM-DD — used as the local DB partition key
  const todayDate   = new Date().toISOString().slice(0, 10);
  const weekDates   = getWeekDates();
  const currentWeek = getCurrentWeekNum();
  const _now        = new Date();
  const dateLabel   = _now.toLocaleString('default', { month: 'short' }) + ' ' + _now.getDate();

  // Group weekDates into consecutive segments by month; non-current-month days become a pill
  const _refMonth = new Date(todayDate).getMonth();
  const _refYear  = new Date(todayDate).getFullYear();
  const weekSegments = [];
  weekDates.forEach((date, i) => {
    const d         = new Date(date);
    const isCurrent = d.getMonth() === _refMonth && d.getFullYear() === _refYear;
    const prev      = weekSegments[weekSegments.length - 1];
    if (prev && prev.isCurrent === isCurrent) {
      prev.indices.push(i);
    } else {
      weekSegments.push({ isCurrent, indices: [i], monthName: d.toLocaleString('default', { month: 'long' }) });
    }
  });

  // liveGpsPoint is always the freshest real GPS fix (set by initTracking / reacquireLocation / drain).
  // path[last] is only used as a fallback before the first GPS fix arrives.
  const liveCoord = liveGpsPoint ?? (path.length > 0 ? path[path.length - 1] : null);
  const currentPlace = (() => {
    if (!liveCoord) return null;
    const base = baseLocations.find(b =>
      getDistance(liveCoord.latitude, liveCoord.longitude, b.latitude, b.longitude) <= (b.radius ?? 100));
    if (base) return { name: base.name || 'Base Location', icon: 'star', label: 'Base' };
    const home = homeLocations.find(h =>
      getDistance(liveCoord.latitude, liveCoord.longitude, h.latitude, h.longitude) <= (h.radius ?? 100));
    if (home) return { name: home.name || 'Home', icon: 'home', label: 'Home' };
    const nearby = savedLocations.find(
      l => getDistance(liveCoord.latitude, liveCoord.longitude, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS
    );
    if (nearby) return { name: nearby.name, icon: CATEGORY_ICON[nearby.category] || 'place', label: nearby.category };
    return null;
  })();
  const currentPlaceName = currentPlace?.name ?? null;

  // Fade in/out loop for the "You're moving" label and the live dot blink
  const movingFade  = useRef(new Animated.Value(1)).current;
  const liveDotBlink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(movingFade, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(movingFade, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(liveDotBlink, { toValue: 0,   duration: 600, useNativeDriver: true }),
        Animated.timing(liveDotBlink, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    blink.start();
    return () => { anim.stop(); blink.stop(); };
  }, []);

  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);


  // Derive isMoving from each fresh GPS fix.
  // If the new point is > 50 m from the current idle anchor the user is in transit.
  // If a notification has already fired for this stop, calling resetIdleSession here
  // finalizes the actual dwell time (arrival → now) before starting fresh detection.
  useEffect(() => {
    if (!liveGpsPoint || !idleAnchorRef.current) return;
    const dist = getDistance(
      idleAnchorRef.current.latitude, idleAnchorRef.current.longitude,
      liveGpsPoint.latitude, liveGpsPoint.longitude,
    );
    if (dist > 50) {
      setIsMoving(true);
      clearTimeout(movingResetRef.current);
      movingResetRef.current = setTimeout(() => setIsMoving(false), 90_000);
      // Departure detected — finalize dwell + restart idle session at new position
      if (notificationFiredRef.current) {
        resetIdleSession(liveGpsPoint.latitude, liveGpsPoint.longitude);
      }
    }
  }, [liveGpsPoint]);

  // Auto-hide overlay after 60 s only if GPS never arrives (cold-start edge case)
  useEffect(() => {
    acquireTimeoutRef.current = setTimeout(() => {
      if (!hasAcquiredRef.current) {
        overlayDismissedRef.current = true;
        setLocationStatus(null);
      }
    }, 60000);
    return () => clearTimeout(acquireTimeoutRef.current);
  }, []);

  // Transition to 'acquired' on first GPS fix — uses liveGpsPoint (immediate from
  // getCurrentLocation) so the overlay dismisses as soon as the device has a fix,
  // even if path is still empty (e.g. first open of the day with no stored trail).
  useEffect(() => {
    const coord = liveGpsPoint ?? (path.length > 0 ? path[path.length - 1] : null);
    if (coord && !hasAcquiredRef.current) {
      hasAcquiredRef.current = true;
      clearTimeout(acquireTimeoutRef.current);
      if (!overlayDismissedRef.current) {
        // Overlay is still showing — transition acquiring → acquired → gone
        setLocationStatus('acquired');
        setTimeout(() => {
          mapRef.current?.animateCamera(
            { center: coord, pitch: 0, heading: 0, zoom: 15, altitude: 3200 },
            { duration: 700 },
          );
          setTimeout(() => setLocationStatus(null), 800);
        }, 1400);
      } else {
        // Overlay was already dismissed by timeout — just silently centre the map
        mapRef.current?.animateCamera(
          { center: coord, pitch: 0, heading: 0, zoom: 15, altitude: 3200 },
          { duration: 700 },
        );
      }
    }
  }, [liveGpsPoint, path]);

  useEffect(() => {
    setupNotifications();
    initTracking();
    loadSavedLocations();
    loadBaseLocation();
    loadPendingCount();
    loadWeekLogins();
    loadLoginDeadline();
    loadTrackingIntervals();
    loadMutedLocations();
    // Record current login session locally for sync and login history calendar
    if (loginTime) insertLoginSession(loginTime, loginTime.slice(0, 10)).catch(() => {});
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => { sub.remove(); clearIdleTimers(); };
  }, []);

  // Drain cached GPS points from AsyncStorage → local SQLite every 60 s
  // locationService.js writes to cache; this moves them into local_locations
  useEffect(() => {
    const si = setInterval(drainCacheToSQLite, 60000);
    return () => clearInterval(si);
  }, []);

  // Refresh map trail, pending badge, and week login boxes from local DB every 30 s (no network calls)
  useEffect(() => {
    const ri = setInterval(() => { loadTodayPathOnly(); loadPendingCount(); loadWeekLogins(); }, 30000);
    return () => clearInterval(ri);
  }, []);

  // Reload geo profiles + saved locations every time MapScreen gains focus.
  // useFocusEffect handles nested navigators correctly — fires when returning
  // from any parent Stack screen (Settings, ManageProfile, etc.), not just tab switches.
  useFocusEffect(
    useCallback(() => {
      loadBaseLocation();
      loadSavedLocations();
      syncAllGeofencesToTracking();
    }, [])
  );


  // ── Login time ────────────────────────────────────────────────────────────
  function parseLoginDate(ts) {
    if (!ts) return null;
    return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  }
  const loginDate          = parseLoginDate(loginTime);
  const formattedLoginTime = loginDate
    ? loginDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--';
  const formattedLoginDate = loginDate
    ? loginDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  // Compare today's login to admin deadline → shown in left-portion tap popup
  const loginStatusLabel = (() => {
    if (!loginDate) return null;
    const loginMins    = loginDate.getHours() * 60 + loginDate.getMinutes();
    const [dh, dm]     = loginDeadline.split(':').map(Number);
    const deadlineMins = dh * 60 + dm;
    if (loginMins < deadlineMins)  return 'Early';
    if (loginMins > deadlineMins)  return 'Late';
    return 'In-time';
  })();
  const loginStatusColor = loginStatusLabel === 'Late' ? '#FF3B30'
    : loginStatusLabel === 'Early' ? '#007AFF'
    : '#34C759';

  // ── Core helpers ──────────────────────────────────────────────────────────
  function clearIdleTimers() {
    if (idleTimerRef.current)  { clearTimeout(idleTimerRef.current);  idleTimerRef.current  = null; }
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
  }
  async function setupNotifications() {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => navigation.navigate('Archive'));
    return () => sub.remove();
  }

  // Reads local_stops for today → pending count badge on Archive tab
  async function loadPendingCount() {
    try {
      const stops = await getStopsByDate(todayDate);
      setPendingCount(stops.filter((s) => s.status === 'pending').length);
    } catch {}
  }

  // Fetches admin-controlled login deadline from server → used for week box colour logic
  async function loadLoginDeadline() {
    try {
      const { login_deadline } = await api.getLoginDeadline();
      if (login_deadline) setLoginDeadline(login_deadline);
    } catch {}
  }

  // Fetches admin-set tracking intervals → writes to AsyncStorage for the background task
  // GET /api/settings/tracking-intervals → { interval_active, interval_idle } (seconds)
  async function loadTrackingIntervals() {
    try {
      const { interval_active, interval_idle } = await api.getTrackingIntervals();
      await syncTrackingIntervals(interval_active ?? 3, interval_idle ?? 30);
    } catch {}
  }

  // Reads all location data from AsyncStorage and writes combined geofences to the tracking task.
  // Called after any saved/base/home location set is updated so the background task always has
  // the current geofence boundaries without waiting for a state merge.
  async function syncAllGeofencesToTracking() {
    try {
      const [savedRaw, baseRaw, homeRaw, baseLegacy, homeLegacy] = await Promise.all([
        AsyncStorage.getItem('saved_locations_data'),
        AsyncStorage.getItem('base_locations_data'),
        AsyncStorage.getItem('home_locations_data'),
        AsyncStorage.getItem('base_location_data'),
        AsyncStorage.getItem('home_location_data'),
      ]);
      const saved = savedRaw ? JSON.parse(savedRaw) : [];
      const bases = baseRaw ? JSON.parse(baseRaw) : baseLegacy ? [JSON.parse(baseLegacy)] : [];
      const homes = homeRaw ? JSON.parse(homeRaw) : homeLegacy ? [JSON.parse(homeLegacy)] : [];
      const geofences = [
        ...bases.map(l => ({ latitude: l.latitude, longitude: l.longitude, radius: l.radius ?? 100 })),
        ...homes.map(l => ({ latitude: l.latitude, longitude: l.longitude, radius: l.radius ?? 100 })),
        ...saved.map(l => ({ latitude: l.latitude, longitude: l.longitude, radius: l.radius ?? 100 })),
      ].filter(g => g.latitude && g.longitude);
      await syncGeofences(geofences);
    } catch {}
  }

  // Builds date→sessions map for current Sun→Sat week → login widget status boxes
  async function loadWeekLogins() {
    try {
      const dates = getWeekDates();
      const rows = await getLoginSessionsByDateRange(dates[0], dates[6]);
      const map = {};
      for (const r of rows) {
        if (!map[r.date]) map[r.date] = [];
        map[r.date].push(r);
      }
      setWeekLoginMap(map);
    } catch {}
  }

  function handleAppStateChange(nextState) {
    if (appState.current.match(/inactive|background/) && nextState === 'active') {
      drainCacheToSQLite(); loadTodayPathOnly(); loadPendingCount(); loadMutedLocations();
    }
    appState.current = nextState;
  }

  async function initTracking() {
    try {
      await startTracking();
      const loc = await getCurrentLocation();
      if (loc) {
        const { latitude, longitude } = loc.coords;
        const point = { latitude, longitude };
        // Set live dot immediately — don't wait for SQLite drain
        setLiveGpsPoint(point);
        liveLocRef.current = point;
        setRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        resetIdleSession(latitude, longitude);
      }
      await loadTodayPathOnly();
    } catch (err) { Alert.alert('Tracking Error', err.message); }
  }

  // Reads today's GPS trail from local SQLite → renders as black Polyline
  async function loadTodayPathOnly() {
    try {
      const locs = await getTodayPath(todayDate);
      setPath(locs.map((l) => ({ latitude: l.latitude, longitude: l.longitude })));
    } catch {}
  }

  // Moves GPS points from AsyncStorage cache → local SQLite, then refreshes the map trail.
  // Also updates liveGpsPoint + liveLocRef with the most recent cached fix so the live dot
  // always reflects the latest background position, not a stale trail point.
  async function drainCacheToSQLite() {
    try {
      const cached = await getCachedLocations();
      if (cached.length === 0) return;
      // Most recent background GPS fix → update live dot immediately
      const latest = cached[cached.length - 1];
      const point  = { latitude: latest.latitude, longitude: latest.longitude };
      setLiveGpsPoint(point);
      liveLocRef.current = point;
      for (const p of cached) {
        await insertLocation({
          latitude:    p.latitude,
          longitude:   p.longitude,
          recorded_at: p.recorded_at,
          date:        p.recorded_at.slice(0, 10),
        });
      }
      await clearCachedLocations();
      await loadTodayPathOnly();
    } catch {}
  }

  // ── Idle detection ────────────────────────────────────────────────────────
  // If the user was at an active stop, write the true dwell (arrival → now) before resetting.
  function resetIdleSession(lat, lng) {
    if (notificationFiredRef.current && activeStopIdRef.current !== null && idleStartTimeRef.current) {
      const actualDwell = Math.round((Date.now() - idleStartTimeRef.current) / 60000);
      updateStopDwell(activeStopIdRef.current, actualDwell).catch(() => {});
    }
    activeStopIdRef.current      = null;
    clearIdleTimers();
    idleAnchorRef.current        = { latitude: lat, longitude: lng };
    idleStartTimeRef.current     = Date.now();
    notificationFiredRef.current = false;
    idleTimerRef.current = setTimeout(onIdleThresholdReached, IDLE_THRESHOLD_MS);
  }
  async function onIdleThresholdReached() {
    const loc = await getCurrentLocation();
    if (!loc || !idleAnchorRef.current) return;
    const { latitude, longitude } = loc.coords;
    const dist = getDistance(idleAnchorRef.current.latitude, idleAnchorRef.current.longitude, latitude, longitude);
    if (dist > 50)                                { resetIdleSession(latitude, longitude); return; }
    if (isLunchBreak())                           { idleTimerRef.current = setTimeout(onIdleThresholdReached, 5 * 60 * 1000); return; }
    if (isNearSavedLocation(latitude, longitude)) { idleTimerRef.current = setTimeout(onIdleThresholdReached, IDLE_THRESHOLD_MS); return; }
    if (isInCooldownZone(latitude, longitude))    { idleTimerRef.current = setTimeout(onIdleThresholdReached, IDLE_THRESHOLD_MS); return; }
    if (notificationFiredRef.current) return;
    notificationFiredRef.current = true;

    const dwellMins = Math.round((Date.now() - idleStartTimeRef.current) / 60000);
    const arrivedAt = new Date(idleStartTimeRef.current).toISOString();

    // Insert the stop immediately so ArchiveScreen shows it the moment the user taps the notification
    let stopId = null;
    try {
      stopId = await insertStop({
        latitude, longitude,
        arrived_at:    arrivedAt,
        triggered_at:  new Date().toISOString(),
        dwell_duration: dwellMins,
        date:           todayDate,
      });
      // Also record a client visit if at a known saved location
      const match = savedLocations.find(
        (l) => getDistance(latitude, longitude, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS
      );
      if (match) {
        await insertClientVisit({
          stop_id:             stopId,
          saved_location_name: match.name,
          saved_location_cat:  match.category,
          latitude, longitude,
          arrived_at:          arrivedAt,
          dwell_duration:      dwellMins,
          date:                todayDate,
        });
      }
      activeStopIdRef.current = stopId;  // movement detection will finalize dwell on departure
      await loadPendingCount();
    } catch {}

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "You've been here for a while",
        body: `Please state your activity. (${dwellMins} min${dwellMins !== 1 ? 's' : ''})`,
        data: { type: 'idle-check', lat: latitude, lng: longitude, dwellMins },
      },
      trigger: null,
    });

    // Grace period: add a cooldown zone so the same spot doesn't re-trigger immediately.
    // Dwell duration is NOT updated here — resetIdleSession() writes the true elapsed time on departure.
    graceTimerRef.current = setTimeout(() => {
      addCooldownZone(latitude, longitude, 2 * 60 * 60 * 1000);
    }, GRACE_PERIOD_MS);
  }
  function isLunchBreak() { const h = new Date().getHours(); return h >= LUNCH_START && h < LUNCH_END; }
  // Returns true if lat/lng falls within any saved pin, base location, or home location.
  // Used by onIdleThresholdReached to suppress stop popups at known locations.
  function isNearSavedLocation(lat, lng) {
    if (savedLocations.some(l => getDistance(lat, lng, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS)) return true;
    if (baseLocations.some(b => getDistance(lat, lng, b.latitude, b.longitude) <= (b.radius ?? SAVED_LOCATION_RADIUS))) return true;
    if (homeLocations.some(h => getDistance(lat, lng, h.latitude, h.longitude) <= (h.radius ?? SAVED_LOCATION_RADIUS))) return true;
    return false;
  }
  function isInCooldownZone(lat, lng) {
    const now = Date.now();
    cooldownZonesRef.current = cooldownZonesRef.current.filter((z) => z.expiresAt > now);
    return cooldownZonesRef.current.some((z) => getDistance(lat, lng, z.lat, z.lng) < MUTE_RADIUS);
  }
  function addCooldownZone(lat, lng, durationMs) {
    cooldownZonesRef.current.push({ lat, lng, expiresAt: Date.now() + durationMs });
  }
  async function loadMutedLocations() {
    try {
      const raw = await AsyncStorage.getItem(MUTE_STORAGE_KEY);
      if (!raw) return;
      const muted  = JSON.parse(raw);
      const now    = Date.now();
      const active = muted.filter((m) => m.expiresAt > now);
      await AsyncStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(active));
      for (const m of active) cooldownZonesRef.current.push({ lat: m.lat, lng: m.lng, expiresAt: m.expiresAt });
    } catch {}
  }



  // Shows the login-status popup; auto-dismisses after 3 s
  function dismissLoginStatus() {
    Animated.timing(loginStatusAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => setShowLoginStatus(false));
  }
  function toggleLoginStatus() {
    clearTimeout(loginStatusTimerRef.current);
    if (showLoginStatus) {
      dismissLoginStatus();
    } else {
      setShowLoginStatus(true);
      Animated.spring(loginStatusAnim, { toValue: 1, bounciness: 8, speed: 18, useNativeDriver: true }).start();
      loginStatusTimerRef.current = setTimeout(dismissLoginStatus, 3000);
    }
  }

  // ── Map actions ───────────────────────────────────────────────────────────
  // Always fires a raw GPS ping (getFreshLocation) — skips cache so the map
  // centres on the true current position, not a stale cached fix.
  async function recenterMap() {
    const loc = await getFreshLocation().catch(() => null);
    const target = loc?.coords ?? null;
    if (!target || !mapRef.current) return;
    const point = { latitude: target.latitude, longitude: target.longitude };
    setLiveGpsPoint(point);
    liveLocRef.current = point;
    mapRef.current.animateCamera(
      { center: target, pitch: 0, heading: 0, zoom: 14, altitude: 3200 },
      { duration: 600 },
    );
  }

  // Re-fetches GPS from device → shows acquiring/acquired overlays → updates liveGpsPoint + liveLocRef + re-centres map
  // Uses getFreshLocation() to bypass cache and get a true raw ping.
  async function reacquireLocation() {
    if (reacquiring) return;
    setReacquiring(true);
    setLocationStatus('acquiring');
    try {
      const loc = await getFreshLocation();
      if (loc) {
        const { latitude, longitude } = loc.coords;
        const point = { latitude, longitude };
        setLiveGpsPoint(point);
        liveLocRef.current = point;
        await new Promise(r => setTimeout(r, 500));
        setLocationStatus('acquired');
        setTimeout(() => {
          mapRef.current?.animateCamera({ center: point, zoom: 16, pitch: 0, heading: 0 }, { duration: 600 });
          setTimeout(() => setLocationStatus(null), 800);
        }, 1400);
      } else {
        setLocationStatus(null);
      }
    } catch {
      setLocationStatus(null);
    }
    setReacquiring(false);
  }

  // Reads saved pins from AsyncStorage — instant, no network needed.
  // Also re-syncs geofences so the background task immediately sees new/removed pins.
  async function loadSavedLocations() {
    try {
      const raw = await AsyncStorage.getItem('saved_locations_data');
      setSavedLocations(raw ? JSON.parse(raw) : []);
      syncAllGeofencesToTracking();
    } catch {}
  }

  // Reads base + home geo profile arrays from AsyncStorage → drawn as geofence circles on map.
  // Falls back to legacy single-item keys for migration.
  // Also re-syncs geofences so the background task immediately sees updated base/home boundaries.
  async function loadBaseLocation() {
    try {
      const [baseRaw, homeRaw, baseLegacy, homeLegacy] = await Promise.all([
        AsyncStorage.getItem('base_locations_data'),
        AsyncStorage.getItem('home_locations_data'),
        AsyncStorage.getItem('base_location_data'),
        AsyncStorage.getItem('home_location_data'),
      ]);
      setBaseLocations(baseRaw ? JSON.parse(baseRaw) : baseLegacy ? [JSON.parse(baseLegacy)] : []);
      setHomeLocations(homeRaw ? JSON.parse(homeRaw) : homeLegacy ? [JSON.parse(homeLegacy)] : []);
      syncAllGeofencesToTracking();
    } catch {}
  }
  // Opens the drop-pin overlay; map snaps to current GPS position.
  // Small delay before animateCamera lets the mapPadding change propagate to the
  // native layer first, so onRegionChange fires the correct crosshair-aligned coords.
  function handleMarkLocation() {
    const snap = liveLocRef.current;
    setMarkMode(true);
    if (snap) setMarkCenter(snap);
    markCardAnim.setValue(0);
    markPinDropAnim.setValue(-80);
    Animated.spring(markCardAnim, { toValue: 1, bounciness: 6, speed: 14, useNativeDriver: true }).start();
    setTimeout(() => {
      if (snap) {
        mapRef.current?.animateCamera({ center: snap, zoom: 16, pitch: 0, heading: 0 }, { duration: 300 });
      }
      Animated.spring(markPinDropAnim, { toValue: 0, bounciness: 14, speed: 10, useNativeDriver: true }).start();
    }, 80);
  }

  function closeMarkMode() {
    Animated.timing(markCardAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setMarkMode(false);
    });
  }

  // Navigates to RegisterLocationScreen with the confirmed pin coordinates
  function handleConfirmPin() {
    if (!markCenter) return;
    setMarkMode(false);
    markCardAnim.setValue(0);
    navigation.navigate('RegisterLocation', {
      latitude:  markCenter.latitude,
      longitude: markCenter.longitude,
    });
  }

  // For employees: prompts to sync before logging out.
  // Auto-logout timer calls logout() in AuthContext directly — this prompt is manual-only.
  async function handleLogout() {
    if (user?.role === 'employee') {
      Alert.alert(
        'Sync before logging out?',
        "Would you like to sync today's work to the cloud before you go?",
        [
          { text: 'Sync Now',      onPress: () => navigation.navigate('Sync', { date: todayDate }) },
          { text: 'Logout Anyway', style: 'destructive',
            onPress: async () => { clearIdleTimers(); await stopTracking(); await drainCacheToSQLite(); await logout(); } },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    clearIdleTimers(); await stopTracking(); await drainCacheToSQLite(); await logout();
  }

  // Navigation handoff to native Maps app — no backend involved


  // Annotation colours flip to white in satellite mode so pins/circles stay visible
  const isSat       = mapType === 'satellite';
  const annStroke   = isSat ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.50)';
  const annFill     = isSat ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const pinBg       = isSat ? WHITE : BLACK;
  const pinIcon     = isSat ? BLACK : WHITE;
  const savedBorder = isSat ? WHITE : BLACK;

  // UI chrome theme — dark in normal mode, light in satellite mode
  const uiBg      = isSat ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.85)';
  const uiBorder  = isSat ? GRAY3                    : 'rgba(255,255,255,0.12)';
  const uiDivider = isSat ? GRAY3                    : 'rgba(255,255,255,0.12)';
  const uiText    = isSat ? BLACK                    : WHITE;
  const uiTextSub = isSat ? GRAY                     : 'rgba(255,255,255,0.80)';
  const uiTextDim = isSat ? GRAY2                    : 'rgba(255,255,255,0.60)';
  const uiCard    = isSat ? CARD                     : 'rgba(255,255,255,0.1)';

  // Week box colours — differentiated per state in dark mode
  const boxBgFuture  = isSat ? CARD  : 'rgba(255,255,255,0.10)';
  const boxBgPast    = isSat ? GRAY3 : 'rgba(255,255,255,0.05)';
  const boxBgToday   = isSat ? GRAY3 : 'rgba(255,255,255,0.22)';
  const boxBorder    = isSat ? GRAY3 : 'rgba(255,255,255,0.14)';
  const boxTxtFuture = isSat ? GRAY2         : 'rgba(255,255,255,0.40)';
  const boxTxtPast   = isSat ? '#AEAEB2'     : 'rgba(255,255,255,0.22)';
  const boxTxtToday  = isSat ? GRAY          : WHITE;
  const uiIcon    = isSat ? BLACK                    : WHITE;
  // Orbit button active state is always the inverse of the current UI base
  // Nav pill: active capsule inverts against the pill background
  const navCapsuleBg    = isSat ? BLACK                    : WHITE;
  const navCapsuleText  = isSat ? WHITE                    : BLACK;
  const navInactiveIcon = isSat ? 'rgba(0,0,0,0.45)'      : 'rgba(255,255,255,0.65)';

  return (
    <View style={styles.container}>

      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region || { latitude: 19.076, longitude: 72.877, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        mapType={mapType}
        pitchEnabled={!markMode}
        rotateEnabled={!markMode}
        scrollEnabled
        zoomEnabled
        showsUserLocation={false}
        showsMyLocationButton={false}
        mapPadding={markMode
          ? { top: 0, bottom: 220, left: 0, right: 0 }
          : { top: 185, right: 0, bottom: 160, left: 0 }
        }
        onRegionChange={r => {
          if (markMode) setMarkCenter({ latitude: r.latitude, longitude: r.longitude });
        }}
        onRegionChangeComplete={r => {
          if (markMode) setMarkCenter({ latitude: r.latitude, longitude: r.longitude });
        }}
      >
        {/* Geo profiles — rendered first so live location marker always appears on top */}
        {baseLocations.flatMap((loc, i) => [
          <Circle key={`base-circle-${i}`}
            center={{ latitude: loc.latitude, longitude: loc.longitude }}
            radius={loc.radius ?? 100}
            strokeColor={annStroke} fillColor={annFill} strokeWidth={1.5}
          />,
          <Marker key={`base-marker-${i}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}
          >
            <View style={[styles.baseLocationPin, { backgroundColor: pinBg, borderColor: isSat ? BLACK : WHITE }]}>
              <MaterialIcons name="star" size={14} color={pinIcon} />
            </View>
          </Marker>,
        ])}
        {homeLocations.flatMap((loc, i) => [
          <Circle key={`home-circle-${i}`}
            center={{ latitude: loc.latitude, longitude: loc.longitude }}
            radius={loc.radius ?? 100}
            strokeColor={annStroke} fillColor={annFill} strokeWidth={1.5}
          />,
          <Marker key={`home-marker-${i}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}
          >
            <View style={[styles.baseLocationPin, { backgroundColor: pinBg, borderColor: isSat ? BLACK : WHITE }]}>
              <MaterialIcons name="home" size={14} color={pinIcon} />
            </View>
          </Marker>,
        ])}

        {savedLocations.flatMap((loc) => [
          <Circle key={`saved-circle-${loc.id}`}
            center={{ latitude: loc.latitude, longitude: loc.longitude }}
            radius={loc.radius ?? 100}
            strokeColor={annStroke} fillColor={annFill} strokeWidth={1.5}
          />,
          <Marker
            key={`saved-${loc.id}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={loc.name}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.savedPin, { borderColor: savedBorder }]}>
              <MaterialIcons name={CATEGORY_ICON[loc.category] || 'place'} size={14} color={BLACK} />
            </View>
          </Marker>,
        ])}

        {/* Live location rendered last so it always appears on top */}
        {liveCoord && <LiveLocationMarker coordinate={liveCoord} />}

      </MapView>

      {/* ── Merged top card — Nav tabs + Login widget — hidden in mark mode ── */}
      {!markMode && (
        <Animated.View style={[styles.topCard, { backgroundColor: uiBg, opacity: navAnim }]}>

          {/* Row 1: 4 navigation tabs */}
          <NavPill
            embedded
            activeTab="home"
            navigation={navigation}
            pendingCount={pendingCount}
            activeBg={navCapsuleBg}
            activeColor={navCapsuleText}
            inactiveColor={navInactiveIcon}
          />

          <View style={[styles.topCardDivider, { backgroundColor: uiDivider }]} />

          {/* Row 2: Login time + week status */}
          <View style={styles.loginWidgetRow}>

            {/* Left: login time — tap to show on-time status popup */}
            <TouchableOpacity onPress={toggleLoginStatus} activeOpacity={0.75}>
              <Text style={[styles.loginWidgetLabel, { color: uiTextDim }]}>LOGIN TIME</Text>
              <Text style={[styles.loginWidgetTime, { color: uiText }]}>{formattedLoginTime}</Text>
            </TouchableOpacity>

            <View style={[styles.loginWidgetDivider, { backgroundColor: uiDivider }]} />

            {/* Right: date+week label · 7 status boxes — tap opens day log */}
            <TouchableOpacity style={styles.weekCluster} onPress={() => navigation.navigate('DayLog')} activeOpacity={0.75}>
          <View style={styles.weekDateStack}>
            <Text style={[styles.weekDateText, { color: uiText }]}>{dateLabel}</Text>
            <Text style={[styles.weekNumText, { color: uiTextSub }]}>{`W${currentWeek}`}</Text>
          </View>
          <View style={styles.weekBoxes}>
              {weekSegments.flatMap((seg) => {
                if (!seg.isCurrent) {
                  const n = seg.indices.length;
                  const pillWidth = n * 22 + (n - 1) * 3;
                  return [(
                    <View key={seg.monthName} style={[styles.nextMonthPill, { width: pillWidth, backgroundColor: uiCard }]}>
                      <Text style={[styles.nextMonthLabel, { color: uiTextSub }]}>{seg.monthName}</Text>
                    </View>
                  )];
                }
                return seg.indices.map(i => {
                  const date     = weekDates[i];
                  const sessions = weekLoginMap[date] || [];
                  const first    = sessions[0];
                  const isToday  = date === todayDate;
                  const isPast   = date < todayDate;

                  let bgColor     = boxBgFuture;
                  let textColor   = boxTxtFuture;
                  let borderColor = boxBorder;
                  let hasBorder   = true;

                  if (first) {
                    const d = new Date(first.login_time.includes('T') ? first.login_time : first.login_time.replace(' ', 'T') + 'Z');
                    const loginMins    = d.getHours() * 60 + d.getMinutes();
                    const [dh, dm]     = loginDeadline.split(':').map(Number);
                    const deadlineMins = dh * 60 + dm;
                    if (loginMins <= deadlineMins) {
                      bgColor = '#34C759'; textColor = WHITE; hasBorder = false;
                    } else {
                      bgColor = '#FFCC00'; textColor = BLACK; hasBorder = false;
                    }
                  } else if (isPast) {
                    bgColor = boxBgPast; textColor = boxTxtPast;
                  } else if (isToday) {
                    bgColor = boxBgToday; textColor = boxTxtToday; borderColor = uiText;
                  }

                  return (
                    <View
                      key={date}
                      style={[
                        styles.weekBox,
                        { backgroundColor: bgColor },
                        hasBorder && { borderWidth: 1, borderColor },
                        isToday && { borderWidth: 2, borderColor: uiText },
                      ]}
                    >
                      <Text style={[styles.weekBoxLabel, { color: textColor }]}>{WEEK_LABELS[i]}</Text>
                    </View>
                  );
                });
              })}
            </View>
          </TouchableOpacity>

          {/* Arrow button — opens day log */}
          <TouchableOpacity
            style={[styles.loginWidgetArrow, { backgroundColor: uiCard }]}
            onPress={() => navigation.navigate('DayLog')}
            activeOpacity={0.75}
          >
            <MaterialIcons name="chevron-right" size={20} color={uiText} />
          </TouchableOpacity>

          </View>{/* end loginWidgetRow */}
        </Animated.View>
      )}{/* end topCard */}

      {/* ── Login status popup — appears below left portion of ribbon on tap ── */}
      {showLoginStatus && loginStatusLabel && (
        <Animated.View style={[styles.loginStatusPopup, {
          opacity: loginStatusAnim,
          transform: [{ translateY: loginStatusAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        }]}>
          <View style={[styles.loginStatusDot, { backgroundColor: loginStatusColor }]} />
          <Text style={[styles.loginStatusText, { color: BLACK }]}>{loginStatusLabel}</Text>
          <Text style={[styles.loginStatusSub, { color: GRAY }]}>· Deadline {loginDeadline}</Text>
        </Animated.View>
      )}

      {/* ── Merged bottom card — Explore / You're at / Actions ── */}
      {!markMode && (
        <Animated.View style={[styles.bottomCard, { opacity: navAnim }]} pointerEvents="box-none">

          {/* Row 1: Explore locations */}
          <TouchableOpacity style={styles.exploreRow} onPress={() => navigation.navigate('ExploreLocations')} activeOpacity={0.75}>
            <View style={styles.exploreRowLeft}>
              <MaterialIcons name="explore" size={17} color={WHITE} />
              <Text style={styles.exploreRowText}>Explore locations</Text>
            </View>
            <MaterialIcons name="arrow-forward" size={13} color={WHITE} />
          </TouchableOpacity>

          {/* Row 2: You're at / status — only when GPS is live */}
          {liveCoord && (
            <>
              <View style={styles.cardDivider} />
              {currentPlace ? (
                <View style={styles.atRow}>
                  <View style={styles.atIconWrap}>
                    <MaterialIcons name={currentPlace.icon} size={18} color={WHITE} />
                  </View>
                  <View style={styles.atBody}>
                    <Text style={styles.atEyebrow}>YOU'RE AT</Text>
                    <Text style={styles.atName} numberOfLines={1}>{currentPlace.name}</Text>
                    <View style={styles.atMeta}>
                      <Text style={styles.atCategory}>{currentPlace.label.toUpperCase()}</Text>
                      <Animated.View style={[styles.atLiveDot, { opacity: liveDotBlink }]} />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.atRow}>
                  {isMoving ? (
                    <Animated.View style={[styles.atIconWrap, { opacity: movingFade }]}>
                      <MaterialIcons name="navigation" size={18} color={WHITE} />
                    </Animated.View>
                  ) : (
                    <View style={styles.atIconWrap}>
                      <MaterialIcons name="location-on" size={18} color={WHITE} />
                    </View>
                  )}
                  <View style={styles.atBody}>
                    <Text style={styles.atEyebrow}>STATUS</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={styles.atName}>You're</Text>
                      <GlowSweepText label={isMoving ? 'moving' : 'away'} />
                    </View>
                    <Text style={styles.atCategory}>{isMoving ? 'IN TRANSIT' : 'AWAY'}</Text>
                  </View>
                </View>
              )}
            </>
          )}

          {/* Row 3: Action buttons */}
          <View style={styles.cardDivider} />
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Schedule')} activeOpacity={0.75}>
              <MaterialIcons name="calendar-today" size={19} color={WHITE} />
              <Text style={styles.actionBtnText}>Today's Schedule</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionBtn} onPress={handleMarkLocation} activeOpacity={0.75}>
              <MaterialIcons name="add-location-alt" size={19} color={WHITE} />
              <Text style={styles.actionBtnText}>Mark This Location</Text>
            </TouchableOpacity>
          </View>

        </Animated.View>
      )}

      {/* ── Map controls — hidden while mark mode is active ── */}
      {!markMode && (
        <Animated.View style={[styles.mapControls, { opacity: navAnim }]}>
          <ScalePress style={styles.mapControlBtn} onPress={recenterMap}>
            <MaterialIcons name="my-location" size={22} color={BLACK} />
          </ScalePress>
          <ScalePress
            style={[styles.mapControlBtn, mapType === 'satellite' && styles.mapControlBtnActive]}
            onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}
          >
            <MaterialIcons name={mapType === 'satellite' ? 'map' : 'layers'} size={22} color={mapType === 'satellite' ? WHITE : BLACK} />
          </ScalePress>
          <ScalePress style={styles.mapControlBtn} onPress={reacquireLocation}>
            {reacquiring
              ? <ActivityIndicator size="small" color={BLACK} />
              : <MaterialIcons name="refresh" size={22} color={BLACK} />
            }
          </ScalePress>
        </Animated.View>
      )}


      {/* ── Mark mode — Step 1: Drop Pin ── */}

      {/* Crosshair pin — centred in the map area above the bottom card, springs down on open */}
      {markMode && (
        <View pointerEvents="none" style={styles.markCrosshairWrap}>
          <View style={{ alignItems: 'center', transform: [{ translateY: -32 }] }}>
            <Animated.View style={{ transform: [{ translateY: markPinDropAnim }], alignItems: 'center' }}>
              <View style={styles.markCrosshairPin}>
                <MaterialIcons name="add-location-alt" size={18} color={WHITE} />
              </View>
              <View style={styles.markCrosshairStem} />
            </Animated.View>
            <View style={styles.markCrosshairDot} />
          </View>
        </View>
      )}

      {/* Step-1 bottom card — live GPS coords + Confirm button */}
      {markMode && (
        <Animated.View style={[styles.markStep1Card, {
          opacity: markCardAnim,
          transform: [{ translateY: markCardAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
        }]}>
          <View style={styles.markStep1Top}>
            <View style={styles.markStep1IconWrap}>
              <MaterialIcons name="add-location-alt" size={20} color={WHITE} />
            </View>
            <View style={styles.markStep1TextWrap}>
              <Text style={styles.markStep1Title}>Drop Pin</Text>
              <Text style={styles.markStep1Hint}>Move the map to position your pin</Text>
            </View>
            <TouchableOpacity onPress={closeMarkMode} activeOpacity={0.7} style={styles.markStep1CloseBtn}>
              <MaterialIcons name="close" size={18} color={GRAY} />
            </TouchableOpacity>
          </View>

          <View style={styles.markStep1CoordsRow}>
            <MaterialIcons name="gps-fixed" size={13} color={GRAY} />
            <Text style={styles.markStep1Coords} numberOfLines={1}>
              {markCenter
                ? `${markCenter.latitude.toFixed(6)},  ${markCenter.longitude.toFixed(6)}`
                : 'Locating…'}
            </Text>
          </View>

          <TouchableOpacity style={styles.markStep1Btn} onPress={handleConfirmPin} activeOpacity={0.85}>
            <Text style={styles.markStep1BtnText}>Confirm Location</Text>
            <MaterialIcons name="arrow-forward" size={18} color={WHITE} />
          </TouchableOpacity>
        </Animated.View>
      )}


      {/* ── Location acquiring overlay — shown until first GPS fix ── */}
      {locationStatus !== null && <LocationAcquiringOverlay status={locationStatus} />}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },


  // ── Merged top card — Nav tabs + Login widget ─────────────────────────────
  topCard: {
    position: 'absolute', top: 56, left: 16, right: 16, zIndex: 10,
    borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 12, elevation: 8,
  },
  topCardDivider: { height: 1 },
  loginWidgetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    height: 60, paddingHorizontal: 16,
  },
  // ── Merged bottom card ────────────────────────────────────────────────────────
  bottomCard: {
    position: 'absolute', bottom: 36, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.92)', borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30, shadowRadius: 16, elevation: 10,
    overflow: 'hidden',
  },
  exploreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  exploreRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exploreRowText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  cardDivider:    { height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  atRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  atIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center',
  },
  atBody:     { flex: 1, gap: 2 },
  atEyebrow:  { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  atName:     { color: WHITE, fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  atMeta:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atCategory: { color: 'rgba(255,255,255,0.50)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  atLiveDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
  actionsRow: { flexDirection: 'row', alignItems: 'center' },

  loginWidgetLabel:   { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  loginWidgetTime:    { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginTop: 1 },
  loginWidgetDivider: { width: 1, height: 34 },
  loginWidgetArrow: {
    marginLeft: 'auto',
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
  },

  loginStatusPopup: {
    position: 'absolute', top: 184, left: 16, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: WHITE, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  loginStatusDot:  { width: 9, height: 9, borderRadius: 5 },
  loginStatusText: { fontSize: 14, fontWeight: '800' },
  loginStatusSub:  { fontSize: 12, color: GRAY },

  weekCluster:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  weekDateStack:  { gap: 2 },
  weekDateText:   { fontSize: 12, fontWeight: '700', letterSpacing: -0.2 },
  weekNumText:    { fontSize: 10, fontWeight: '600' },
  weekBoxes:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, justifyContent: 'flex-end' },
  nextMonthPill: {
    height: 24, borderRadius: 5,
    justifyContent: 'center', alignItems: 'center',
  },
  nextMonthLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  weekBox: {
    width: 20, height: 22, borderRadius: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  weekBoxToday: { borderWidth: 2 },
  weekBoxLabel: { fontSize: 9, fontWeight: '800' },

  // Floating map control buttons — right side, above the merged bottom card
  mapControls: {
    position: 'absolute', right: 16, bottom: 210,
    gap: 10,
  },
  mapControlBtn: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1, borderColor: GRAY3,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10, shadowRadius: 10, elevation: 6,
  },
  mapControlBtnActive: { backgroundColor: BLACK, borderColor: BLACK },

  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16,
  },
  actionBtnText: { color: WHITE, fontSize: 13, fontWeight: '700' },
  actionDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.12)' },

  baseLocationPin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: WHITE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  liveDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#34C759',
    borderWidth: 2.5, borderColor: WHITE,
    shadowColor: '#34C759', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 6, elevation: 6,
  },
  savedPin: {
    backgroundColor: WHITE, borderRadius: 20, width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: BLACK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  savedPinIcon: { fontSize: 15 },

  // ── Mark Location overlay ────────────────────────────────────────────────────

  // Crosshair pin — centred in the map area above the bottom card (bottom: 220 mirrors mapPadding)
  markCrosshairWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 220,
    justifyContent: 'center', alignItems: 'center',
    zIndex: 5, pointerEvents: 'none',
  },
  markCrosshairPin: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BLACK,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: WHITE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },
  markCrosshairStem: { width: 2, height: 14, backgroundColor: BLACK },
  markCrosshairDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: BLACK },

  // Close button inside the step-1 card — top right
  markStep1CloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: CARD, justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },

  // Step-1 bottom card
  markStep1Card: {
    position: 'absolute', bottom: 36, left: 16, right: 16, zIndex: 20,
    backgroundColor: WHITE, borderRadius: 24,
    padding: 20, gap: 14,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 24, elevation: 14,
  },
  markStep1Top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  markStep1IconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
  },
  markStep1TextWrap: { flex: 1, gap: 2 },
  markStep1Title: { color: BLACK, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  markStep1Hint:  { color: GRAY, fontSize: 13, fontWeight: '500' },
  markStep1CoordsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  markStep1Coords: { color: GRAY, fontSize: 12, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', flex: 1 },
  markStep1Btn: {
    backgroundColor: BLACK, borderRadius: 16,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  markStep1BtnText: { color: WHITE, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
});
