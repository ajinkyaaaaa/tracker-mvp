// SyncScreen.js — Dual-mode sync screen
// Calendar mode (tab, no date param): month overview with synced/pending day cells + bulk sync
// Day mode (route.params.date set): per-day sync with 4 animated progress bars
//
// Data flows (calendar mode):
//   api.getSyncStatus()  → server-confirmed synced dates → filled ● cells
//   getPendingDays()     → local pending dates → hollow ○ cells (tappable → day mode)
//   "Sync All Pending" → for each pending date: syncBulkLocations/Stops/Visits then syncBulkLoginSessions
//   Cell bounce animation → Animated.Value per date, spring to filled state on sync complete
//
// Data flows (day mode):
//   localDatabase.js → getTodayPath / getStopsByDate / getVisitsByDate → section renders
//   "Sync to Cloud" → getUnsynced* → api.syncBulk* → mark*Synced → upsertSyncLog
//   route.params.date → loads that specific date

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Animated, Dimensions, Platform,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {
  getTodayPath, getStopsByDate, getVisitsByDate,
  getUnsyncedLocations, getUnsyncedStops, getUnsyncedVisits,
  getUnsyncedLoginSessions, markLocationsSynced, markStopsSynced,
  markVisitsSynced, markLoginSessionsSynced,
  upsertSyncLog, respondToStop, getLocalDBSizeMB,
  getSyncLog, getPendingDays,
} from '../services/localDatabase';
import StopResponseModal from '../components/StopResponseModal';
import NavPill           from '../components/NavPill';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

const GREEN = '#34C759';
const RED   = '#FF3B30';

const MUTE_STORAGE_KEY = 'muted_locations';
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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

// Formats a YYYY-MM-DD string as the date object at local midnight
function localDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
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
  const styles = makeStyles(useTheme());
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

// PendingDayRow — one row in the pending list, with animated progress bar
// progress: Animated.Value 0→1; filled during sync, full when done
function PendingDayRow({ dateStr, gpsCount, stopsCount, progress, isSynced, onPress }) {
  const { BLACK, CARD, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  const dateLabel = localDate(dateStr).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <TouchableOpacity
      style={{
        backgroundColor: WHITE, borderRadius: 14, padding: 16, marginBottom: 10,
        borderWidth: 1, borderColor: GRAY3,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
      }}
      activeOpacity={isSynced ? 1 : 0.7}
      onPress={!isSynced ? onPress : undefined}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: BLACK, fontSize: 15, fontWeight: '700' }}>{dateLabel}</Text>
        {isSynced
          ? <MaterialIcons name="check-circle" size={18} color={BLACK} />
          : <MaterialIcons name="chevron-right" size={18} color={GRAY2} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MaterialIcons name="route" size={14} color={GRAY} />
          <Text style={{ color: GRAY, fontSize: 12, fontWeight: '600' }}>{gpsCount} pts</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MaterialIcons name="pause-circle-outline" size={14} color={GRAY} />
          <Text style={{ color: GRAY, fontSize: 12, fontWeight: '600' }}>{stopsCount} stops</Text>
        </View>
      </View>
      <View style={{ height: 3, backgroundColor: CARD, borderRadius: 2, overflow: 'hidden' }}>
        <Animated.View style={{ height: 3, backgroundColor: BLACK, borderRadius: 2, width: barWidth }} />
      </View>
    </TouchableOpacity>
  );
}

// ── Calendar Mode ───────────────────────────────────────────────────────────────
// Shown when SyncScreen is opened from the tab bar (no route.params.date)

function CalendarMode({ navigation, navAnim }) {
  const today    = new Date().toISOString().slice(0, 10);
  const cutoff   = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [displayYear,    setDisplayYear]    = useState(new Date().getFullYear());
  const [displayMonth,   setDisplayMonth]   = useState(new Date().getMonth());
  const [syncedSet,      setSyncedSet]      = useState(new Set());
  const [pendingSet,     setPendingSet]     = useState(new Set());
  const [bulkSyncing,    setBulkSyncing]    = useState(false);
  const [syncProgress,   setSyncProgress]   = useState('');
  const [doneCount,      setDoneCount]      = useState(0);
  const [dayDetails,     setDayDetails]     = useState({});    // { dateStr: { gpsCount, stopsCount } }
  const [allPendingRows, setAllPendingRows] = useState([]);    // frozen list of pending dates at load time
  const [dbSizeMB,       setDbSizeMB]       = useState(null);

  const cellAnims = useRef({});
  const rowAnims  = useRef({});   // { dateStr: Animated.Value(0→1) } — drives per-row progress bars

  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const calStyles = makeCalStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const getOrCreateAnim = useCallback((dateStr, initialVal) => {
    if (!cellAnims.current[dateStr]) cellAnims.current[dateStr] = new Animated.Value(initialVal);
    return cellAnims.current[dateStr];
  }, []);

  useEffect(() => { loadCalendarData(); }, []);

  async function loadCalendarData() {
    try {
      const [serverStatus, localLog, localPending, sizeMB] = await Promise.all([
        api.getSyncStatus(),
        getSyncLog(),
        getPendingDays(),
        getLocalDBSizeMB(),
      ]);
      setDbSizeMB(sizeMB);
      const synced  = new Set();
      const pending = new Set();
      serverStatus.forEach(r => synced.add(r.date));
      localLog.filter(r => r.status === 'synced').forEach(r => synced.add(r.date));
      localPending.forEach(d => { if (!synced.has(d)) pending.add(d); });

      setSyncedSet(synced);
      setPendingSet(pending);

      const pendingArr = Array.from(pending).sort().reverse(); // most recent first
      setAllPendingRows(pendingArr);

      // Init cell and row anims
      synced.forEach(d => { cellAnims.current[d] = new Animated.Value(1); });
      pendingArr.forEach(d => {
        if (!cellAnims.current[d]) cellAnims.current[d] = new Animated.Value(0);
        if (!rowAnims.current[d])  rowAnims.current[d]  = new Animated.Value(0);
      });

      // Load GPS/stop counts for pending days (parallel)
      const details = {};
      await Promise.all(pendingArr.map(async (dateStr) => {
        try {
          const [path, stopsData] = await Promise.all([getTodayPath(dateStr), getStopsByDate(dateStr)]);
          details[dateStr] = { gpsCount: path.length, stopsCount: stopsData.length };
        } catch { details[dateStr] = { gpsCount: 0, stopsCount: 0 }; }
      }));
      setDayDetails(details);
    } catch {}
  }

  function prevMonth() {
    if (displayMonth === 0) { setDisplayYear(y => y - 1); setDisplayMonth(11); }
    else setDisplayMonth(m => m - 1);
  }
  function nextMonth() {
    const now = new Date();
    if (displayYear > now.getFullYear() || (displayYear === now.getFullYear() && displayMonth >= now.getMonth())) return;
    if (displayMonth === 11) { setDisplayYear(y => y + 1); setDisplayMonth(0); }
    else setDisplayMonth(m => m + 1);
  }

  function buildGrid(year, month) {
    const firstDay    = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function animateCell(dateStr) {
    const anim = getOrCreateAnim(dateStr, 0);
    Animated.sequence([
      Animated.spring(anim, { toValue: 1.25, useNativeDriver: false, speed: 40, bounciness: 12 }),
      Animated.spring(anim, { toValue: 1,    useNativeDriver: false, speed: 40, bounciness: 6  }),
    ]).start();
  }

  async function syncOneDate(dateStr) {
    try {
      const uLocs   = await getUnsyncedLocations(dateStr);
      const uStops  = await getUnsyncedStops(dateStr);
      const uVisits = await getUnsyncedVisits(dateStr);
      if (uLocs.length)   { await api.syncBulkLocations(dateStr, uLocs);  await markLocationsSynced(dateStr); }
      if (uStops.length)  { await api.syncBulkStops(dateStr, uStops);     await markStopsSynced(dateStr); }
      if (uVisits.length) { await api.syncBulkVisits(dateStr, uVisits);   await markVisitsSynced(dateStr); }
      await upsertSyncLog(dateStr, { status: 'synced', synced_at: new Date().toISOString(), locations_total: uLocs.length, stops_total: uStops.length, visits_total: uVisits.length });
      return true;
    } catch { return false; }
  }

  async function handleSyncAll() {
    const toSync = allPendingRows.filter(d => !syncedSet.has(d)).reverse(); // oldest first for sync order
    if (toSync.length === 0) return;
    setBulkSyncing(true);
    setDoneCount(0);

    try {
      const uLogins = await getUnsyncedLoginSessions();
      if (uLogins.length > 0) {
        await api.syncBulkLoginSessions(uLogins.map(s => ({
          login_time:          s.login_time,
          login_location_name: s.login_location_name ?? null,
          login_location_cat:  s.login_location_cat  ?? null,
          date:                s.date,
        })));
        await markLoginSessionsSynced();
      }
    } catch {}

    let done = 0;
    for (const dateStr of toSync) {
      setSyncProgress(`${done + 1} / ${toSync.length}`);
      if (!rowAnims.current[dateStr]) rowAnims.current[dateStr] = new Animated.Value(0);
      const rowAnim = rowAnims.current[dateStr];

      // Slow-fill bar during actual sync — stops and jumps to 1.0 on completion
      Animated.timing(rowAnim, { toValue: 0.85, duration: 10000, useNativeDriver: false }).start();

      const ok = await syncOneDate(dateStr);

      await new Promise(resolve => {
        rowAnim.stopAnimation(() => {
          Animated.timing(rowAnim, { toValue: 1, duration: 350, useNativeDriver: false }).start(resolve);
        });
      });

      if (ok) {
        animateCell(dateStr);
        setSyncedSet(prev => { const s = new Set(prev); s.add(dateStr); return s; });
        setPendingSet(prev => { const p = new Set(prev); p.delete(dateStr); return p; });
      }
      done++;
      setDoneCount(done);
    }
    setBulkSyncing(false);
    setSyncProgress('');
  }

  const grid        = buildGrid(displayYear, displayMonth);
  const monthLabel  = new Date(displayYear, displayMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const pendingCount = pendingSet.size;

  const isNextDisabled = () => {
    const now = new Date();
    return displayYear > now.getFullYear() ||
      (displayYear === now.getFullYear() && displayMonth >= now.getMonth());
  };

  return (
    <View style={calStyles.container}>
      <NavPill activeTab="sync" navigation={navigation} animValue={navAnim}
        pillBg={useTheme().isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.92)'} />

      {/* ── Compact calendar — top fixed section ── */}
      <View style={calStyles.calSection}>

        {dbSizeMB !== null && (
          <View style={calStyles.storageBar}>
            <MaterialIcons name="storage" size={14} color={GRAY} />
            <Text style={calStyles.storageLabel}>Local storage used</Text>
            <Text style={calStyles.storageValue}>{dbSizeMB < 0.1 ? '< 0.1' : dbSizeMB.toFixed(1)} MB</Text>
          </View>
        )}

        <View style={calStyles.monthNav}>
          <TouchableOpacity onPress={prevMonth} activeOpacity={0.7} style={calStyles.monthArrow}>
            <MaterialIcons name="chevron-left" size={26} color={BLACK} />
          </TouchableOpacity>
          <Text style={calStyles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth} activeOpacity={0.7} style={calStyles.monthArrow} disabled={isNextDisabled()}>
            <MaterialIcons name="chevron-right" size={26} color={isNextDisabled() ? GRAY2 : BLACK} />
          </TouchableOpacity>
        </View>

        <View style={calStyles.dayHeaders}>
          {DAY_LABELS.map(d => <Text key={d} style={calStyles.dayHeader}>{d}</Text>)}
        </View>

        <View style={calStyles.grid}>
          {grid.map((dateStr, idx) => {
            if (!dateStr) return <View key={`e-${idx}`} style={calStyles.cellWrap} />;
            const isSynced  = syncedSet.has(dateStr);
            const isPending = pendingSet.has(dateStr);
            const isFuture  = dateStr > today;
            const isOld     = dateStr < cutoffStr;
            const isToday   = dateStr === today;
            const anim      = getOrCreateAnim(dateStr, isSynced ? 1 : 0);
            const cellScale = anim.interpolate({ inputRange: [0, 1, 1.25], outputRange: [1, 1, 1.18] });
            const fillOp    = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
            const checkOp   = anim.interpolate({ inputRange: [0.6, 1], outputRange: [0, 1], extrapolate: 'clamp' });
            const dayNum    = parseInt(dateStr.split('-')[2], 10);
            return (
              <TouchableOpacity
                key={dateStr}
                style={calStyles.cellWrap}
                activeOpacity={isPending ? 0.65 : 1}
                disabled={!isPending || isFuture || isOld}
                onPress={() => navigation.push('Sync', { date: dateStr })}
              >
                <Animated.View style={[calStyles.cell, { transform: [{ scale: cellScale }] }]}>
                  <Animated.View style={[StyleSheet.absoluteFillObject, calStyles.cellFill, { opacity: fillOp }]} />
                  {isPending && !isSynced && <View style={calStyles.cellRing} />}
                  {isSynced ? (
                    <Animated.Text style={[calStyles.cellNum, calStyles.cellNumSynced, { opacity: checkOp }]}>✓</Animated.Text>
                  ) : (
                    <Text style={[
                      calStyles.cellNum,
                      isPending && calStyles.cellNumPending,
                      (isFuture || isOld) && calStyles.cellNumFuture,
                      isToday && !isSynced && !isPending && calStyles.cellNumToday,
                    ]}>{dayNum}</Text>
                  )}
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </View>

      </View>

      {/* ── Pending days list ── */}
      <View style={calStyles.listHeader}>
        <Text style={calStyles.listTitle}>Pending</Text>
        <View style={calStyles.listBadge}>
          <Text style={calStyles.listBadgeText}>{pendingCount}</Text>
        </View>
      </View>

      <ScrollView style={calStyles.listScroll} contentContainerStyle={calStyles.listContent} showsVerticalScrollIndicator={false}>
        {allPendingRows.length === 0 ? (
          <View style={calStyles.emptyState}>
            <MaterialIcons name="check-circle-outline" size={36} color={GRAY2} />
            <Text style={calStyles.emptyText}>All days synced</Text>
          </View>
        ) : (
          allPendingRows.map(dateStr => {
            const isSynced = syncedSet.has(dateStr);
            const details  = dayDetails[dateStr] || { gpsCount: 0, stopsCount: 0 };
            if (!rowAnims.current[dateStr]) rowAnims.current[dateStr] = new Animated.Value(isSynced ? 1 : 0);
            return (
              <PendingDayRow
                key={dateStr}
                dateStr={dateStr}
                gpsCount={details.gpsCount}
                stopsCount={details.stopsCount}
                progress={rowAnims.current[dateStr]}
                isSynced={isSynced}
                onPress={() => navigation.push('Sync', { date: dateStr })}
              />
            );
          })
        )}
      </ScrollView>

      {/* ── Fixed sync button ── */}
      <View style={calStyles.syncBtnWrap}>
        <ScalePress
          style={[calStyles.syncBtn, (pendingCount === 0 || bulkSyncing) && calStyles.syncBtnDim]}
          onPress={handleSyncAll}
          disabled={pendingCount === 0 || bulkSyncing}
        >
          <MaterialIcons name="cloud-upload" size={20} color={WHITE} />
          <Text style={calStyles.syncBtnText}>
            {bulkSyncing
              ? `Syncing… ${syncProgress}`
              : pendingCount === 0
              ? 'All Synced'
              : `Sync All Pending (${pendingCount})`}
          </Text>
        </ScalePress>
      </View>

    </View>
  );
}
// ── Day Mode ───────────────────────────────────────────────────────────────────
// Shown when navigated with route.params.date from DayLogScreen or CalendarScreen

function DayMode({ navigation, route }) {
  const date = route.params.date;

  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE, isDark } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const [locations,        setLocations]        = useState([]);
  const [stops,            setStops]            = useState([]);
  const [visits,           setVisits]           = useState([]);
  const [unsyncedLocs,     setUnsyncedLocs]     = useState(0);
  const [unsyncedStops,    setUnsyncedStops]    = useState(0);
  const [unsyncedVisits,   setUnsyncedVisits]   = useState(0);
  const [dbSizeMB,         setDbSizeMB]         = useState(null);
  const [syncing,          setSyncing]          = useState(false);
  const [locStatus,        setLocStatus]        = useState('idle');
  const [stopStatus,       setStopStatus]       = useState('idle');
  const [visStatus,        setVisStatus]        = useState('idle');
  const [loginStatus,      setLoginStatus]      = useState('idle');
  const [unsyncedLogins,   setUnsyncedLogins]   = useState(0);
  const [selectedActivity, setSelectedActivity] = useState(null);

  const locProgress   = useRef(new Animated.Value(0)).current;
  const stopProgress  = useRef(new Animated.Value(0)).current;
  const visProgress   = useRef(new Animated.Value(0)).current;
  const loginProgress = useRef(new Animated.Value(0)).current;
  const navAnim       = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    loadData();
  }, [date]);

  async function loadData() {
    try {
      const [locs, stps, vsts, sizeMB] = await Promise.all([
        getTodayPath(date), getStopsByDate(date), getVisitsByDate(date), getLocalDBSizeMB(),
      ]);
      const [uLocs, uStops, uVists, uLogins] = await Promise.all([
        getUnsyncedLocations(date), getUnsyncedStops(date),
        getUnsyncedVisits(date), getUnsyncedLoginSessions(),
      ]);
      setLocations(locs); setStops(stps); setVisits(vsts);
      setUnsyncedLocs(uLocs.length); setUnsyncedStops(uStops.length);
      setUnsyncedVisits(uVists.length); setUnsyncedLogins(uLogins.length);
      setDbSizeMB(sizeMB);
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

    try {
      const uLocs = await getUnsyncedLocations(date);
      await animateProgress(locProgress, setLocStatus);
      if (uLocs.length > 0) { await api.syncBulkLocations(date, uLocs); await markLocationsSynced(date); }
      setLocStatus('done'); setUnsyncedLocs(0);
    } catch { allOk = false; setLocStatus('error'); }

    try {
      const uStops = await getUnsyncedStops(date);
      await animateProgress(stopProgress, setStopStatus);
      if (uStops.length > 0) { await api.syncBulkStops(date, uStops); await markStopsSynced(date); }
      setStopStatus('done'); setUnsyncedStops(0);
    } catch { allOk = false; setStopStatus('error'); }

    try {
      const uVisits = await getUnsyncedVisits(date);
      await animateProgress(visProgress, setVisStatus);
      if (uVisits.length > 0) { await api.syncBulkVisits(date, uVisits); await markVisitsSynced(date); }
      setVisStatus('done'); setUnsyncedVisits(0);
    } catch { allOk = false; setVisStatus('error'); }

    try {
      const uLogins = await getUnsyncedLoginSessions();
      await animateProgress(loginProgress, setLoginStatus);
      if (uLogins.length > 0) {
        await api.syncBulkLoginSessions(uLogins.map(s => ({
          login_time: s.login_time, login_location_name: s.login_location_name ?? null,
          login_location_cat: s.login_location_cat ?? null, date: s.date,
        })));
        await markLoginSessionsSynced();
      }
      setLoginStatus('done'); setUnsyncedLogins(0);
    } catch { allOk = false; setLoginStatus('error'); }

    await upsertSyncLog(date, {
      status: allOk ? 'synced' : 'partial', synced_at: new Date().toISOString(),
      locations_total: locations.length, stops_total: stops.length, visits_total: visits.length,
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

  const visitedStopIds     = new Set(visits.map(v => v.stop_id));
  const unaccountedStops   = stops.filter(s => !visitedStopIds.has(s.id));
  const accountedCount     = stops.length - unaccountedStops.length;
  const displayDate        = localDate(date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const hasSomethingToSync = unsyncedLocs > 0 || unsyncedStops > 0 || unsyncedVisits > 0 || unsyncedLogins > 0;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingTop: 24 }]} showsVerticalScrollIndicator={false}>

        {/* Back header */}
        <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back-ios" size={18} color={BLACK} />
          <Text style={styles.backLabel}>Sync</Text>
        </TouchableOpacity>

        <View style={styles.dateRow}>
          <Text style={styles.dateHeader}>{displayDate}</Text>
        </View>

        {dbSizeMB !== null && (
          <View style={styles.storageBar}>
            <MaterialIcons name="storage" size={14} color={GRAY} />
            <Text style={styles.storageLabel}>Local storage used</Text>
            <Text style={styles.storageValue}>{dbSizeMB < 0.1 ? '< 0.1' : dbSizeMB.toFixed(1)} MB</Text>
          </View>
        )}

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

        <SyncSection label="Stops" status={stopStatus} progress={stopProgress} unsyncedCount={unsyncedStops}>
          <Text style={styles.stopsSub}>{accountedCount} / {stops.length} accounted for</Text>
          {stops.map((stop) => {
            const isPending = stop.status === 'pending';
            return (
              <TouchableOpacity key={stop.id} style={styles.stopRow}
                onPress={() => isPending && setSelectedActivity(stop)} activeOpacity={isPending ? 0.7 : 1}>
                <View style={styles.stopRowLeft}>
                  <Text style={styles.stopTime}>{formatTime(stop.triggered_at)}</Text>
                  {stop.dwell_duration > 0 && <Text style={styles.stopDwell}>{stop.dwell_duration} min</Text>}
                </View>
                <View style={styles.stopRowRight}>
                  {visitedStopIds.has(stop.id) && (
                    <Text style={styles.stopCategory}>
                      {CATEGORY_ICONS[visits.find(v => v.stop_id === stop.id)?.saved_location_cat] || '📍'}
                      {' '}{visits.find(v => v.stop_id === stop.id)?.saved_location_name}
                    </Text>
                  )}
                  {isPending ? <View style={styles.pendingDot} /> : <MaterialIcons name="check-circle" size={16} color={GREEN} />}
                </View>
              </TouchableOpacity>
            );
          })}
          {stops.length === 0 && <Text style={styles.emptyNote}>No stops recorded</Text>}
        </SyncSection>

        <SyncSection label="Client Visits" status={visStatus} progress={visProgress} unsyncedCount={unsyncedVisits}>
          {visits.map(v => (
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
              {unaccountedStops.map(s => (
                <View key={s.id} style={styles.unaccountedRow}>
                  <Text style={styles.unaccountedTime}>{formatTime(s.triggered_at)}</Text>
                  <Text style={styles.unaccountedDwell}>{s.dwell_duration} min</Text>
                </View>
              ))}
            </>
          )}
          {visits.length === 0 && unaccountedStops.length === 0 && <Text style={styles.emptyNote}>No client visits detected</Text>}
        </SyncSection>

        <SyncSection label="Login Sessions" status={loginStatus} progress={loginProgress} unsyncedCount={unsyncedLogins}>
          <Text style={styles.stopsSub}>{unsyncedLogins} session{unsyncedLogins !== 1 ? 's' : ''} pending upload</Text>
        </SyncSection>

        <ScalePress
          style={[styles.syncBtn, (!hasSomethingToSync || syncing) && styles.syncBtnDim]}
          onPress={handleSync}
          disabled={!hasSomethingToSync || syncing}
        >
          <MaterialIcons name="cloud-upload" size={20} color={WHITE} />
          <Text style={styles.syncBtnText}>
            {syncing ? 'Syncing…' : hasSomethingToSync ? 'Sync to Cloud' : 'All Synced'}
          </Text>
        </ScalePress>

      </ScrollView>

      <StopResponseModal
        activity={selectedActivity}
        onSubmit={handleRespond}
        onMute={handleMute}
        onClose={() => setSelectedActivity(null)}
      />
    </View>
  );
}

// ── SyncScreen: routes between calendar and day mode ──────────────────────────
export default function SyncScreen({ navigation, route }) {
  const navAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  if (route.params?.date) {
    return <DayMode navigation={navigation} route={route} />;
  }
  return <CalendarMode navigation={navigation} navAnim={navAnim} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Shared day-mode styles
function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    scroll:        { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 48 },

    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
    backLabel: { color: GRAY, fontSize: 14, fontWeight: '600' },

    dateRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
    dateHeader: { color: BLACK, fontSize: 24, fontWeight: '900' },

    storageBar: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: CARD, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16,
    },
    storageLabel: { color: GRAY, fontSize: 12, fontWeight: '600', flex: 1 },
    storageValue: { color: BLACK, fontSize: 12, fontWeight: '800' },

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
    stopRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderColor: GRAY3 },
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
}

// Calendar-mode styles
function makeCalStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  const compactCellSize = Math.floor((width - 40) / 7 * 0.7);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    // Top fixed calendar section — clears NavPill (absolute top:56, height ~48) with margin
    calSection: {
      paddingTop: 116,
      paddingHorizontal: 20,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: GRAY3,
    },

    storageBar: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: CARD, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 8, marginBottom: 18,
    },
    storageLabel: { color: '#3A3A3C', fontSize: 12, fontWeight: '600', flex: 1 },
    storageValue: { color: BLACK, fontSize: 12, fontWeight: '800' },

    monthNav:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    monthArrow:{ padding: 4 },
    monthLabel:{ color: BLACK, fontSize: 16, fontWeight: '800' },

    dayHeaders:{ flexDirection: 'row', marginBottom: 4 },
    dayHeader: { width: compactCellSize, textAlign: 'center', color: GRAY, fontSize: 10, fontWeight: '700' },

    grid:     { flexDirection: 'row', flexWrap: 'wrap' },
    cellWrap: { width: compactCellSize, height: compactCellSize, padding: 2 },
    cell: {
      flex: 1, borderRadius: compactCellSize / 2,
      justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    },
    cellFill:       { borderRadius: compactCellSize / 2, backgroundColor: BLACK },
    cellRing:       { ...StyleSheet.absoluteFillObject, borderRadius: compactCellSize / 2, borderWidth: 1.5, borderColor: BLACK },
    cellNum:        { fontSize: 11, fontWeight: '600', color: GRAY2 },
    cellNumPending: { color: BLACK, fontWeight: '700' },
    cellNumSynced:  { color: WHITE, fontSize: 12, fontWeight: '800' },
    cellNumFuture:  { color: GRAY3 },
    cellNumToday:   { color: BLACK, fontWeight: '800' },

    // Pending list section
    listHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 20, paddingVertical: 12,
    },
    listTitle:     { color: BLACK, fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
    listBadge: {
      backgroundColor: BLACK, borderRadius: 10,
      minWidth: 20, height: 20, paddingHorizontal: 6,
      justifyContent: 'center', alignItems: 'center',
    },
    listBadgeText: { color: WHITE, fontSize: 11, fontWeight: '800' },

    listScroll:  { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingBottom: 16 },

    emptyState: { alignItems: 'center', paddingVertical: 32, gap: 10 },
    emptyText:  { color: GRAY2, fontSize: 14, fontWeight: '600' },

    // Fixed bottom sync button
    syncBtnWrap: {
      paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8,
      borderTopWidth: 1, borderTopColor: GRAY3,
      backgroundColor: BG,
    },
    syncBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: BLACK, borderRadius: 16, paddingVertical: 16,
    },
    syncBtnDim:  { opacity: 0.4 },
    syncBtnText: { color: WHITE, fontSize: 15, fontWeight: '800' },

    // Day-mode styles (used by SyncSection inside DayMode via makeStyles, keep here for DayMode compat)
    section: {
      backgroundColor: WHITE, borderRadius: 18, padding: 16, marginBottom: 14,
      borderWidth: 1, borderColor: GRAY3,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    },
    sectionHeaderRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    sectionLabel:      { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
    sectionMeta:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
    unsyncedBadge:     { backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)' },
    unsyncedBadgeText: { color: RED, fontSize: 11, fontWeight: '800' },
    progressTrack:     { height: 4, backgroundColor: CARD, borderRadius: 2, marginBottom: 14, overflow: 'hidden' },
    progressFill:      { height: 4, backgroundColor: BLACK, borderRadius: 2 },
  });
}
