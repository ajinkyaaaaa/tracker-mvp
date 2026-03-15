// DayLogScreen.js — Daily login + travel log detail view
// Navigated to from MapScreen.js → login widget arrow button (navigate 'DayLog')
//
// Layout: week strip (7 coloured day pills) → tap a day → day-level detail below
//   Sections: Login time + on-time status, Travel stats, Stops, Client Visits, Sync status
//
// Data flows:
//   getLoginSessionsByDateRange()  → week strip colours + login card
//   api.getLoginDeadline()         → on-time/late threshold
//   getTodayPath(date)             → GPS point count + distance
//   getStopsByDate(date)           → stops list
//   getVisitsByDate(date)          → client visits list
//   getSyncLog() + getPendingDays() + api.getSyncStatus() → sync badge

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';
import {
  getLoginSessionsByDateRange,
  getTodayPath,
  getStopsByDate,
  getVisitsByDate,
  getSyncLog,
  getPendingDays,
} from '../services/localDatabase';

const GREEN  = '#34C759';
const YELLOW = '#FFCC00';
const RED    = '#FF3B30';
const LOGIN_DEADLINE_DEFAULT = '09:00';
const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Returns 7 ISO date strings for a given week offset (0 = current, -1 = previous)
function getWeekDates(offset = 0) {
  const today  = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ISO string or SQLite datetime → Date
function parseDate(str) {
  return new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
}

function fmtTime(str) {
  return parseDate(str).toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateFull(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60 > 0 ? ` ${m % 60}m` : ''}`.trim();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function totalDistanceKm(path) {
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    km += haversineKm(path[i-1].latitude, path[i-1].longitude, path[i].latitude, path[i].longitude);
  }
  return km;
}

export default function DayLogScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const todayStr = new Date().toISOString().slice(0, 10);

  const [selectedDate,  setSelectedDate]  = useState(todayStr);
  const [weekOffset,    setWeekOffset]    = useState(0);
  const [weekDates,     setWeekDates]     = useState(() => getWeekDates(0));
  const [weekLoginMap,  setWeekLoginMap]  = useState({});
  const [loginDeadline, setLoginDeadline] = useState(LOGIN_DEADLINE_DEFAULT);
  const [syncMap,       setSyncMap]       = useState({}); // date → 'synced' | 'pending'

  // Day-level data
  const [loginSessions, setLoginSessions] = useState([]);
  const [path,          setPath]          = useState([]);
  const [stops,         setStops]         = useState([]);
  const [visits,        setVisits]        = useState([]);
  const [dayLoading,    setDayLoading]    = useState(true);

  // Fetch login deadline from server once
  useEffect(() => {
    api.getLoginDeadline()
      .then(({ login_deadline }) => { if (login_deadline) setLoginDeadline(login_deadline); })
      .catch(() => {});
  }, []);

  // Reload week strip when week changes
  useEffect(() => {
    const dates = getWeekDates(weekOffset);
    setWeekDates(dates);
    loadWeekData(dates);
  }, [weekOffset]);

  // Reload day panel when selected date changes
  useEffect(() => {
    loadDayData(selectedDate);
  }, [selectedDate]);

  async function loadWeekData(dates) {
    try {
      const rows = await getLoginSessionsByDateRange(dates[0], dates[6]);
      const map  = {};
      for (const r of rows) {
        if (!map[r.date]) map[r.date] = [];
        map[r.date].push(r);
      }
      setWeekLoginMap(map);
    } catch {}

    // Sync status map — used for the dot on each day cell and the sync card
    try {
      const sm      = {};
      const pending = await getPendingDays();
      for (const d of pending) sm[d] = 'pending';
      const localLog = await getSyncLog();
      for (const row of localLog) { if (row.status === 'synced') sm[row.date] = 'synced'; }
      const serverLog = await api.getSyncStatus();
      for (const row of serverLog) sm[row.date] = 'synced';
      setSyncMap(sm);
    } catch {}
  }

  // Loads login, path, stops, visits for the selected date
  const loadDayData = useCallback(async (date) => {
    setDayLoading(true);
    try {
      const [sessions, gpsPath, dayStops, dayVisits] = await Promise.all([
        getLoginSessionsByDateRange(date, date),
        getTodayPath(date),
        getStopsByDate(date),
        getVisitsByDate(date),
      ]);
      setLoginSessions(sessions);
      setPath(gpsPath);
      setStops(dayStops);
      setVisits(dayVisits);
    } catch {}
    setDayLoading(false);
  }, []);

  // Returns the fill colour for a week day box (same logic as MapScreen)
  function boxColor(date) {
    const sessions = weekLoginMap[date] || [];
    const first    = sessions[0];
    if (!first) return null;
    const d          = parseDate(first.login_time);
    const loginMins  = d.getHours() * 60 + d.getMinutes();
    const [dh, dm]   = loginDeadline.split(':').map(Number);
    return loginMins <= dh * 60 + dm ? GREEN : YELLOW;
  }

  // Login status for the selected day
  const firstSession = loginSessions[0];
  let loginStatus = null;
  if (firstSession) {
    const d         = parseDate(firstSession.login_time);
    const loginMins = d.getHours() * 60 + d.getMinutes();
    const [dh, dm]  = loginDeadline.split(':').map(Number);
    loginStatus     = loginMins <= dh * 60 + dm ? 'ontime' : 'late';
  }

  const distKm     = totalDistanceKm(path);
  const syncStatus = syncMap[selectedDate];

  // Prevent navigating past the current week
  function goNextWeek() {
    if (weekOffset < 0) setWeekOffset(w => w + 1);
  }

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Day Log</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Week navigation ── */}
        <View style={styles.weekNav}>
          <TouchableOpacity style={styles.weekArrowBtn} onPress={() => setWeekOffset(w => w - 1)}>
            <MaterialIcons name="chevron-left" size={22} color={BLACK} />
          </TouchableOpacity>
          <Text style={styles.weekNavLabel}>
            {new Date(weekDates[0] + 'T00:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })}
            {' – '}
            {new Date(weekDates[6] + 'T00:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })}
          </Text>
          <TouchableOpacity
            style={[styles.weekArrowBtn, weekOffset >= 0 && styles.weekArrowDisabled]}
            onPress={goNextWeek}
            disabled={weekOffset >= 0}
          >
            <MaterialIcons name="chevron-right" size={22} color={weekOffset >= 0 ? GRAY2 : BLACK} />
          </TouchableOpacity>
        </View>

        {/* ── Week strip — 7 day pills ── */}
        <View style={styles.weekStrip}>
          {weekDates.map((date, i) => {
            const fill       = boxColor(date);
            const isSelected = date === selectedDate;
            const isToday    = date === todayStr;
            const isPast     = date < todayStr;
            const hasFill    = !!fill;
            const syncDot    = syncMap[date]; // 'synced' | 'pending' | undefined

            return (
              <TouchableOpacity
                key={date}
                style={styles.weekDayCol}
                onPress={() => setSelectedDate(date)}
                activeOpacity={0.7}
              >
                <Text style={[styles.weekDayLetter, { color: GRAY }]}>{WEEK_LABELS[i]}</Text>
                <View style={[
                  styles.weekDayCircle,
                  hasFill
                    ? { backgroundColor: fill, borderColor: fill }
                    : { borderColor: isToday ? BLACK : GRAY3 },
                  isSelected && styles.weekDayCircleSelected,
                  !hasFill && isPast && !isToday && { opacity: 0.35 },
                ]}>
                  <Text style={[
                    styles.weekDayNum,
                    { color: hasFill ? (fill === YELLOW ? BLACK : WHITE) : (isToday ? BLACK : GRAY) },
                    isSelected && { fontWeight: '900' },
                  ]}>
                    {parseInt(date.slice(8), 10)}
                  </Text>
                </View>
                {/* Sync dot below the circle */}
                {syncDot ? (
                  <View style={[
                    styles.syncDot,
                    { backgroundColor: syncDot === 'synced' ? BLACK : 'transparent',
                      borderWidth: syncDot === 'pending' ? 1.5 : 0,
                      borderColor: BLACK },
                  ]} />
                ) : <View style={styles.syncDotPlaceholder} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Selected date label ── */}
        <Text style={styles.selectedLabel}>{fmtDateFull(selectedDate)}</Text>

        {dayLoading ? (
          <ActivityIndicator size="large" color={BLACK} style={{ marginTop: 32 }} />
        ) : (
          <>
            {/* ── Login ── */}
            <Text style={styles.sectionHeader}>LOGIN</Text>
            <View style={styles.card}>
              {firstSession ? (
                <View style={styles.loginRow}>
                  <MaterialIcons name="login" size={22} color={BLACK} />
                  <Text style={styles.loginTime}>{fmtTime(firstSession.login_time)}</Text>
                  <View style={[
                    styles.badge,
                    { backgroundColor: loginStatus === 'ontime' ? '#EDFBF1' : '#FFF9E6' },
                  ]}>
                    <Text style={[
                      styles.badgeText,
                      { color: loginStatus === 'ontime' ? GREEN : '#B8860B' },
                    ]}>
                      {loginStatus === 'ontime' ? 'On Time' : 'Late'}
                    </Text>
                  </View>
                  {firstSession.synced === 1 && (
                    <View style={[styles.badge, { backgroundColor: CARD, marginLeft: 'auto' }]}>
                      <MaterialIcons name="cloud-done" size={13} color={GRAY} />
                      <Text style={[styles.badgeText, { color: GRAY }]}>Synced</Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.emptyText}>No login recorded for this day</Text>
              )}
            </View>

            {/* ── Travel ── */}
            <Text style={styles.sectionHeader}>TRAVEL</Text>
            <View style={styles.card}>
              {path.length > 0 ? (
                <View style={styles.statRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{path.length}</Text>
                    <Text style={styles.statLabel}>GPS points</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {distKm < 1
                        ? `${Math.round(distKm * 1000)}m`
                        : `${distKm.toFixed(1)}km`}
                    </Text>
                    <Text style={styles.statLabel}>Distance</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{stops.length}</Text>
                    <Text style={styles.statLabel}>Stops</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>No travel data recorded</Text>
              )}
            </View>

            {/* ── Stops ── */}
            {stops.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>STOPS</Text>
                {stops.map((stop, idx) => (
                  <View key={stop.id} style={[styles.itemCard, idx === stops.length - 1 && { marginBottom: 20 }]}>
                    <View style={styles.itemRow}>
                      <View style={[styles.statusDot, {
                        backgroundColor: stop.status === 'completed' ? GREEN : RED,
                      }]} />
                      <Text style={styles.itemTime}>{fmtTime(stop.arrived_at)}</Text>
                      <Text style={styles.itemDuration}>{fmtDuration(stop.dwell_duration)}</Text>
                      {stop.synced === 1 && (
                        <MaterialIcons name="cloud-done" size={14} color={GRAY2} style={{ marginLeft: 'auto' }} />
                      )}
                    </View>
                    {stop.response ? (
                      <Text style={styles.itemSub}>{stop.response}</Text>
                    ) : stop.status === 'pending' ? (
                      <Text style={[styles.itemSub, { color: RED }]}>Awaiting response</Text>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {/* ── Client Visits ── */}
            {visits.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>CLIENT VISITS</Text>
                {visits.map((v, idx) => (
                  <View key={v.id} style={[styles.itemCard, idx === visits.length - 1 && { marginBottom: 20 }]}>
                    <View style={styles.itemRow}>
                      <MaterialIcons name="store" size={15} color={BLACK} />
                      <Text style={styles.itemName}>{v.saved_location_name || 'Unknown location'}</Text>
                      <Text style={styles.itemDuration}>{fmtDuration(v.dwell_duration)}</Text>
                    </View>
                    {v.saved_location_cat ? (
                      <Text style={styles.itemSub}>{v.saved_location_cat}</Text>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {/* ── Sync Status ── */}
            <Text style={styles.sectionHeader}>SYNC</Text>
            <View style={styles.card}>
              <View style={styles.syncRow}>
                <MaterialIcons
                  name={syncStatus === 'synced' ? 'cloud-done' : 'cloud-upload'}
                  size={20}
                  color={syncStatus === 'synced' ? GREEN : BLACK}
                />
                <Text style={styles.syncLabel}>
                  {syncStatus === 'synced'
                    ? 'Synced to server'
                    : syncStatus === 'pending'
                    ? 'Pending sync'
                    : 'No data to sync'}
                </Text>
                {syncStatus === 'pending' && (
                  <TouchableOpacity
                    style={styles.syncBtn}
                    onPress={() => navigation.navigate('Sync', { date: selectedDate })}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.syncBtnText}>Sync Now</Text>
                    <MaterialIcons name="chevron-right" size={15} color={WHITE} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
    safe:   { flex: 1, backgroundColor: BG },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: GRAY3,
    },
    backBtn:     { width: 36, alignItems: 'flex-start' },
    headerTitle: { color: BLACK, fontSize: 17, fontWeight: '700' },

    scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 56 },

    // Week navigation
    weekNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 14,
    },
    weekArrowBtn:     { padding: 6 },
    weekArrowDisabled:{ opacity: 0.3 },
    weekNavLabel:     { color: BLACK, fontSize: 13, fontWeight: '700' },

    // Week strip
    weekStrip: {
      flexDirection: 'row', justifyContent: 'space-between',
      marginBottom: 6,
    },
    weekDayCol:    { alignItems: 'center', gap: 5 },
    weekDayLetter: { fontSize: 11, fontWeight: '700' },
    weekDayCircle: {
      width: 40, height: 40, borderRadius: 20,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: GRAY3,
    },
    weekDayCircleSelected: { borderWidth: 2.5, borderColor: BLACK },
    weekDayNum:    { fontSize: 14, fontWeight: '600' },
    syncDot:            { width: 6, height: 6, borderRadius: 3 },
    syncDotPlaceholder: { width: 6, height: 6 },

    selectedLabel: {
      color: GRAY, fontSize: 13, fontWeight: '600',
      textAlign: 'center', marginTop: 10, marginBottom: 24,
    },

    // Sections
    sectionHeader: {
      color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
      marginBottom: 8, marginLeft: 2,
    },
    card: {
      backgroundColor: CARD, borderRadius: 14,
      padding: 16, marginBottom: 20,
    },

    // Login card
    loginRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    loginTime: { color: BLACK, fontSize: 24, fontWeight: '800' },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    },
    badgeText: { fontSize: 12, fontWeight: '700' },

    // Travel stats
    statRow:      { flexDirection: 'row', alignItems: 'center' },
    stat:         { flex: 1, alignItems: 'center', gap: 4 },
    statValue:    { color: BLACK, fontSize: 24, fontWeight: '800' },
    statLabel:    { color: GRAY, fontSize: 11, fontWeight: '600' },
    statDivider:  { width: 1, height: 36, backgroundColor: GRAY3 },

    // Stop / visit cards
    itemCard: {
      backgroundColor: CARD, borderRadius: 12,
      padding: 14, marginBottom: 8, gap: 5,
    },
    itemRow:      { flexDirection: 'row', alignItems: 'center', gap: 9 },
    statusDot:    { width: 8, height: 8, borderRadius: 4 },
    itemTime:     { color: BLACK, fontSize: 14, fontWeight: '700', flex: 1 },
    itemName:     { color: BLACK, fontSize: 14, fontWeight: '700', flex: 1 },
    itemDuration: { color: GRAY, fontSize: 13 },
    itemSub:      { color: GRAY, fontSize: 13, marginLeft: 17 },

    // Sync card
    syncRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
    syncLabel:   { color: BLACK, fontSize: 15, fontWeight: '600', flex: 1 },
    syncBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: BLACK, borderRadius: 10,
      paddingVertical: 8, paddingHorizontal: 12,
    },
    syncBtnText: { color: WHITE, fontSize: 13, fontWeight: '700' },

    emptyText: { color: GRAY, fontSize: 14 },
  });
}
