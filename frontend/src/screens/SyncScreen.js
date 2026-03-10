// SyncScreen.js — Daily summary and manual sync trigger
// Shows Travel Log, Stops, and Client Visits for a given date.
// Employee taps "Sync with VISPL" to upload that day's local data to the server.
//
// Data flows:
//   localDatabase.js → getTodayPath / getStopsByDate / getVisitsByDate → section renders
//   "Sync" tap → getUnsynced* → api.syncBulk* → mark*Synced → upsertSyncLog
//   "View History" → navigation.navigate('Calendar')
//   route.params?.date → loads that date; defaults to today

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Animated, Dimensions,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {
  getTodayPath, getStopsByDate, getVisitsByDate,
  getUnsyncedLocations, getUnsyncedStops, getUnsyncedVisits,
  markLocationsSynced, markStopsSynced, markVisitsSynced,
  upsertSyncLog, respondToStop,
} from '../services/localDatabase';
import StopResponseModal from '../components/StopResponseModal';

const { width } = Dimensions.get('window');

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';
const GREEN = '#34C759';
const RED   = '#FF3B30';

const MUTE_STORAGE_KEY = 'muted_locations';

const CATEGORY_ICONS = {
  office: '🏢', client: '👥', site: '🏗', warehouse: '📦',
  home: '🏠', food: '🍴', other: '📍',
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3, r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDistance(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += getDistance(path[i - 1].latitude, path[i - 1].longitude, path[i].latitude, path[i].longitude);
  }
  return (total / 1000).toFixed(1);
}

function parseTS(ts) {
  if (!ts) return null;
  return new Date(ts.includes('T') || ts.includes('Z') ? ts : ts.replace(' ', 'T') + 'Z');
}

function formatTime(ts) {
  const d = parseTS(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ScalePress({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      disabled={disabled}
      onPressIn={() => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 60 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 60 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

function SyncSection({ label, status, progress, unsyncedCount, children }) {
  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.sectionMeta}>
          {unsyncedCount > 0 && status === 'idle' && (
            <View style={styles.unsyncedBadge}>
              <Text style={styles.unsyncedBadgeText}>{unsyncedCount} unsynced</Text>
            </View>
          )}
          {status === 'done'  && <MaterialIcons name="check-circle" size={20} color={GREEN} />}
          {status === 'error' && <MaterialIcons name="error"        size={20} color={RED}   />}
        </View>
      </View>
      {(status === 'syncing' || status === 'done') && (
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: barWidth }]} />
        </View>
      )}
      {children}
    </View>
  );
}

// ── SyncScreen ─────────────────────────────────────────────────────────────────
export default function SyncScreen({ navigation, route }) {
  const date = route.params?.date || new Date().toISOString().slice(0, 10);

  const [locations,        setLocations]        = useState([]);
  const [stops,            setStops]            = useState([]);
  const [visits,           setVisits]           = useState([]);
  const [unsyncedLocs,     setUnsyncedLocs]     = useState(0);
  const [unsyncedStops,    setUnsyncedStops]    = useState(0);
  const [unsyncedVisits,   setUnsyncedVisits]   = useState(0);
  const [syncing,          setSyncing]          = useState(false);
  const [locStatus,        setLocStatus]        = useState('idle');
  const [stopStatus,       setStopStatus]       = useState('idle');
  const [visStatus,        setVisStatus]        = useState('idle');
  const [selectedActivity, setSelectedActivity] = useState(null);

  const locProgress  = useRef(new Animated.Value(0)).current;
  const stopProgress = useRef(new Animated.Value(0)).current;
  const visProgress  = useRef(new Animated.Value(0)).current;
  const navAnim      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    loadData();
  }, [date]);

  async function loadData() {
    try {
      const [locs, stps, vsts] = await Promise.all([
        getTodayPath(date),
        getStopsByDate(date),
        getVisitsByDate(date),
      ]);
      const [uLocs, uStops, uVists] = await Promise.all([
        getUnsyncedLocations(date),
        getUnsyncedStops(date),
        getUnsyncedVisits(date),
      ]);
      setLocations(locs);
      setStops(stps);
      setVisits(vsts);
      setUnsyncedLocs(uLocs.length);
      setUnsyncedStops(uStops.length);
      setUnsyncedVisits(uVists.length);
    } catch {}
  }

  function animateProgress(animVal, statusSetter) {
    statusSetter('syncing');
    return new Promise((resolve) => {
      Animated.timing(animVal, { toValue: 1, duration: 900, useNativeDriver: false }).start(resolve);
    });
  }

  async function handleSync() {
    setSyncing(true);
    let allOk = true;

    // Step 1: locations
    try {
      const uLocs = await getUnsyncedLocations(date);
      await animateProgress(locProgress, setLocStatus);
      if (uLocs.length > 0) {
        await api.syncBulkLocations(date, uLocs);
        await markLocationsSynced(date);
      }
      setLocStatus('done');
      setUnsyncedLocs(0);
    } catch { allOk = false; setLocStatus('error'); }

    // Step 2: stops
    try {
      const uStops = await getUnsyncedStops(date);
      await animateProgress(stopProgress, setStopStatus);
      if (uStops.length > 0) {
        await api.syncBulkStops(date, uStops);
        await markStopsSynced(date);
      }
      setStopStatus('done');
      setUnsyncedStops(0);
    } catch { allOk = false; setStopStatus('error'); }

    // Step 3: client visits
    try {
      const uVisits = await getUnsyncedVisits(date);
      await animateProgress(visProgress, setVisStatus);
      if (uVisits.length > 0) {
        await api.syncBulkVisits(date, uVisits);
        await markVisitsSynced(date);
      }
      setVisStatus('done');
      setUnsyncedVisits(0);
    } catch { allOk = false; setVisStatus('error'); }

    await upsertSyncLog(date, {
      status:          allOk ? 'synced' : 'partial',
      synced_at:       new Date().toISOString(),
      locations_total: locations.length,
      stops_total:     stops.length,
      visits_total:    visits.length,
    });

    setSyncing(false);
    if (!allOk) Alert.alert('Partial Sync', 'Some data failed to sync. Tap Sync again to retry.');
  }

  async function handleRespond(response) {
    if (!selectedActivity) return;
    await respondToStop(selectedActivity.id, response);
    setSelectedActivity(null);
    await loadData();
  }

  async function handleMute(hours) {
    if (!selectedActivity) return;
    try {
      const raw   = await AsyncStorage.getItem(MUTE_STORAGE_KEY);
      const muted = raw ? JSON.parse(raw) : [];
      muted.push({ lat: selectedActivity.latitude, lng: selectedActivity.longitude, expiresAt: Date.now() + hours * 3600000 });
      await AsyncStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(muted));
      await respondToStop(selectedActivity.id, `Muted for ${hours} hour${hours !== 1 ? 's' : ''} at this location`);
      setSelectedActivity(null);
      await loadData();
      Alert.alert('Muted', `Won't ask again here for ${hours}h.`);
    } catch {}
  }

  const visitedStopIds     = new Set(visits.map((v) => v.stop_id));
  const unaccountedStops   = stops.filter((s) => !visitedStopIds.has(s.id));
  const accountedCount     = stops.length - unaccountedStops.length;
  const displayDate        = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const hasSomethingToSync = unsyncedLocs > 0 || unsyncedStops > 0 || unsyncedVisits > 0;

  return (
    <View style={styles.container}>

      {/* ── Nav pill ── */}
      <Animated.View style={[styles.navPill, { opacity: navAnim }]}>
        <View style={styles.navLeft}>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={styles.navItem}>
            <Text style={styles.navInactive}>Home</Text>
          </TouchableOpacity>
          <View style={styles.navDivider} />
          <TouchableOpacity onPress={() => navigation.navigate('Archive')} style={styles.navItem}>
            <Text style={styles.navInactive}>Archive</Text>
          </TouchableOpacity>
          <View style={styles.navDivider} />
          <View style={styles.navItem}>
            <Text style={styles.navActive}>Sync</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Calendar')}>
          <Text style={styles.navHistory}>History</Text>
        </TouchableOpacity>
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.dateHeader}>{displayDate}</Text>

        {/* ── Travel Log ── */}
        <SyncSection label="Travel Log" status={locStatus} progress={locProgress} unsyncedCount={unsyncedLocs}>
          <View style={styles.travelRow}>
            <View style={styles.travelStat}>
              <Text style={styles.travelNum}>{locations.length}</Text>
              <Text style={styles.travelLabel}>GPS points</Text>
            </View>
            <View style={styles.travelDivider} />
            <View style={styles.travelStat}>
              <Text style={styles.travelNum}>{estimateDistance(locations)} km</Text>
              <Text style={styles.travelLabel}>Est. distance</Text>
            </View>
          </View>
        </SyncSection>

        {/* ── Stops ── */}
        <SyncSection label="Stops" status={stopStatus} progress={stopProgress} unsyncedCount={unsyncedStops}>
          <Text style={styles.stopsSub}>{accountedCount} / {stops.length} accounted for</Text>
          {stops.map((stop) => {
            const isPending = stop.status === 'pending';
            return (
              <TouchableOpacity
                key={stop.id}
                style={styles.stopRow}
                onPress={() => isPending && setSelectedActivity(stop)}
                activeOpacity={isPending ? 0.7 : 1}
              >
                <View style={styles.stopRowLeft}>
                  <Text style={styles.stopTime}>{formatTime(stop.triggered_at)}</Text>
                  {stop.dwell_duration > 0 && <Text style={styles.stopDwell}>{stop.dwell_duration} min</Text>}
                </View>
                <View style={styles.stopRowRight}>
                  {visitedStopIds.has(stop.id) && (
                    <Text style={styles.stopCategory}>
                      {CATEGORY_ICONS[visits.find((v) => v.stop_id === stop.id)?.saved_location_cat] || '📍'}
                      {' '}{visits.find((v) => v.stop_id === stop.id)?.saved_location_name}
                    </Text>
                  )}
                  {isPending
                    ? <View style={styles.pendingDot} />
                    : <MaterialIcons name="check-circle" size={16} color={GREEN} />
                  }
                </View>
              </TouchableOpacity>
            );
          })}
          {stops.length === 0 && <Text style={styles.emptyNote}>No stops recorded</Text>}
        </SyncSection>

        {/* ── Client Visits ── */}
        <SyncSection label="Client Visits" status={visStatus} progress={visProgress} unsyncedCount={unsyncedVisits}>
          {visits.map((v) => (
            <View key={v.id} style={styles.visitRow}>
              <Text style={styles.visitIcon}>{CATEGORY_ICONS[v.saved_location_cat] || '📍'}</Text>
              <View style={styles.visitInfo}>
                <Text style={styles.visitName}>{v.saved_location_name}</Text>
                <Text style={styles.visitDwell}>{v.dwell_duration} min · {formatTime(v.arrived_at)}</Text>
              </View>
            </View>
          ))}
          {unaccountedStops.length > 0 && (
            <>
              <Text style={styles.unaccountedLabel}>Unaccounted Stops</Text>
              {unaccountedStops.map((s) => (
                <View key={s.id} style={styles.unaccountedRow}>
                  <Text style={styles.unaccountedTime}>{formatTime(s.triggered_at)}</Text>
                  <Text style={styles.unaccountedDwell}>{s.dwell_duration} min</Text>
                </View>
              ))}
            </>
          )}
          {visits.length === 0 && unaccountedStops.length === 0 && (
            <Text style={styles.emptyNote}>No client visits detected</Text>
          )}
        </SyncSection>

        {/* ── Sync button ── */}
        <ScalePress
          style={[styles.syncBtn, (!hasSomethingToSync || syncing) && styles.syncBtnDim]}
          onPress={handleSync}
          disabled={!hasSomethingToSync || syncing}
        >
          <MaterialIcons name="cloud-upload" size={20} color={WHITE} />
          <Text style={styles.syncBtnText}>
            {syncing ? 'Syncing…' : hasSomethingToSync ? 'Sync with VISPL' : 'All Synced'}
          </Text>
        </ScalePress>
      </ScrollView>

      {/* ── Stop response modal ── */}
      <StopResponseModal
        activity={selectedActivity}
        onSubmit={handleRespond}
        onMute={handleMute}
        onClose={() => setSelectedActivity(null)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  navPill: {
    position: 'absolute', top: 56, left: 16, right: 16, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 32, paddingVertical: 11, paddingHorizontal: 16,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
  },
  navLeft:    { flexDirection: 'row', alignItems: 'center' },
  navItem:    { paddingHorizontal: 10 },
  navActive:  { color: BLACK, fontSize: 15, fontWeight: '800' },
  navInactive:{ color: GRAY,  fontSize: 15, fontWeight: '600' },
  navDivider: { width: 1, height: 14, backgroundColor: GRAY3 },
  navHistory: { color: GRAY, fontSize: 13, fontWeight: '600', paddingHorizontal: 4 },

  scroll:        { flex: 1 },
  scrollContent: { paddingTop: 128, paddingHorizontal: 20, paddingBottom: 48 },

  dateHeader: { color: BLACK, fontSize: 24, fontWeight: '900', marginBottom: 20 },

  section: {
    backgroundColor: WHITE, borderRadius: 18, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel:     { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionMeta:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unsyncedBadge: {
    backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
  },
  unsyncedBadgeText: { color: RED, fontSize: 11, fontWeight: '800' },

  progressTrack: { height: 4, backgroundColor: CARD, borderRadius: 2, marginBottom: 14, overflow: 'hidden' },
  progressFill:  { height: 4, backgroundColor: BLACK, borderRadius: 2 },

  travelRow:    { flexDirection: 'row', alignItems: 'center' },
  travelStat:   { flex: 1, alignItems: 'center' },
  travelNum:    { color: BLACK, fontSize: 26, fontWeight: '900' },
  travelLabel:  { color: GRAY, fontSize: 12, marginTop: 2 },
  travelDivider:{ width: 1, height: 40, backgroundColor: GRAY3 },

  stopsSub: { color: GRAY, fontSize: 13, fontWeight: '600', marginBottom: 10 },
  stopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 4,
    borderTopWidth: 1, borderColor: GRAY3,
  },
  stopRowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopTime:     { color: BLACK, fontSize: 14, fontWeight: '700' },
  stopDwell:    { color: GRAY, fontSize: 12 },
  stopCategory: { color: GRAY, fontSize: 13 },
  pendingDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },

  visitRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: GRAY3 },
  visitIcon:  { fontSize: 22 },
  visitInfo:  { flex: 1 },
  visitName:  { color: BLACK, fontSize: 15, fontWeight: '700' },
  visitDwell: { color: GRAY, fontSize: 12, marginTop: 2 },

  unaccountedLabel: { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  unaccountedRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: GRAY3 },
  unaccountedTime:  { color: BLACK, fontSize: 14, fontWeight: '700' },
  unaccountedDwell: { color: GRAY, fontSize: 12 },

  emptyNote: { color: GRAY2, fontSize: 13, textAlign: 'center', paddingVertical: 8 },

  syncBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: BLACK, borderRadius: 18, paddingVertical: 18, marginTop: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 5,
  },
  syncBtnDim:  { opacity: 0.4 },
  syncBtnText: { color: WHITE, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
});
