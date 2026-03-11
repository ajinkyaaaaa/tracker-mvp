// MapScreen.js — Primary employee tracking screen
// Shows a full-screen live map with today's GPS trail, saved location pins,
// idle-stop detection, and a bottom panel for marking locations.
// Also renders a login-time widget (below nav pill) with an "i" button
// that opens LoginCalendarModal showing past login/logout history.
//
// Data flows (offline-first):
//   locationService.js  → caches GPS points in AsyncStorage
//   drainCacheToSQLite()→ every 60 s moves cache → localDatabase.js → local_locations
//   localDatabase.js    → getTodayPath()          → Polyline on map
//   GET /api/saved-locations → loadSavedLocations() → emoji markers + idle suppression
//   idle detection → autoArchiveIdleEvent() → insertStop() / insertClientVisit() → local DB only
//   loginTime (AuthContext) → insertLoginSession() → local_login_sessions on mount
//   openInMaps()   → Linking.openURL (native Maps hand-off, no backend)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  TextInput, Alert, Platform, AppState, ScrollView,
  Animated, Dimensions, Linking,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Notifications from 'expo-notifications';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {
  startTracking, stopTracking, getCurrentLocation,
  getCachedLocations, clearCachedLocations,
} from '../services/locationService';
import {
  insertLocation, getTodayPath,
  insertStop, insertClientVisit, getStopsByDate,
  insertLoginSession, getLoginSessionsByDateRange,
} from '../services/localDatabase';
import LoginCalendarModal from '../components/LoginCalendarModal';

const { width } = Dimensions.get('window');

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

const CATEGORIES = [
  { key: 'office',    label: 'Office',    icon: '\u{1F3E2}' },
  { key: 'client',    label: 'Client',    icon: '\u{1F465}' },
  { key: 'site',      label: 'Site',      icon: '\u{1F3D7}' },
  { key: 'warehouse', label: 'Warehouse', icon: '\u{1F4E6}' },
  { key: 'home',      label: 'Home',      icon: '\u{1F3E0}' },
  { key: 'food',      label: 'Food',      icon: '\u{1F374}' },
  { key: 'other',     label: 'Other',     icon: '\u{1F4CD}' },
];
const CATEGORY_ICONS = CATEGORIES.reduce((acc, c) => ({ ...acc, [c.key]: c.icon }), {});

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
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges>
      <View style={{ width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}>
        <Animated.View style={ringStyle(ring1)} />
        <Animated.View style={ringStyle(ring2)} />
        <View style={styles.liveDot} />
      </View>
    </Marker>
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
  const [markModalVisible, setMarkModalVisible] = useState(false);
  const [markName,         setMarkName]         = useState('');
  const [markCategory,     setMarkCategory]     = useState('office');
  const [savedLocations,   setSavedLocations]   = useState([]);
  const [baseLocation,     setBaseLocation]     = useState(null);  // { name, icon, latitude, longitude, radius }
  const [homeLocation,     setHomeLocation]     = useState(null);  // { name, icon, latitude, longitude, radius }
  const [pendingCount,     setPendingCount]     = useState(0);
  const [showLoginCal,     setShowLoginCal]     = useState(false);
  const [weekLoginMap,     setWeekLoginMap]     = useState({});
  const [loginDeadline,    setLoginDeadline]    = useState(LOGIN_DEADLINE_DEFAULT); // "HH:MM"

  const mapRef   = useRef(null);
  const appState = useRef(AppState.currentState);

  const idleTimerRef         = useRef(null);
  const graceTimerRef        = useRef(null);
  const idleStartTimeRef     = useRef(null);
  const idleAnchorRef        = useRef(null);
  const notificationFiredRef = useRef(false);
  const cooldownZonesRef     = useRef([]);

  const navAnim = useRef(new Animated.Value(0)).current;

  // Orbit camera — refs so the interval closure always reads the latest values
  const orbitRef      = useRef(null);   // setInterval handle
  const headingRef    = useRef(0);      // current camera heading (0–360°)
  const liveLocRef    = useRef(null);   // latest GPS position, synced from path state
  const [orbitActive,    setOrbitActive]    = useState(false);
  const [locationStatus, setLocationStatus] = useState('acquiring'); // 'acquiring' | 'acquired' | null
  const hasAcquiredRef    = useRef(false);
  const acquireTimeoutRef = useRef(null);

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

  // Name of the location the user is currently inside, or null if not at any
  const liveCoord = path.length > 0 ? path[path.length - 1] : null;
  const currentPlaceName = (() => {
    if (!liveCoord) return null;
    if (baseLocation && getDistance(liveCoord.latitude, liveCoord.longitude,
        baseLocation.latitude, baseLocation.longitude) <= (baseLocation.radius ?? 100))
      return baseLocation.name || 'Base Location';
    if (homeLocation && getDistance(liveCoord.latitude, liveCoord.longitude,
        homeLocation.latitude, homeLocation.longitude) <= (homeLocation.radius ?? 100))
      return homeLocation.name || 'Home';
    const nearby = savedLocations.find(
      l => getDistance(liveCoord.latitude, liveCoord.longitude, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS
    );
    return nearby ? nearby.name : null;
  })();

  // Cycles 1→2→3→1 every 500 ms for the "You're moving..." dot animation
  const [dotCount, setDotCount] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDotCount(d => d >= 3 ? 1 : d + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  // Auto-hide overlay after 12 s if GPS never arrives
  useEffect(() => {
    acquireTimeoutRef.current = setTimeout(() => {
      if (!hasAcquiredRef.current) setLocationStatus(null);
    }, 12000);
    return () => clearTimeout(acquireTimeoutRef.current);
  }, []);

  // Transition to 'acquired' on first GPS point, then recenter and fade out
  useEffect(() => {
    if (path.length > 0 && !hasAcquiredRef.current) {
      hasAcquiredRef.current = true;
      clearTimeout(acquireTimeoutRef.current);
      setLocationStatus('acquired');
      const coord = path[path.length - 1];
      setTimeout(() => {
        mapRef.current?.animateCamera(
          { center: coord, pitch: 0, heading: 0, zoom: 15, altitude: 3200 },
          { duration: 700 },
        );
        setTimeout(() => setLocationStatus(null), 800);
      }, 1400);
    }
  }, [path]);

  useEffect(() => {
    setupNotifications();
    initTracking();
    loadSavedLocations();
    loadBaseLocation();
    loadPendingCount();
    loadWeekLogins();
    loadLoginDeadline();
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
    }, [])
  );

  // Keep liveLocRef current so the orbit interval closure always has the latest position
  useEffect(() => {
    if (path.length > 0) liveLocRef.current = path[path.length - 1];
  }, [path]);

  // ── Orbit camera ──────────────────────────────────────────────────────────
  // Camera orbits the live location: altitude 3200 m, 800 m horizontal offset → pitch ≈ 14°.
  // Heading is derived from wall-clock time so interval drift never compounds.
  // 100 ms interval + 150 ms animation duration keeps motion smooth with no jump.
  const ORBIT_PERIOD_MS = 30000; // one full orbit in 30 s

  function startOrbit() {
    if (!liveLocRef.current) {
      Alert.alert('No location', 'Live location not available yet. Try again in a moment.');
      return;
    }
    const startTime = Date.now() - (headingRef.current / 360) * ORBIT_PERIOD_MS;
    orbitRef.current = setInterval(() => {
      if (!mapRef.current || !liveLocRef.current) return;
      const heading = ((Date.now() - startTime) % ORBIT_PERIOD_MS) / ORBIT_PERIOD_MS * 360;
      headingRef.current = heading;
      mapRef.current.animateCamera(
        { center: liveLocRef.current, heading, pitch: 14, altitude: 3200 },
        { duration: 150 },
      );
    }, 100);
  }

  function stopOrbit() {
    clearInterval(orbitRef.current);
    orbitRef.current = null;
    // Smoothly return to flat top-down view
    mapRef.current?.animateCamera({ pitch: 0, heading: 0, altitude: 3200 }, { duration: 700 });
  }

  function toggleOrbit() {
    if (orbitActive) {
      stopOrbit();
      setOrbitActive(false);
    } else {
      startOrbit();
      setOrbitActive(true);
    }
  }

  // Clean up orbit interval on unmount
  useEffect(() => () => { clearInterval(orbitRef.current); }, []);

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
  // Replaces the old syncLocations() which posted directly to /api/locations/sync.
  async function drainCacheToSQLite() {
    try {
      const cached = await getCachedLocations();
      if (cached.length === 0) return;
      for (const point of cached) {
        await insertLocation({
          latitude:    point.latitude,
          longitude:   point.longitude,
          recorded_at: point.recorded_at,
          date:        point.recorded_at.slice(0, 10),
        });
      }
      await clearCachedLocations();
      await loadTodayPathOnly();
    } catch {}
  }

  // ── Idle detection ────────────────────────────────────────────────────────
  function resetIdleSession(lat, lng) {
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
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "You've been here for a while",
        body: `Please state your activity. (${dwellMins} min${dwellMins !== 1 ? 's' : ''})`,
        data: { type: 'idle-check', lat: latitude, lng: longitude, dwellMins },
      },
      trigger: null,
    });
    graceTimerRef.current = setTimeout(() => {
      autoArchiveIdleEvent(latitude, longitude, dwellMins + 10);
      addCooldownZone(latitude, longitude, 2 * 60 * 60 * 1000);
    }, GRACE_PERIOD_MS);
  }
  function isLunchBreak() { const h = new Date().getHours(); return h >= LUNCH_START && h < LUNCH_END; }
  function isNearSavedLocation(lat, lng) {
    return savedLocations.some((l) => getDistance(lat, lng, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS);
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

  // Saves idle stop to local SQLite (no server call).
  // If the stop is near a saved location, also creates a local_client_visits row.
  async function autoArchiveIdleEvent(lat, lng, dwellMins) {
    try {
      const arrivedAt = new Date(idleStartTimeRef.current).toISOString();
      const stopId    = await insertStop({
        latitude:      lat,
        longitude:     lng,
        arrived_at:    arrivedAt,
        triggered_at:  new Date().toISOString(),
        dwell_duration: dwellMins,
        date:          todayDate,
      });
      const match = savedLocations.find(
        (l) => getDistance(lat, lng, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS
      );
      if (match) {
        await insertClientVisit({
          stop_id:            stopId,
          saved_location_name: match.name,
          saved_location_cat:  match.category,
          latitude:            lat,
          longitude:           lng,
          arrived_at:          arrivedAt,
          dwell_duration:      dwellMins,
          date:                todayDate,
        });
      }
      await loadPendingCount();
    } catch {}
  }

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3, r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
    const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Map actions ───────────────────────────────────────────────────────────
  async function recenterMap() {
    const target = liveLocRef.current ?? await getCurrentLocation().then(l => l?.coords ?? null).catch(() => null);
    if (!target || !mapRef.current) return;
    mapRef.current.animateCamera(
      { center: target, pitch: 0, heading: 0, zoom: 14, altitude: 3200 },
      { duration: 600 },
    );
  }

  // Saved pins still come from the server → idle suppression list + map markers
  async function loadSavedLocations() {
    try { const d = await api.getSavedLocations(); setSavedLocations(d); } catch {}
  }

  // Reads base + home geo profiles from AsyncStorage → drawn as geofence circles on map
  async function loadBaseLocation() {
    try {
      const [baseRaw, homeRaw] = await Promise.all([
        AsyncStorage.getItem('base_location_data'),
        AsyncStorage.getItem('home_location_data'),
      ]);
      setBaseLocation(baseRaw ? JSON.parse(baseRaw) : null);
      setHomeLocation(homeRaw ? JSON.parse(homeRaw) : null);
    } catch {}
  }
  function handleMarkLocation() {
    setMarkModalVisible(true);
    getCurrentLocation().then((loc) => {
      if (loc) setRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    }).catch(() => {});
  }
  function closeMarkModal() {
    setMarkModalVisible(false);
    setMarkName('');
    setMarkCategory('office');
  }
  async function submitMarkLocation() {
    if (!markName.trim()) { Alert.alert('Required', 'Please enter a location name'); return; }
    try {
      const loc = await getCurrentLocation();
      if (!loc) { Alert.alert('Error', 'Could not get current location'); return; }
      await api.saveLocation({ name: markName.trim(), category: markCategory, latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      closeMarkModal();
      await loadSavedLocations();
    } catch (err) { Alert.alert('Error', err.message); }
  }
  async function handleLogout() {
    clearIdleTimers(); await stopTracking(); await drainCacheToSQLite(); await logout();
  }

  // Navigation handoff to native Maps app — no backend involved
  async function openInMaps() {
    try {
      const loc = await getCurrentLocation();
      if (!loc) { Alert.alert('Error', 'Could not get current location'); return; }
      const { latitude, longitude } = loc.coords;
      const url = Platform.OS === 'ios'
        ? `maps://?q=My+Location&ll=${latitude},${longitude}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`https://maps.google.com/maps?q=${latitude},${longitude}`);
      }
    } catch (err) { Alert.alert('Error', err.message); }
  }


  // Annotation colours flip to white in satellite mode so pins/circles stay visible
  const isSat       = mapType === 'satellite';
  const annStroke   = isSat ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.50)';
  const annFill     = isSat ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const pinBg       = isSat ? WHITE : BLACK;
  const pinIcon     = isSat ? BLACK : WHITE;
  const savedBorder = isSat ? WHITE : BLACK;

  // UI chrome theme — dark in normal mode, light in satellite mode
  const uiBg      = isSat ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.92)';
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
  const orbitActiveBg   = isSat ? BLACK : WHITE;
  const orbitActiveIcon = isSat ? WHITE : BLACK;

  return (
    <View style={styles.container}>

      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region || { latitude: 19.076, longitude: 72.877, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        mapType={mapType}
        pitchEnabled
        rotateEnabled
        showsUserLocation={false}
        showsMyLocationButton={false}
        mapPadding={{ top: 195, right: 0, bottom: 0, left: 0 }}
      >
        {/* Geo profiles — rendered first so live location marker always appears on top */}
        {baseLocation && (
          <>
            <Circle
              center={{ latitude: baseLocation.latitude, longitude: baseLocation.longitude }}
              radius={baseLocation.radius ?? 100}
              strokeColor={annStroke}
              fillColor={annFill}
              strokeWidth={1.5}
            />
            <Marker
              coordinate={{ latitude: baseLocation.latitude, longitude: baseLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
            >
              <View style={[styles.baseLocationPin, { backgroundColor: pinBg, borderColor: isSat ? BLACK : WHITE }]}>
                <MaterialIcons name="star" size={14} color={pinIcon} />
              </View>
            </Marker>
          </>
        )}
        {homeLocation && (
          <>
            <Circle
              center={{ latitude: homeLocation.latitude, longitude: homeLocation.longitude }}
              radius={homeLocation.radius ?? 100}
              strokeColor={annStroke}
              fillColor={annFill}
              strokeWidth={1.5}
            />
            <Marker
              coordinate={{ latitude: homeLocation.latitude, longitude: homeLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
            >
              <View style={[styles.baseLocationPin, { backgroundColor: pinBg, borderColor: isSat ? BLACK : WHITE }]}>
                <MaterialIcons name="home" size={14} color={pinIcon} />
              </View>
            </Marker>
          </>
        )}

        {savedLocations.map((loc) => (
          <Marker
            key={`saved-${loc.id}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={loc.name}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.savedPin, { borderColor: savedBorder }]}>
              <Text style={styles.savedPinIcon}>{CATEGORY_ICONS[loc.category] || '\u{1F4CD}'}</Text>
            </View>
          </Marker>
        ))}

        {/* Live location rendered last so it always appears on top */}
        {path.length > 0 && <LiveLocationMarker coordinate={path[path.length - 1]} />}
      </MapView>

      {/* ── Floating nav pill ── */}
      <Animated.View style={[styles.navPill, { opacity: navAnim, backgroundColor: uiBg, borderColor: uiBorder }]}>
        <View style={styles.navLeft}>
          <Text style={[styles.navActive, { color: uiText }]}>Home</Text>
          <View style={[styles.navDivider, { backgroundColor: uiDivider }]} />
          <TouchableOpacity onPress={() => navigation.navigate('Archive')} style={styles.navArchiveBtn}>
            <Text style={[styles.navInactive, { color: uiTextSub }]}>Archive</Text>
            {pendingCount > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{pendingCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={[styles.navDivider, { backgroundColor: uiDivider }]} />
          <TouchableOpacity onPress={() => navigation.navigate('Sync')}>
            <Text style={[styles.navInactive, { color: uiTextSub }]}>Sync</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={[styles.navLogout, { color: uiTextSub }]}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Login time widget — below nav pill ── */}
      <Animated.View style={[styles.loginWidget, { opacity: navAnim, backgroundColor: uiBg, borderColor: uiBorder }]}>

        {/* Left: login time */}
        <View>
          <Text style={[styles.loginWidgetLabel, { color: uiTextDim }]}>LOGIN TIME</Text>
          <Text style={[styles.loginWidgetTime, { color: uiText }]}>{formattedLoginTime}</Text>
        </View>

        <View style={[styles.loginWidgetDivider, { backgroundColor: uiDivider }]} />

        {/* Right: date+week label · 7 status boxes · "i" button — all in one row */}
        <View style={styles.weekCluster}>
          <View style={styles.weekBoxRow}>
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
                        isToday && { borderWidth: 2, borderColor: uiText, transform: [{ scale: 1.12 }] },
                      ]}
                    >
                      <Text style={[styles.weekBoxLabel, { color: textColor }]}>{WEEK_LABELS[i]}</Text>
                    </View>
                  );
                });
              })}
            </View>
            <TouchableOpacity style={[styles.infoBtn, { backgroundColor: uiCard, borderColor: uiBorder }]} onPress={() => setShowLoginCal(true)}>
              <Text style={[styles.infoBtnText, { color: uiTextSub }]}>i</Text>
            </TouchableOpacity>
          </View>
        </View>

      </Animated.View>

      {/* ── Orbit toggle — top-right below login widget ── */}
      <Animated.View style={[styles.orbitBtnWrap, { opacity: navAnim }]}>
        <ScalePress
          style={[styles.orbitBtn, { backgroundColor: orbitActive ? orbitActiveBg : uiBg, borderColor: uiBorder }]}
          onPress={toggleOrbit}
        >
          <MaterialIcons name="360" size={22} color={orbitActive ? orbitActiveIcon : uiIcon} />
        </ScalePress>
      </Animated.View>

      {/* ── Location status banner — always visible once GPS fix acquired ── */}
      {liveCoord && (
        <Animated.View style={[styles.atBaseWidget, { opacity: navAnim }]}>
          <View style={[styles.atBasePill, isSat && styles.atBasePillSat]}>
            <MaterialIcons
              name={currentPlaceName ? 'location-on' : 'near-me'}
              size={13}
              color={isSat ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)'}
            />
            {currentPlaceName ? (
              <Text style={[styles.atBaseText, isSat && styles.atBaseTextSat]} numberOfLines={1}>
                You're at <Text style={[styles.atBaseName, isSat && styles.atBaseNameSat]}>{currentPlaceName}</Text>
              </Text>
            ) : (
              <Text style={[styles.atBaseText, isSat && styles.atBaseTextSat]}>
                You're moving<Text style={[styles.atBaseName, isSat && styles.atBaseNameSat]}>{'.'.repeat(dotCount)}</Text>
              </Text>
            )}
          </View>
        </Animated.View>
      )}

      {/* ── Bottom action ribbon ── */}
      <Animated.View style={[styles.bottomRibbon, { opacity: navAnim, backgroundColor: uiBg, borderColor: uiBorder }]}>

        <View style={styles.ribbonCell}>
          <ScalePress style={styles.ribbonBtn} onPress={recenterMap}>
            <MaterialIcons name="my-location" size={22} color={uiIcon} />
          </ScalePress>
        </View>

        <View style={[styles.ribbonDivider, { backgroundColor: uiDivider }]} />

        <View style={styles.ribbonCell}>
          <ScalePress
            style={styles.ribbonBtn}
            onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}
          >
            {/* Active wrap always BLACK bg — only shown in satellite mode when ribbon is white */}
            <View style={[styles.ribbonIconWrap, mapType === 'satellite' && styles.ribbonIconWrapActive]}>
              <MaterialIcons
                name={mapType === 'satellite' ? 'map' : 'layers'}
                size={22}
                color={mapType === 'satellite' ? WHITE : uiIcon}
              />
            </View>
          </ScalePress>
        </View>

        <View style={[styles.ribbonDivider, { backgroundColor: uiDivider }]} />

        <View style={styles.ribbonCell}>
          <ScalePress style={styles.ribbonBtn} onPress={handleMarkLocation}>
            <MaterialIcons name="add-location-alt" size={22} color={uiIcon} />
          </ScalePress>
        </View>

        <View style={[styles.ribbonDivider, { backgroundColor: uiDivider }]} />

        <View style={styles.ribbonCell}>
          <ScalePress style={styles.ribbonBtn} onPress={openInMaps}>
            <MaterialIcons name="open-in-new" size={20} color={uiIcon} />
          </ScalePress>
        </View>

        <View style={[styles.ribbonDivider, { backgroundColor: uiDivider }]} />

        <View style={styles.ribbonCell}>
          <ScalePress style={styles.ribbonBtn} onPress={() => navigation.navigate('Settings')}>
            <MaterialIcons name="settings" size={22} color={uiIcon} />
          </ScalePress>
        </View>

      </Animated.View>

      {/* ── Login calendar modal ── */}
      <LoginCalendarModal visible={showLoginCal} onClose={() => setShowLoginCal(false)} />

      {/* ── Mark Location Modal ── */}
      <Modal visible={markModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mark Location</Text>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={closeMarkModal}>
                <Ionicons name="close" size={20} color={BLACK} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>Save your current position</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Client Office, Site A"
              placeholderTextColor={GRAY2}
              value={markName}
              onChangeText={setMarkName}
            />

            <Text style={styles.categoryLabel}>CATEGORY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.catChip, markCategory === cat.key && styles.catChipActive]}
                  onPress={() => setMarkCategory(cat.key)}
                >
                  <Text style={styles.catIcon}>{cat.icon}</Text>
                  <Text style={[styles.catText, markCategory === cat.key && styles.catTextActive]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalBtns}>
              <ScalePress style={styles.modalCancel} onPress={closeMarkModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </ScalePress>
              <ScalePress style={styles.modalSave} onPress={submitMarkLocation}>
                <Text style={styles.modalSaveText}>Save</Text>
              </ScalePress>
            </View>

          </View>
        </View>
      </Modal>

      {/* ── Location acquiring overlay — shown until first GPS fix ── */}
      {locationStatus !== null && <LocationAcquiringOverlay status={locationStatus} />}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  navPill: {
    position: 'absolute', top: 56, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 32, paddingVertical: 13, paddingHorizontal: 20,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
  },
  navLeft:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  navActive:     { fontSize: 16, fontWeight: '800' },
  navDivider:    { width: 1, height: 16 },
  navArchiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navInactive:   { fontSize: 16, fontWeight: '600' },
  navBadge: {
    backgroundColor: '#FF3B30', borderRadius: 10,
    minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5,
  },
  navBadgeText: { color: WHITE, fontSize: 11, fontWeight: '800' },
  navLogout:    { fontSize: 13, fontWeight: '600' },

  // Login time widget — slim Apple-style pill below the nav pill
  loginWidget: {
    position: 'absolute', top: 114, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, paddingVertical: 11, paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
  loginWidgetLabel:   { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  loginWidgetTime:    { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginTop: 1 },
  loginWidgetDivider: { width: 1, height: 34 },

  atBaseWidget: {
    position: 'absolute', bottom: 100, left: 0, right: 0,
    alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 6,
    paddingHorizontal: 16,
  },
  atBasePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BLACK,
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 6,
  },
  atBaseText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '500' },
  atBaseName: { color: WHITE, fontWeight: '700' },
  atBasePillSat: { backgroundColor: WHITE },
  atBaseTextSat: { color: 'rgba(0,0,0,0.6)' },
  atBaseNameSat: { color: BLACK },
  weekCluster:    { flex: 1 },
  weekBoxRow:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekDateStack:  { gap: 1 },
  weekDateText:   { fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  weekNumText:    { fontSize: 11, fontWeight: '600' },
  weekBoxes:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  nextMonthPill: {
    height: 24, borderRadius: 5,
    justifyContent: 'center', alignItems: 'center',
  },
  nextMonthLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  weekBox: {
    width: 22, height: 24, borderRadius: 5,
    justifyContent: 'center', alignItems: 'center',
  },
  weekBoxToday: { borderWidth: 2 },
  weekBoxLabel: { fontSize: 9, fontWeight: '800' },
  infoBtn: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  infoBtnText: { fontSize: 12, fontWeight: '700', fontStyle: 'italic' },

  orbitBtnWrap: { position: 'absolute', top: 186, right: 16 },
  orbitBtn: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
  },

  bottomRibbon: {
    position: 'absolute', bottom: 36, left: 40, right: 40,
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 32, paddingVertical: 13,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 24, elevation: 16,
  },
  ribbonCell:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ribbonBtn:            { alignItems: 'center', justifyContent: 'center' },
  ribbonIconWrap:       { width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  ribbonIconWrapActive: { backgroundColor: BLACK },
  ribbonDivider:        { width: 1, height: 22 },

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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 24, paddingBottom: 48,
    borderTopWidth: 1, borderColor: GRAY3,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalCloseBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  modalTitle: { color: BLACK, fontSize: 20, fontWeight: '900' },
  modalSub:   { color: GRAY,  fontSize: 14, marginBottom: 20 },
  modalInput: {
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    color: BLACK, fontSize: 15, borderWidth: 1, borderColor: GRAY3,
  },
  categoryLabel:  { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 18, marginBottom: 12 },
  categoryScroll: { marginBottom: 24 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, marginRight: 8,
    backgroundColor: CARD, borderWidth: 1, borderColor: GRAY3,
  },
  catChipActive:  { backgroundColor: BLACK, borderColor: BLACK },
  catIcon:        { fontSize: 14 },
  catText:        { color: GRAY,  fontSize: 13, fontWeight: '700' },
  catTextActive:  { color: WHITE },
  modalBtns:      { flexDirection: 'row', gap: 12 },
  modalCancel: {
    flex: 1, borderRadius: 14, padding: 16, alignItems: 'center',
    backgroundColor: CARD, borderWidth: 1, borderColor: GRAY3,
  },
  modalCancelText: { color: BLACK, fontSize: 15, fontWeight: '700' },
  modalSave: {
    flex: 1, borderRadius: 14, padding: 16, alignItems: 'center',
    backgroundColor: BLACK,
  },
  modalSaveText: { color: WHITE, fontSize: 15, fontWeight: '900' },
});
