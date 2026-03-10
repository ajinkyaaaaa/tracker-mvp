// MapScreen.js — Primary employee tracking screen
// Shows a full-screen live map with today's GPS trail, saved location pins,
// idle-stop detection, and a bottom panel for marking locations.
//
// Data flows:
//   locationService.js → caches GPS points → syncLocations() → POST /api/locations/sync
//   GET /api/locations/today           → loadTodayPathOnly()   → Polyline on map
//   GET /api/saved-locations           → loadSavedLocations()  → emoji markers on map
//   idle detection → autoArchiveIdleEvent() → POST /api/activities → badge on Archive tab
//   openInMaps()   → Linking.openURL (native Maps app hand-off, no backend)

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  TextInput, Alert, Platform, AppState, ScrollView,
  Animated, Dimensions, Linking,
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Notifications from 'expo-notifications';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';       // → AuthContext.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';                   // → api.js
import {
  startTracking, stopTracking, getCurrentLocation,
  getCachedLocations, clearCachedLocations,
} from '../services/locationService';                    // → locationService.js

const { width } = Dimensions.get('window');

// Black & white palette
const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';

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
  const [pendingCount,     setPendingCount]     = useState(0);

  const mapRef   = useRef(null);
  const appState = useRef(AppState.currentState);

  const idleTimerRef         = useRef(null);
  const graceTimerRef        = useRef(null);
  const idleStartTimeRef     = useRef(null);
  const idleAnchorRef        = useRef(null);
  const notificationFiredRef = useRef(false);
  const cooldownZonesRef     = useRef([]);

  const navAnim   = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(60)).current;
  const pulse     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(navAnim,   { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(panelAnim, { toValue: 0, tension: 60, friction: 12, useNativeDriver: true, delay: 200 }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    setupNotifications();   // request notification permission; wire tap → Archive
    initTracking();         // start background GPS, set initial region, load today's path
    loadSavedLocations();   // GET /api/saved-locations → map markers + idle suppression list
    loadPendingCount();     // GET /api/activities/pending/count → Archive badge
    loadMutedLocations();   // read muted zones from AsyncStorage
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => { sub.remove(); clearIdleTimers(); };
  }, []);

  // Flush cached GPS points to the server every 60 s
  // locationService.js writes to cache; this sends it via POST /api/locations/sync
  useEffect(() => {
    const si = setInterval(syncLocations, 60000);
    return () => clearInterval(si);
  }, []);

  // Refresh the map trail and Archive badge every 30 s
  useEffect(() => {
    const ri = setInterval(() => { loadTodayPathOnly(); loadPendingCount(); }, 30000);
    return () => clearInterval(ri);
  }, []);

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
  async function loadPendingCount() {
    try { const d = await api.getPendingCount(); setPendingCount(d.count); } catch {}
  }
  function handleAppStateChange(nextState) {
    if (appState.current.match(/inactive|background/) && nextState === 'active') {
      syncLocations(); loadTodayPathOnly(); loadPendingCount(); loadMutedLocations();
    }
    appState.current = nextState;
  }
  // Starts background GPS (locationService.js → startTracking), centres the map,
  // and kicks off the idle detection timer.
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

  // Fetches today's GPS trail → GET /api/locations/today (routes/locations.py)
  // Result is rendered as a black Polyline on the MapView.
  async function loadTodayPathOnly() {
    try {
      const locs = await api.getTodayPath();
      setPath(locs.map((l) => ({ latitude: l.latitude, longitude: l.longitude })));
    } catch {}
  }

  // Reads the local cache written by locationService.js and POST /api/locations/sync.
  // Clears the cache only after a successful sync to avoid data loss.
  async function syncLocations() {
    try {
      const cached = await getCachedLocations();
      if (cached.length > 0) { await api.syncLocations(cached); await clearCachedLocations(); }
    } catch {}
  }

  // ── Idle detection ────────────────────────────────────────────────────────
  // Logic: if the employee hasn't moved >50 m in IDLE_THRESHOLD_MS (15 min),
  // fire a push notification asking them to log their activity.
  // After GRACE_PERIOD_MS (10 min) with no response, auto-archive via POST /api/activities.
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
  // Creates a 'pending' activity when the grace period expires with no user response.
  // POST /api/activities (routes/activities.py) → visible in ArchiveScreen.js.
  async function autoArchiveIdleEvent(lat, lng, dwellMins) {
    try {
      await api.logActivity({ latitude: lat, longitude: lng, triggered_at: new Date().toISOString(), dwell_duration: dwellMins, status: 'pending' });
      loadPendingCount();
    } catch {}
  }
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3, r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
    const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Map actions ───────────────────────────────────────────────────────────
  // Animates the MapView to the current GPS fix (triggered by "my-location" button)
  async function recenterMap() {
    const loc = await getCurrentLocation();
    if (loc && mapRef.current) {
      mapRef.current.animateToRegion(
        { latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      );
    }
  }
  async function loadSavedLocations() {
    try { const d = await api.getSavedLocations(); setSavedLocations(d); } catch {}
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
    clearIdleTimers(); await stopTracking(); await syncLocations(); await logout();
  }

  // Navigation handoff — no backend involved.
  // Opens Apple Maps (iOS) or Google Maps (Android) at the current location
  // using platform-native deep link URIs for turn-by-turn navigation.
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

  const pulseScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={styles.container}>

      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region || { latitude: 19.076, longitude: 72.877, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        mapType={mapType}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {path.length > 1 && (
          <Polyline coordinates={path} strokeColor={BLACK} strokeWidth={4} lineJoin="round" />
        )}
        {path.length > 0 && (
          <Marker coordinate={path[path.length - 1]} title="Current" />
        )}
        {savedLocations.map((loc) => (
          <Marker
            key={`saved-${loc.id}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={loc.name}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.savedPin}>
              <Text style={styles.savedPinIcon}>{CATEGORY_ICONS[loc.category] || '\u{1F4CD}'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ── Floating nav pill ── */}
      <Animated.View style={[styles.navPill, { opacity: navAnim }]}>
        <View style={styles.navLeft}>
          <Text style={styles.navActive}>Home</Text>
          <View style={styles.navDivider} />
          <TouchableOpacity onPress={() => navigation.navigate('Archive')} style={styles.navArchiveBtn}>
            <Text style={styles.navInactive}>Archive</Text>
            {pendingCount > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{pendingCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.navLogout}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Map controls — Apple Maps / Google Maps style ── */}
      <Animated.View style={[styles.sideControls, { opacity: navAnim }]}>
        {/* Satellite / Standard toggle */}
        <ScalePress
          style={[styles.sideBtn, mapType === 'satellite' && styles.sideBtnActive]}
          onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}
        >
          <MaterialIcons
            name={mapType === 'satellite' ? 'map' : 'layers'}
            size={22}
            color={mapType === 'satellite' ? WHITE : BLACK}
          />
        </ScalePress>

        {/* Recenter / My Location */}
        <ScalePress style={styles.sideBtn} onPress={recenterMap}>
          <MaterialIcons name="my-location" size={22} color={BLACK} />
        </ScalePress>
      </Animated.View>

      {/* ── Bottom panel ── */}
      <Animated.View style={[styles.bottomPanel, { transform: [{ translateY: panelAnim }] }]}>
        <View style={styles.panelHandle} />

        {/* Login time row */}
        <View style={styles.timeRow}>
          <View>
            <Text style={styles.timeLabel}>LOGIN TIME</Text>
            <Text style={styles.timeValue}>{formattedLoginTime}</Text>
            <Text style={styles.timeDate}>{formattedLoginDate}</Text>
          </View>
          <View style={styles.liveBadge}>
            <View style={styles.liveDotWrap}>
              <Animated.View style={[styles.livePulse, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
              <View style={styles.liveDot} />
            </View>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>

        {/* Primary action — Mark location */}
        <ScalePress style={styles.markBtn} onPress={handleMarkLocation}>
          <Ionicons name="location-sharp" size={18} color={WHITE} />
          <Text style={styles.markBtnText}>Mark This Location</Text>
        </ScalePress>

        {/* Secondary action — Open in Maps (navigation handoff) */}
        <ScalePress style={styles.openMapsBtn} onPress={openInMaps}>
          <Ionicons name="navigate-outline" size={16} color={BLACK} />
          <Text style={styles.openMapsBtnText}>Open in Maps</Text>
        </ScalePress>
      </Animated.View>

      {/* ── Mark Location Modal ── */}
      <Modal visible={markModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>

            {/* Header row with title + close button */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Nav pill
  navPill: {
    position: 'absolute', top: 56, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 32, paddingVertical: 13, paddingHorizontal: 20,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
  },
  navLeft:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  navActive:     { color: BLACK, fontSize: 16, fontWeight: '800' },
  navDivider:    { width: 1, height: 16, backgroundColor: GRAY3 },
  navArchiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navInactive:   { color: GRAY, fontSize: 16, fontWeight: '600' },
  navBadge: {
    backgroundColor: '#FF3B30', borderRadius: 10,
    minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5,
  },
  navBadgeText: { color: WHITE, fontSize: 11, fontWeight: '800' },
  navLogout:    { color: GRAY, fontSize: 13, fontWeight: '600' },

  // Side controls — rounded square, white card (Apple Maps / Google Maps style)
  sideControls: {
    position: 'absolute', right: 16, top: '38%',
    gap: 8,
  },
  sideBtn: {
    width: 44, height: 44, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.97)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 6, elevation: 5,
  },
  sideBtnActive: { backgroundColor: BLACK },

  // Bottom panel
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: WHITE,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 14, paddingBottom: 44,
    borderTopWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.07, shadowRadius: 16, elevation: 12,
  },
  panelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: GRAY2, alignSelf: 'center', marginBottom: 22,
  },

  timeRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 },
  timeLabel: { color: GRAY,  fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  timeValue: { color: BLACK, fontSize: 36, fontWeight: '900', letterSpacing: -0.5 },
  timeDate:  { color: GRAY,  fontSize: 13, marginTop: 2 },

  liveBadge:   { alignItems: 'center', gap: 4 },
  liveDotWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  livePulse: {
    position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: '#34C759',
  },
  liveDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: '#34C759' },
  liveText: { color: GRAY, fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  markBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: BLACK, borderRadius: 18, paddingVertical: 16,
    marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 5,
  },
  markBtnText: { color: WHITE, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  openMapsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 18, paddingVertical: 14,
    borderWidth: 1.5, borderColor: BLACK,
  },
  openMapsBtnText: { color: BLACK, fontSize: 15, fontWeight: '700' },

  savedPin: {
    backgroundColor: WHITE, borderRadius: 20, width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: BLACK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  savedPinIcon: { fontSize: 15 },

  // Modal
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
