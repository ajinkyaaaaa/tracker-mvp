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
//   idle detection → onIdleThresholdReached() → insertStop() / insertClientVisit() immediately → local DB only
//   loginTime (AuthContext) → insertLoginSession() → local_login_sessions on mount

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Alert, Platform, AppState, ScrollView,
  Animated, Dimensions, KeyboardAvoidingView,
  ActivityIndicator, Keyboard,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Notifications from 'expo-notifications';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {
  startTracking, stopTracking, getCurrentLocation,
  getCachedLocations, clearCachedLocations,
} from '../services/locationService';
import {
  insertLocation, getTodayPath,
  insertStop, updateStopDwell, insertClientVisit, getStopsByDate,
  insertLoginSession, getLoginSessionsByDateRange,
} from '../services/localDatabase';
import NavPill from '../components/NavPill';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  { key: 'office',    label: 'Office',    icon: 'business' },
  { key: 'client',    label: 'Client',    icon: 'people' },
  { key: 'site',      label: 'Site',      icon: 'terrain' },
  { key: 'warehouse', label: 'Warehouse', icon: 'warehouse' },
  { key: 'home',      label: 'Home',      icon: 'home' },
  { key: 'food',      label: 'Food',      icon: 'restaurant' },
  { key: 'other',     label: 'Other',     icon: 'place' },
];
const CATEGORY_ICON = CATEGORIES.reduce((acc, c) => ({ ...acc, [c.key]: c.icon }), {});

const MARK_RADIUS_PRESETS = [50, 100, 150, 200];

// Nominatim address autocomplete — same provider as BaseLocationPinScreen (no API key)
async function geocodeQuery(query, coord) {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=in`;
  if (coord) {
    const D = 1.0;
    url += `&viewbox=${coord.longitude - D},${coord.latitude - D},${coord.longitude + D},${coord.latitude + D}`;
  }
  const res  = await fetch(url, { headers: { 'User-Agent': 'VISPLTrackerApp/1.0' } });
  const data = await res.json();
  return data.map(r => ({
    id:        r.place_id,
    title:     r.name || r.display_name.split(',')[0].trim(),
    subtitle:  r.display_name,
    latitude:  parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
}

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
  // Mark-location overlay — 2-step: pin placement → radius selection
  const [markMode,        setMarkMode]        = useState(false);
  const [markStep,        setMarkStep]        = useState(1);
  const [markCenter,      setMarkCenter]      = useState(null); // tracks map centre during step 1
  const [markConfirmed,   setMarkConfirmed]   = useState(null); // locked after "Set Pin Here"
  const [markRadius,      setMarkRadius]      = useState(100);
  const [markName,        setMarkName]        = useState('');
  const [markCategory,    setMarkCategory]    = useState('client');
  const [markQuery,       setMarkQuery]       = useState('');
  const [markResults,     setMarkResults]     = useState([]);
  const [markSearching,   setMarkSearching]   = useState(false);
  const [markShowResults, setMarkShowResults] = useState(false);
  const [markSaving,      setMarkSaving]      = useState(false);
  const [savedLocations,   setSavedLocations]   = useState([]);
  const [baseLocation,     setBaseLocation]     = useState(null);  // { name, icon, latitude, longitude, radius }
  const [homeLocation,     setHomeLocation]     = useState(null);  // { name, icon, latitude, longitude, radius }
  const [pendingCount,     setPendingCount]     = useState(0);
  const [weekLoginMap,     setWeekLoginMap]     = useState({});
  const [loginDeadline,    setLoginDeadline]    = useState(LOGIN_DEADLINE_DEFAULT); // "HH:MM"
  const [showLoginStatus,  setShowLoginStatus]  = useState(false);
  const loginStatusAnim    = useRef(new Animated.Value(0)).current;
  const loginStatusTimerRef = useRef(null);

  const mapRef          = useRef(null);
  const appState        = useRef(AppState.currentState);
  const markSearchTimer = useRef(null);
  const markPanelAnim    = useRef(new Animated.Value(SCREEN_HEIGHT)).current; // starts off-screen
  const markPanelOpacity = useRef(new Animated.Value(1)).current;
  const markRibbonAnim   = useRef(new Animated.Value(0)).current;  // 0 = login widget, 1 = search bar
  const markPinDropAnim  = useRef(new Animated.Value(-80)).current; // pin drop: starts above, springs to 0

  const idleTimerRef         = useRef(null);
  const graceTimerRef        = useRef(null);
  const idleStartTimeRef     = useRef(null);
  const idleAnchorRef        = useRef(null);
  const notificationFiredRef = useRef(false);
  const cooldownZonesRef     = useRef([]);

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
    if (baseLocation && getDistance(liveCoord.latitude, liveCoord.longitude,
        baseLocation.latitude, baseLocation.longitude) <= (baseLocation.radius ?? 100))
      return { name: baseLocation.name || 'Base Location', icon: 'star', label: 'Base' };
    if (homeLocation && getDistance(liveCoord.latitude, liveCoord.longitude,
        homeLocation.latitude, homeLocation.longitude) <= (homeLocation.radius ?? 100))
      return { name: homeLocation.name || 'Home', icon: 'home', label: 'Home' };
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

  // Transition to 'acquired' on first GPS point, recenter map, then fade out overlay
  useEffect(() => {
    if (path.length > 0 && !hasAcquiredRef.current) {
      hasAcquiredRef.current = true;
      clearTimeout(acquireTimeoutRef.current);
      const coord = path[path.length - 1];
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

  // Debounced address search during mark mode step 1
  useEffect(() => {
    clearTimeout(markSearchTimer.current);
    if (!markMode || markQuery.length < 3) { setMarkResults([]); setMarkShowResults(false); return; }
    markSearchTimer.current = setTimeout(async () => {
      setMarkSearching(true);
      try {
        const r = await geocodeQuery(markQuery, markCenter);
        setMarkResults(r);
        setMarkShowResults(r.length > 0);
      } catch {}
      finally { setMarkSearching(false); }
    }, 600);
    return () => clearTimeout(markSearchTimer.current);
  }, [markQuery, markMode]);

  // Animations are driven directly inside handleMarkLocation / closeMarkMode — no useEffect needed

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

    // Grace period: update the dwell time to reflect how long they actually stayed
    graceTimerRef.current = setTimeout(async () => {
      if (stopId !== null) {
        try { await updateStopDwell(stopId, dwellMins + Math.round(GRACE_PERIOD_MS / 60000)); } catch {}
      }
      addCooldownZone(latitude, longitude, 2 * 60 * 60 * 1000);
    }, GRACE_PERIOD_MS);
  }
  function isLunchBreak() { const h = new Date().getHours(); return h >= LUNCH_START && h < LUNCH_END; }
  // Returns true if lat/lng falls within any saved pin, base location, or home location.
  // Used by onIdleThresholdReached to suppress stop popups at known locations.
  function isNearSavedLocation(lat, lng) {
    if (savedLocations.some((l) => getDistance(lat, lng, l.latitude, l.longitude) < SAVED_LOCATION_RADIUS)) return true;
    if (baseLocation && getDistance(lat, lng, baseLocation.latitude, baseLocation.longitude) <= (baseLocation.radius ?? SAVED_LOCATION_RADIUS)) return true;
    if (homeLocation && getDistance(lat, lng, homeLocation.latitude, homeLocation.longitude) <= (homeLocation.radius ?? SAVED_LOCATION_RADIUS)) return true;
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


  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3, r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
    const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  async function recenterMap() {
    const target = liveLocRef.current ?? await getCurrentLocation().then(l => l?.coords ?? null).catch(() => null);
    if (!target || !mapRef.current) return;
    mapRef.current.animateCamera(
      { center: target, pitch: 0, heading: 0, zoom: 14, altitude: 3200 },
      { duration: 600 },
    );
  }

  // Re-fetches GPS from device → shows acquiring/acquired overlays → updates liveGpsPoint + liveLocRef + re-centres map
  async function reacquireLocation() {
    if (reacquiring) return;
    setReacquiring(true);
    setLocationStatus('acquiring');
    try {
      const loc = await getCurrentLocation();
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
  // Opens mark-location overlay and centres map on current GPS position
  function handleMarkLocation() {
    const snap = liveLocRef.current;
    setMarkMode(true);
    setMarkStep(1);
    setMarkName('');
    setMarkCategory('client');
    setMarkQuery('');
    setMarkResults([]);
    setMarkShowResults(false);
    setMarkConfirmed(null);
    setMarkRadius(100);
    // Instantly snap map to live location so the crosshair is already on the green dot
    if (snap) {
      setMarkCenter(snap);
      mapRef.current?.animateCamera({ center: snap, zoom: 16, pitch: 0, heading: 0 }, { duration: 0 });
    }
    // Animate ribbon swap + panel slide-in
    markPanelOpacity.setValue(1);
    markPinDropAnim.setValue(-80);
    Animated.parallel([
      Animated.timing(markRibbonAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(markPanelAnim,  { toValue: 0, bounciness: 4, speed: 14, useNativeDriver: true }),
    ]).start();
    // Drop pin onto the live location after map has snapped
    setTimeout(() => {
      Animated.spring(markPinDropAnim, { toValue: 0, bounciness: 14, speed: 10, useNativeDriver: true }).start();
    }, 80);
  }

  function closeMarkMode() {
    Keyboard.dismiss();
    // Fade + slide panel fully off screen, then reset state
    Animated.parallel([
      Animated.timing(markRibbonAnim,    { toValue: 0, duration: 240, useNativeDriver: true }),
      Animated.timing(markPanelOpacity,  { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(markPanelAnim,     { toValue: SCREEN_HEIGHT, duration: 280, useNativeDriver: true }),
    ]).start(() => {
      setMarkMode(false);
      setMarkStep(1);
      setMarkQuery('');
      setMarkResults([]);
      setMarkShowResults(false);
    });
  }

  // Locks the current map centre and advances to radius step
  function handleMarkSetPin() {
    Keyboard.dismiss();
    setMarkConfirmed(markCenter);
    setMarkShowResults(false);
    mapRef.current?.animateToRegion(
      { ...markCenter, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 400,
    );
    setTimeout(() => setMarkStep(2), 420);
  }

  function handleMarkBack() {
    if (markStep === 2) { setMarkStep(1); return; }
    closeMarkMode();
  }

  function selectMarkResult(item) {
    setMarkQuery(item.title);
    setMarkResults([]);
    setMarkShowResults(false);
    Keyboard.dismiss();
    const coord = { latitude: item.latitude, longitude: item.longitude };
    setMarkCenter(coord);
    mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 500);
  }

  async function submitMarkLocation() {
    if (!markName.trim()) { Alert.alert('Required', 'Please enter a location name'); return; }
    setMarkSaving(true);
    try {
      await api.saveLocation({
        name:      markName.trim(),
        category:  markCategory,
        latitude:  markConfirmed.latitude,
        longitude: markConfirmed.longitude,
        radius:    markRadius,
      });
      closeMarkMode();
      await loadSavedLocations();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setMarkSaving(false);
  }
  async function handleLogout() {
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
        showsUserLocation={false}
        showsMyLocationButton={false}
        mapPadding={{ top: 195, right: 0, bottom: 0, left: 0 }}
        onRegionChangeComplete={r => {
          if (markMode && markStep === 1)
            setMarkCenter({ latitude: r.latitude, longitude: r.longitude });
        }}
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
              <MaterialIcons name={CATEGORY_ICON[loc.category] || 'place'} size={14} color={BLACK} />
            </View>
          </Marker>
        ))}

        {/* Live location rendered last so it always appears on top */}
        {liveCoord && <LiveLocationMarker coordinate={liveCoord} />}

        {/* Mark-location geofence preview — step 2 only */}
        {markMode && markStep === 2 && markConfirmed && (
          <Circle
            center={markConfirmed}
            radius={markRadius}
            strokeColor="rgba(0,0,0,0.55)"
            fillColor="rgba(0,0,0,0.07)"
            strokeWidth={1.5}
          />
        )}
      </MapView>

      {/* ── Nav pill — shared NavPill component, adapts to satellite mode ── */}
      <NavPill
        activeTab="home"
        navigation={navigation}
        pendingCount={pendingCount}
        animValue={navAnim}
        pillBg={uiBg}
        activeBg={navCapsuleBg}
        activeColor={navCapsuleText}
        inactiveColor={navInactiveIcon}
      />

      {/* ── Login time widget — cross-fades with search bar when mark mode opens ── */}
      <Animated.View style={[styles.loginWidget, {
        backgroundColor: uiBg, borderColor: uiBorder,
        opacity: Animated.multiply(navAnim, markRibbonAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
        transform: [{ translateY: markRibbonAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }],
      }]}
        pointerEvents={markMode ? 'none' : 'auto'}
      >

        {/* Left: login time — tap to show on-time status popup */}
        <TouchableOpacity onPress={toggleLoginStatus} activeOpacity={0.75}>
          <Text style={[styles.loginWidgetLabel, { color: uiTextDim }]}>LOGIN TIME</Text>
          <Text style={[styles.loginWidgetTime, { color: uiText }]}>{formattedLoginTime}</Text>
        </TouchableOpacity>

        <View style={[styles.loginWidgetDivider, { backgroundColor: uiDivider }]} />

        {/* Right: date+week label · 7 status boxes — tap opens day log */}
        <TouchableOpacity style={styles.weekCluster} onPress={() => navigation.navigate('DayLog')} activeOpacity={0.75}>
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
          </View>
        </TouchableOpacity>

        {/* Arrow button — opens day log */}
        <TouchableOpacity
          style={styles.loginWidgetArrow}
          onPress={() => navigation.navigate('DayLog')}
          activeOpacity={0.75}
        >
          <MaterialIcons name="chevron-right" size={20} color="#000000" />
        </TouchableOpacity>

      </Animated.View>

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

      {/* ── You're at / Moving card — centred above bottom ribbon ── */}
      {liveCoord && !markMode && (
        <Animated.View style={[styles.atCard, { opacity: navAnim }]}>
          {currentPlace ? (
            <View style={styles.atCardRow}>
              <View style={styles.atCardIconWrap}>
                <MaterialIcons name={currentPlace.icon} size={18} color={WHITE} />
              </View>
              <View style={styles.atCardBody}>
                <Text style={styles.atCardEyebrow}>YOU'RE AT</Text>
                <Text style={styles.atCardName} numberOfLines={1}>{currentPlace.name}</Text>
                <View style={styles.atCardMeta}>
                  <Text style={styles.atCardCategory}>{currentPlace.label.toUpperCase()}</Text>
                  <Animated.View style={[styles.atCardLiveDot, { opacity: liveDotBlink }]} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.atCardRow}>
              <Animated.View style={[styles.atCardIconWrap, { opacity: movingFade }]}>
                <MaterialIcons name="navigation" size={18} color={WHITE} />
              </Animated.View>
              <View style={styles.atCardBody}>
                <Text style={styles.atCardEyebrow}>STATUS</Text>
                <Text style={styles.atCardName}>You're moving</Text>
                <Text style={styles.atCardCategory}>IN TRANSIT</Text>
              </View>
            </View>
          )}
        </Animated.View>
      )}

      {/* ── Map controls — recenter + satellite, right side ── */}
      <Animated.View style={[styles.mapControls, { opacity: navAnim }]}>
        <ScalePress
          style={styles.mapControlBtn}
          onPress={recenterMap}
        >
          <MaterialIcons name="my-location" size={22} color={BLACK} />
        </ScalePress>
        <ScalePress
          style={[styles.mapControlBtn, mapType === 'satellite' && styles.mapControlBtnActive]}
          onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}
        >
          <MaterialIcons
            name={mapType === 'satellite' ? 'map' : 'layers'}
            size={22}
            color={mapType === 'satellite' ? WHITE : BLACK}
          />
        </ScalePress>
        <ScalePress style={styles.mapControlBtn} onPress={reacquireLocation}>
          {reacquiring
            ? <ActivityIndicator size="small" color={BLACK} />
            : <MaterialIcons name="refresh" size={22} color={BLACK} />
          }
        </ScalePress>
      </Animated.View>

      {/* ── Bottom action row — Today's Schedule + Mark This Location ── */}
      {!markMode && (
        <Animated.View style={[styles.actionRow, { opacity: navAnim }]}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('Schedule')}
            activeOpacity={0.75}
          >
            <MaterialIcons name="calendar-today" size={19} color={BLACK} />
            <Text style={styles.actionBtnText}>Today's Schedule</Text>
          </TouchableOpacity>
          <View style={styles.actionDivider} />
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleMarkLocation}
            activeOpacity={0.75}
          >
            <MaterialIcons name="add-location-alt" size={19} color={BLACK} />
            <Text style={styles.actionBtnText}>Mark This Location</Text>
          </TouchableOpacity>
        </Animated.View>
      )}


      {/* ── Mark Location — 2-step overlay rendered directly on the home screen ── */}

      {/* Step indicator badge — shown in step 2 (step 1 has the search bar at same position) */}
      {markMode && markStep === 2 && (
        <View style={styles.markStepBadge}>
          <MaterialIcons name="radio-button-checked" size={13} color={WHITE} />
          <Text style={styles.markStepText}>PIN PLACED  ·  SET GEOFENCE RADIUS</Text>
        </View>
      )}

      {/* ── Mark search bar — animates in over the login widget (same position/shape) ── */}
      <Animated.View
        style={[styles.loginWidget, styles.markSearchBar, {
          opacity: markRibbonAnim,
          transform: [{ translateY: markRibbonAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }]}
        pointerEvents={markMode && markStep === 1 ? 'auto' : 'none'}
      >
        <MaterialIcons name="search" size={18} color={GRAY} />
        <TextInput
          style={[styles.markSearchInput, { color: BLACK }]}
          value={markQuery}
          onChangeText={setMarkQuery}
          placeholder="Search address…"
          placeholderTextColor={GRAY2}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
        {markSearching
          ? <ActivityIndicator size="small" color={GRAY} />
          : <TouchableOpacity onPress={closeMarkMode} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={16} color={GRAY} />
            </TouchableOpacity>
        }
      </Animated.View>

      {/* Search results dropdown — floats below the ribbon */}
      {markMode && markStep === 1 && markShowResults && (
        <FlatList
          style={styles.markResultsList}
          data={markResults}
          keyExtractor={r => String(r.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.markResultRow}
              onPress={() => selectMarkResult(item)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="location-on" size={15} color={GRAY} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.markResultTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.markResultSub}   numberOfLines={1}>{item.subtitle}</Text>
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: GRAY3, marginLeft: 36 }} />}
        />
      )}

      {/* Crosshair pin — step 1 only */}
      {markMode && markStep === 1 && (
        <View pointerEvents="none" style={styles.markCrosshairWrap}>
          <Animated.View style={{ transform: [{ translateY: markPinDropAnim }], alignItems: 'center' }}>
            <View style={styles.markCrosshairPin}>
              <MaterialIcons name="add-location-alt" size={18} color={WHITE} />
            </View>
            <View style={styles.markCrosshairStem} />
          </Animated.View>
          <View style={styles.markCrosshairDot} />
        </View>
      )}

      {/* Confirmed pin dot — step 2 */}
      {markMode && markStep === 2 && (
        <View pointerEvents="none" style={styles.markCrosshairWrap}>
          <View style={[styles.markCrosshairPin, { backgroundColor: GRAY }]}>
            <MaterialIcons name="location-pin" size={18} color={WHITE} />
          </View>
          <View style={styles.markCrosshairStem} />
          <View style={styles.markCrosshairDot}  />
        </View>
      )}

      {/* Animated bottom panel */}
      {markMode && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          style={styles.markPanelKAV}
          keyboardVerticalOffset={0}
        >
          <Animated.View style={[styles.markPanel, { opacity: markPanelOpacity, transform: [{ translateY: markPanelAnim }] }]}>

            {/* Panel header row */}
            <View style={styles.markPanelHeader}>
              <TouchableOpacity style={styles.markBackBtn} onPress={handleMarkBack} activeOpacity={0.7}>
                <MaterialIcons name={markStep === 1 ? 'close' : 'arrow-back-ios'} size={18} color={WHITE} />
              </TouchableOpacity>
              <Text style={styles.markPanelTitle}>
                {markStep === 1 ? 'Place Pin' : 'Geofence Radius'}
              </Text>
              <View style={{ width: 36 }} />
            </View>

            {markStep === 1 ? (
              <>
                {/* Name input */}
                <TextInput
                  style={styles.markNameInput}
                  placeholder="Location label"
                  placeholderTextColor={GRAY2}
                  value={markName}
                  onChangeText={setMarkName}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />

                {/* Category grid */}
                <Text style={styles.markSectionLabel}>CATEGORY</Text>
                <View style={styles.markCatGrid}>
                  {CATEGORIES.map((cat) => {
                    const active = markCategory === cat.key;
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        style={[styles.markCatChip, active && styles.markCatChipActive]}
                        onPress={() => setMarkCategory(cat.key)}
                        activeOpacity={0.75}
                      >
                        <MaterialIcons name={cat.icon} size={16} color={active ? BLACK : 'rgba(255,255,255,0.65)'} />
                        <Text style={[styles.markCatLabel, active && styles.markCatLabelActive]}>
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity style={styles.markPrimaryBtn} onPress={handleMarkSetPin} activeOpacity={0.85}>
                  <MaterialIcons name="push-pin" size={17} color={BLACK} />
                  <Text style={styles.markPrimaryBtnText}>Set Pin Here</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Coordinates readout */}
                {markConfirmed && (
                  <View style={styles.markCoordRow}>
                    <MaterialIcons name="location-on" size={14} color="rgba(255,255,255,0.45)" />
                    <Text style={styles.markCoordText}>
                      {markConfirmed.latitude.toFixed(6)},  {markConfirmed.longitude.toFixed(6)}
                    </Text>
                  </View>
                )}

                <Text style={styles.markSectionLabel}>GEOFENCE RADIUS</Text>
                <View style={styles.markRadiusRow}>
                  {MARK_RADIUS_PRESETS.map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.markRadiusChip, markRadius === r && styles.markRadiusChipActive]}
                      onPress={() => setMarkRadius(r)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.markRadiusText, markRadius === r && styles.markRadiusTextActive]}>
                        {r}m
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.markPrimaryBtn, markSaving && { opacity: 0.6 }]}
                  onPress={submitMarkLocation}
                  activeOpacity={0.85}
                  disabled={markSaving}
                >
                  {markSaving
                    ? <ActivityIndicator size="small" color={BLACK} />
                    : <MaterialIcons name="check" size={17} color={BLACK} />
                  }
                  <Text style={styles.markPrimaryBtnText}>
                    {markSaving ? 'Saving…' : 'Save Location'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      )}

      {/* ── Location acquiring overlay — shown until first GPS fix ── */}
      {locationStatus !== null && <LocationAcquiringOverlay status={locationStatus} />}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },


  // Login time widget — slim Apple-style pill, 12 px below NavPill bottom (~104 px)
  loginWidget: {
    position: 'absolute', top: 116, left: 16, right: 16, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, height: 60, paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
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
    position: 'absolute', top: 188, left: 16, zIndex: 20,
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

  // You're at / Moving card — 12 px above the action row (bottom: 36 + ~54 px height + 12 = 102)
  atCard: {
    position: 'absolute', bottom: 102, left: 16, right: 16,
    backgroundColor: BLACK, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 12,
  },
  atCardRow:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  atCardIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  atCardBody:     { flex: 1, gap: 2 },
  atCardEyebrow:  { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  atCardName:     { color: WHITE, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  atCardMeta:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atCardCategory: { color: 'rgba(255,255,255,0.50)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  atCardLiveDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
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

  // Floating map control buttons — right side, 12 px above atCard top edge (~102 + 72 + 12 = 186)
  mapControls: {
    position: 'absolute', right: 16, bottom: 186,
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

  // Bottom action row
  actionRow: {
    position: 'absolute', bottom: 36, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20, borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 8,
    overflow: 'hidden',
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 17,
  },
  actionBtnText: { color: BLACK, fontSize: 13, fontWeight: '700' },
  actionDivider: { width: 1, height: 24, backgroundColor: GRAY3 },

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

  markStepBadge: {
    position: 'absolute', top: 172, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6, zIndex: 20,
  },
  markStepText: { color: WHITE, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },

  // Search bar override — pure white card with bold black stroke so it reads against any map or UI chrome
  markSearchBar: {
    backgroundColor: WHITE,
    borderColor: BLACK, borderWidth: 1.5,
    shadowOpacity: 0.22, shadowRadius: 18, elevation: 10,
  },

  // Search input inside the ribbon (no wrapper needed — sits inside loginWidget container)
  markSearchInput: { flex: 1, fontSize: 15 },
  // Dropdown floats just below the login widget ribbon (top 110 + ~54px ribbon height + 6px gap)
  markResultsList: {
    position: 'absolute', top: 170, left: 16, right: 16, zIndex: 35,
    backgroundColor: WHITE, borderRadius: 14,
    borderWidth: 1, borderColor: GRAY3, maxHeight: 210,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 10,
  },
  markResultRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13 },
  markResultTitle: { color: BLACK, fontSize: 14, fontWeight: '600' },
  markResultSub:   { color: GRAY,  fontSize: 11, marginTop: 1 },

  // Crosshair pin centred on map
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

  // Bottom panel
  markPanelKAV: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 25,
  },
  markPanel: {
    backgroundColor: BLACK,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 16,
    gap: 14,
  },
  markPanelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 4, paddingBottom: 4,
  },
  markBackBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center',
  },
  markPanelTitle: { color: WHITE, fontSize: 16, fontWeight: '800' },

  markNameInput: {
    backgroundColor: WHITE, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    color: BLACK, fontSize: 15,
    borderWidth: 1.5, borderColor: BLACK,
  },

  markSectionLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },

  // Category chips — 4-per-row grid
  markCatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  markCatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  markCatChipActive:  { backgroundColor: WHITE, borderColor: WHITE },
  markCatLabel:       { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '700' },
  markCatLabelActive: { color: BLACK },

  // Coordinate readout
  markCoordRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  markCoordText: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Radius chips
  markRadiusRow: { flexDirection: 'row', gap: 10 },
  markRadiusChip: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
  },
  markRadiusChipActive: { backgroundColor: WHITE, borderColor: WHITE },
  markRadiusText:       { color: 'rgba(255,255,255,0.65)', fontSize: 15, fontWeight: '700' },
  markRadiusTextActive: { color: BLACK },

  markPrimaryBtn: {
    backgroundColor: WHITE, borderRadius: 14,
    paddingVertical: 15, marginTop: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  markPrimaryBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },

  savedPinIcon: { fontSize: 15 },
});
