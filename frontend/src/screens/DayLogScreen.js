// DayLogScreen.js — Daily login + travel log detail view
// Navigated to from MapScreen.js → login widget arrow button (navigate 'DayLog')
//
// Layout: week strip (7 day pills) → tap a day → day-level detail below
//   Sections: Login time + location, Travel (journey timeline), Stops summary, Client Visits, Sync
//
// Data flows:
//   getLoginSessionsByDateRange()            → week strip colours + login card
//   api.getLoginDeadline()                   → on-time / late threshold
//   getTodayPath(date)                       → GPS path (point count) for "View on Map"
//   getStopsByDate(date)                     → journey timeline nodes
//   getVisitsByDate(date)                    → client visit names for stop nodes
//   getSyncLog() + getPendingDays()
//     + api.getSyncStatus()                  → sync badge
//   AsyncStorage saved/base/home locations  → login location + stop name matching

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, ActivityIndicator, Platform, StatusBar,
} from 'react-native';
import { useFocusEffect }                        from '@react-navigation/native';
import { MaterialIcons }                         from '@expo/vector-icons';
import AsyncStorage                              from '@react-native-async-storage/async-storage';
import { useTheme }                              from '../contexts/ThemeContext';
import { api }                                   from '../services/api';
import {
  getLoginSessionsByDateRange,
  getTodayPath,
  getStopsByDate,
  getVisitsByDate,
  getSyncLog,
  getPendingDays,
  saveLoginLocation,
} from '../services/localDatabase';

const GREEN  = '#34C759';
const YELLOW = '#FFCC00';
const RED    = '#FF3B30';
const LOGIN_DEADLINE_DEFAULT = '09:00';
const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const CATEGORY_LABEL = {
  base: 'Base', home: 'Home', client: 'Client',
  site: 'Site', 'rest-stop': 'Rest Stop',
};

const CATEGORY_ICON = {
  base: 'star', home: 'home', client: 'people',
  site: 'factory', 'rest-stop': 'pause', other: 'place',
};

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

// Formats a duration in minutes → "45m" or "2h 15m"
function fmtMins(m) {
  if (!m || m <= 0) return '';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}

// Client visits store dwell_duration in minutes too, but existing fmtDuration treated as seconds.
// Kept for the CLIENT VISITS section to avoid changing existing display.
function fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
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

// Loads all named locations from AsyncStorage (saved pins + base + home)
async function loadAllLocations() {
  const [savedRaw, baseRaw, homeRaw, baseLegacy, homeLegacy] = await Promise.all([
    AsyncStorage.getItem('saved_locations_data'),
    AsyncStorage.getItem('base_locations_data'),
    AsyncStorage.getItem('home_locations_data'),
    AsyncStorage.getItem('base_location_data'),
    AsyncStorage.getItem('home_location_data'),
  ]);
  const saved = savedRaw  ? JSON.parse(savedRaw)  : [];
  const bases = baseRaw   ? JSON.parse(baseRaw)   : baseLegacy  ? [JSON.parse(baseLegacy)]  : [];
  const homes = homeRaw   ? JSON.parse(homeRaw)   : homeLegacy  ? [JSON.parse(homeLegacy)]  : [];
  return [
    ...bases.map((l, i) => ({ name: l.name || `Base ${i + 1}`, category: 'base', latitude: l.latitude, longitude: l.longitude })),
    ...homes.map((l, i) => ({ name: l.name || `Home ${i + 1}`, category: 'home', latitude: l.latitude, longitude: l.longitude })),
    ...saved.map(l        => ({ name: l.name, category: l.category, latitude: l.latitude, longitude: l.longitude })),
  ];
}

// Returns the nearest named location within 300 m of (lat, lon), or null
function findNearestLocation(lat, lon, allLocations) {
  let nearest = null, nearestDist = Infinity;
  for (const loc of allLocations) {
    if (!loc.latitude || !loc.longitude) continue;
    const d = haversineKm(lat, lon, loc.latitude, loc.longitude) * 1000; // metres
    if (d < nearestDist && d < 300) { nearestDist = d; nearest = loc; }
  }
  return nearest ? { name: nearest.name, category: nearest.category } : null;
}

// Builds an ordered array of journey events from login + stops + visits.
// Each event: { type: 'login'|'stop', time: Date, dwell?: number (mins), location?, status? }
function buildJourney(session, stops, visits, loginLocation, allLocations) {
  const events = [];
  if (session) {
    events.push({ type: 'login', time: parseDate(session.login_time), location: loginLocation });
  }
  const sorted = [...stops].sort((a, b) => parseDate(a.arrived_at) - parseDate(b.arrived_at));
  for (const stop of sorted) {
    const visit = visits.find(v => v.stop_id === stop.id);
    let location = null;
    if (visit?.saved_location_name) {
      location = { name: visit.saved_location_name, category: visit.saved_location_cat };
    } else if (stop.latitude && stop.longitude) {
      location = findNearestLocation(stop.latitude, stop.longitude, allLocations);
    }
    events.push({
      type:     'stop',
      time:     parseDate(stop.arrived_at),
      dwell:    stop.dwell_duration, // minutes
      location,
      status:   stop.status,
    });
  }
  return events;
}

// Minutes between the end of prevEvent and the start of nextEvent
function transitMins(prev, next) {
  const prevEnd = prev.type === 'login'
    ? prev.time
    : new Date(prev.time.getTime() + (prev.dwell || 0) * 60000);
  return Math.max(0, Math.round((next.time - prevEnd) / 60000));
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
  const [syncMap,       setSyncMap]       = useState({});

  // Day-level state
  const [loginSessions, setLoginSessions] = useState([]);
  const [loginLocation, setLoginLocation] = useState(null); // { name, category } | null
  const [loginCoords,   setLoginCoords]   = useState(null); // { latitude, longitude } fallback when no named location
  const [pathLength,    setPathLength]    = useState(0);    // GPS point count for "View on Map"
  const [stops,         setStops]         = useState([]);
  const [visits,        setVisits]        = useState([]);
  const [allLocations,  setAllLocations]  = useState([]);
  const [dayLoading,    setDayLoading]    = useState(true);
  const [fetchingRemote, setFetchingRemote] = useState(false);

  // Fetch login deadline once on mount
  useEffect(() => {
    api.getLoginDeadline()
      .then(({ login_deadline }) => { if (login_deadline) setLoginDeadline(login_deadline); })
      .catch(() => {});
  }, []);

  // Reload everything when selected date or week changes, and on every screen focus
  useFocusEffect(
    useCallback(() => {
      const dates = getWeekDates(weekOffset);
      setWeekDates(dates);
      loadWeekData(dates);
      loadDayData(selectedDate);
    }, [selectedDate, weekOffset])
  );

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

  // Loads login sessions, GPS path length, stops, visits, and all locations for a given date.
  // Primary source: local SQLite. Falls back to server for synced days with no local data
  // (e.g. viewing from a different device) via GET /api/sync/day-detail/<date>.
  const loadDayData = useCallback(async (date) => {
    setDayLoading(true);
    try {
      const [sessions, gpsPath, dayStops, dayVisits, locs] = await Promise.all([
        getLoginSessionsByDateRange(date, date),
        getTodayPath(date),
        getStopsByDate(date),
        getVisitsByDate(date),
        loadAllLocations(),
      ]);
      setAllLocations(locs);

      const hasLocalData = sessions.length > 0 || gpsPath.length > 0 || dayStops.length > 0;
      if (!hasLocalData) {
        // No local data — try the server (handles cross-device view of synced days)
        setFetchingRemote(true);
        try {
          const remote = await api.getDayDetail(date);
          setLoginSessions(remote.login_sessions);
          setPathLength(remote.path_count);
          setStops(remote.stops);
          setVisits(remote.visits);
          const first = remote.login_sessions[0];
          if (first?.login_location_name) {
            setLoginLocation({ name: first.login_location_name, category: first.login_location_cat });
            setLoginCoords(null);
          } else {
            setLoginLocation(null);
            setLoginCoords(remote.first_gps ?? null);
          }
        } catch {
          setLoginSessions([]); setPathLength(0); setStops([]); setVisits([]);
          setLoginLocation(null); setLoginCoords(null);
        }
        setFetchingRemote(false);
      } else {
        setLoginSessions(sessions);
        setPathLength(gpsPath.length);
        setStops(dayStops);
        setVisits(dayVisits);
        const firstSession = sessions[0];
        if (firstSession?.login_location_name) {
          setLoginLocation({ name: firstSession.login_location_name, category: firstSession.login_location_cat });
          setLoginCoords(null);
        } else if (gpsPath.length > 0) {
          const loc = findNearestLocation(gpsPath[0].latitude, gpsPath[0].longitude, locs);
          setLoginLocation(loc);
          setLoginCoords(loc ? null : { latitude: gpsPath[0].latitude, longitude: gpsPath[0].longitude });
          if (loc) await saveLoginLocation(date, loc.name, loc.category);
        } else {
          setLoginLocation(null);
          setLoginCoords(null);
        }
      }
    } catch {}
    setDayLoading(false);
  }, []);

  // Returns green/yellow fill for a week day based on login time vs deadline
  function boxColor(date) {
    const sessions = weekLoginMap[date] || [];
    const first    = sessions[0];
    if (!first) return null;
    const d         = parseDate(first.login_time);
    const loginMins = d.getHours() * 60 + d.getMinutes();
    const [dh, dm]  = loginDeadline.split(':').map(Number);
    return loginMins <= dh * 60 + dm ? GREEN : YELLOW;
  }

  const firstSession = loginSessions[0];
  let loginStatus = null;
  if (firstSession) {
    const d         = parseDate(firstSession.login_time);
    const loginMins = d.getHours() * 60 + d.getMinutes();
    const [dh, dm]  = loginDeadline.split(':').map(Number);
    loginStatus     = loginMins <= dh * 60 + dm ? 'ontime' : 'late';
  }

  const syncStatus   = syncMap[selectedDate];
  const pendingCount = stops.filter(s => s.status === 'pending').length;
  const isToday      = selectedDate === todayStr;

  // Build journey events for the timeline
  const journeyEvents = (firstSession || stops.length > 0)
    ? buildJourney(firstSession, stops, visits, loginLocation, allLocations)
    : [];
  const hasTravel = journeyEvents.length > 0 || pathLength > 0;

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
        <TouchableOpacity
          style={styles.todayBtn}
          onPress={() => { setWeekOffset(0); setSelectedDate(todayStr); }}
          disabled={isToday}
        >
          <Text style={{ fontSize: 12, color: isToday ? GRAY2 : BLACK, fontWeight: '500' }}>Today →</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Week navigation with Prev / Next labels ── */}
        <View style={styles.weekNav}>
          <TouchableOpacity style={styles.weekArrowBtn} onPress={() => setWeekOffset(w => w - 1)}>
            <MaterialIcons name="chevron-left" size={18} color={BLACK} />
            <Text style={styles.weekArrowLabel}>Prev Week</Text>
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
            <Text style={[styles.weekArrowLabel, weekOffset >= 0 && { color: GRAY2 }]}>Next Week</Text>
            <MaterialIcons name="chevron-right" size={18} color={weekOffset >= 0 ? GRAY2 : BLACK} />
          </TouchableOpacity>
        </View>

        {/* ── Week strip — 7 day pills ── */}
        <View style={styles.weekStrip}>
          {weekDates.map((date, i) => {
            const fill    = boxColor(date);
            const isSel   = date === selectedDate;
            const isDay   = date === todayStr;
            const isPast  = date < todayStr;
            const hasFill = !!fill;
            const syncDot = syncMap[date];

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
                    : { borderColor: isDay ? BLACK : GRAY3, borderWidth: isDay ? 2 : 1 },
                  isSel && styles.weekDayCircleSelected,
                  !hasFill && isPast && !isDay && { opacity: 0.35 },
                ]}>
                  <Text style={[
                    styles.weekDayNum,
                    { color: hasFill ? (fill === YELLOW ? BLACK : WHITE) : (isDay ? BLACK : GRAY) },
                    isSel && { fontWeight: '900' },
                  ]}>
                    {parseInt(date.slice(8), 10)}
                  </Text>
                </View>

                {/* "Today" label replaces sync dot for today's date */}
                {isDay ? (
                  <Text style={styles.todayPip}>Today</Text>
                ) : syncDot ? (
                  <View style={[
                    styles.syncDot,
                    { backgroundColor: syncDot === 'synced' ? BLACK : 'transparent',
                      borderWidth: syncDot === 'pending' ? 1.5 : 0,
                      borderColor: BLACK },
                  ]} />
                ) : (
                  <View style={styles.syncDotPlaceholder} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Selected date label ── */}
        <View style={styles.dateLabelRow}>
          {isToday ? (
            <View style={styles.dateBubble}>
              <Text style={styles.dateBubbleText}>{fmtDateFull(selectedDate)}</Text>
            </View>
          ) : (
            <Text style={styles.datePlain}>{fmtDateFull(selectedDate)}</Text>
          )}
        </View>

        {dayLoading ? (
          <View style={{ alignItems: 'center', marginTop: 32 }}>
            <ActivityIndicator size="large" color={BLACK} />
            {fetchingRemote && (
              <Text style={{ color: GRAY, fontSize: 13, marginTop: 10 }}>Fetching details...</Text>
            )}
          </View>
        ) : (
          <>
            {/* ── LOGIN ── */}
            <Text style={styles.sectionHeader}>LOGIN</Text>
            <View style={styles.card}>
              {firstSession ? (
                <>
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

                  <Text style={styles.loginDeadlineHint}>
                    Login deadline: {loginDeadline}
                  </Text>

                  {loginLocation ? (
                    <View style={styles.loginLocRow}>
                      <MaterialIcons name="place" size={14} color={GRAY} />
                      <Text style={styles.loginLocName}>{loginLocation.name}</Text>
                      <View style={styles.catPill}>
                        <Text style={styles.catPillText}>
                          {CATEGORY_LABEL[loginLocation.category] || loginLocation.category}
                        </Text>
                      </View>
                    </View>
                  ) : loginCoords ? (
                    <View style={styles.loginLocRow}>
                      <MaterialIcons name="gps-fixed" size={14} color={GRAY} />
                      <Text style={styles.loginLocName}>
                        {loginCoords.latitude.toFixed(5)}, {loginCoords.longitude.toFixed(5)}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.emptyText}>No login recorded for this day</Text>
              )}
            </View>

            {/* ── TRAVEL — journey timeline ── */}
            <Text style={styles.sectionHeader}>TRAVEL</Text>
            {hasTravel ? (
              <View style={styles.card}>
                {journeyEvents.length === 0 ? (
                  <Text style={styles.emptyText}>No stops recorded yet</Text>
                ) : (
                  journeyEvents.map((event, i) => {
                    const isLast    = i === journeyEvents.length - 1;
                    const transit   = !isLast ? transitMins(event, journeyEvents[i + 1]) : null;
                    const isLogin   = event.type === 'login';
                    const iconName  = isLogin
                      ? 'login'
                      : (CATEGORY_ICON[event.location?.category] || 'place');

                    return (
                      <React.Fragment key={i}>

                        {/* Journey node */}
                        <View style={styles.jNode}>
                          {/* Left column: dot + vertical lines */}
                          <View style={styles.jNodeLeft}>
                            {i > 0 && <View style={styles.jLineTop} />}
                            <View style={[styles.jDot, isLogin ? styles.jDotLogin : styles.jDotStop]}>
                              <MaterialIcons name={iconName} size={11} color={isLogin ? WHITE : BLACK} />
                            </View>
                            {!isLast && <View style={styles.jLineBottom} />}
                          </View>

                          {/* Right column: text */}
                          <View style={styles.jNodeRight}>
                            <Text style={styles.jNodeTitle} numberOfLines={1}>
                              {isLogin
                                ? (loginLocation?.name || 'Login')
                                : (event.location?.name || 'Stop')}
                            </Text>
                            <Text style={styles.jNodeTime}>{fmtTime(event.time.toISOString())}</Text>
                            <View style={styles.jNodeMeta}>
                              {!isLogin && event.dwell > 0 && (
                                <Text style={styles.jDwell}>{fmtMins(event.dwell)}</Text>
                              )}
                              {event.location?.category && (
                                <View style={styles.jCatPill}>
                                  <Text style={styles.jCatPillText}>
                                    {CATEGORY_LABEL[event.location.category] || event.location.category}
                                  </Text>
                                </View>
                              )}
                              {isLogin && (
                                <View style={styles.jCatPill}>
                                  <Text style={styles.jCatPillText}>Login</Text>
                                </View>
                              )}
                              {!isLogin && event.status === 'pending' && (
                                <View style={[styles.jCatPill, styles.jCatPillPending]}>
                                  <Text style={[styles.jCatPillText, { color: RED }]}>Pending</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>

                        {/* Transit connector to next node */}
                        {!isLast && (
                          <View style={styles.jConnector}>
                            <View style={styles.jConnectorLeft}>
                              <View style={styles.jConnectorLine} />
                            </View>
                            <Text style={styles.jConnectorText}>
                              {transit > 0 ? `${fmtMins(transit)} in transit` : '—'}
                            </Text>
                          </View>
                        )}

                      </React.Fragment>
                    );
                  })
                )}

                {/* View on Map button */}
                {pathLength > 0 && (
                  <TouchableOpacity
                    style={styles.jViewMapBtn}
                    onPress={() => navigation.navigate('TravelMap', { date: selectedDate })}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="map" size={15} color={BLACK} />
                    <Text style={styles.jViewMapBtnText}>View on Map</Text>
                    <MaterialIcons name="arrow-forward" size={14} color={GRAY} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyText}>No travel data recorded</Text>
              </View>
            )}

            {/* ── STOPS — summary + redirect ── */}
            {stops.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>STOPS</Text>
                <View style={styles.card}>
                  <View style={styles.stopsRow}>
                    <View style={[
                      styles.stopsDot,
                      { backgroundColor: pendingCount > 0 ? RED : GREEN },
                    ]} />
                    <Text style={styles.stopsText}>
                      {pendingCount > 0
                        ? `${pendingCount} / ${stops.length} stops unattended`
                        : 'All stops accounted for'}
                    </Text>
                    {isToday && pendingCount > 0 && (
                      <TouchableOpacity
                        style={styles.stopsViewBtn}
                        onPress={() => navigation.navigate('Archive')}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.stopsViewBtnText}>Respond</Text>
                        <MaterialIcons name="chevron-right" size={14} color={WHITE} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </>
            )}

            {/* ── CLIENT VISITS ── */}
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

            {/* ── SYNC ── */}
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
                    <Text style={styles.syncBtnText}>Sync to Cloud</Text>
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
    safe:   { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: GRAY3,
    },
    backBtn:     { width: 36, alignItems: 'flex-start' },
    todayBtn:    { alignItems: 'flex-end' },
    headerTitle: { color: BLACK, fontSize: 17, fontWeight: '700' },

    scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 56 },

    // ── Week navigation ──
    weekNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 16,
    },
    weekArrowBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      paddingVertical: 6, paddingHorizontal: 4,
    },
    weekArrowDisabled: { opacity: 0.3 },
    weekArrowLabel:    { color: BLACK, fontSize: 12, fontWeight: '600' },
    weekNavLabel:      { color: BLACK, fontSize: 13, fontWeight: '700' },

    // ── Week strip ──
    weekStrip:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    weekDayCol: { alignItems: 'center', gap: 5 },
    weekDayLetter: { fontSize: 11, fontWeight: '700' },
    weekDayCircle: {
      width: 40, height: 40, borderRadius: 20,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: GRAY3,
    },
    weekDayCircleSelected: { borderWidth: 2.5, borderColor: BLACK },
    weekDayNum:            { fontSize: 14, fontWeight: '600' },
    todayPip:              { fontSize: 9, fontWeight: '700', color: BLACK, letterSpacing: 0.2 },
    syncDot:               { width: 6, height: 6, borderRadius: 3 },
    syncDotPlaceholder:    { width: 6, height: 6 },

    // ── Date label row ──
    dateLabelRow: {
      alignItems: 'center', justifyContent: 'center',
      marginTop: 10, marginBottom: 24,
    },
    dateBubble: {
      backgroundColor: BLACK, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 7,
    },
    dateBubbleText: { color: WHITE, fontSize: 13, fontWeight: '700' },
    datePlain:      { color: BLACK, fontSize: 13, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 7 },

    // ── Section headers ──
    sectionHeader: {
      color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
      marginBottom: 8, marginLeft: 2,
    },
    card: {
      backgroundColor: CARD, borderRadius: 14,
      padding: 16, marginBottom: 20,
    },

    // ── Login card ──
    loginRow:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
    loginTime:         { color: BLACK, fontSize: 24, fontWeight: '800' },
    loginDeadlineHint: { color: GRAY2, fontSize: 12, fontWeight: '500', marginTop: 6, marginLeft: 32 },
    loginLocRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 32 },
    loginLocName:      { color: GRAY, fontSize: 13, fontWeight: '600', flex: 1 },
    catPill:           { backgroundColor: WHITE, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: GRAY3 },
    catPillText:       { color: GRAY, fontSize: 11, fontWeight: '700' },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    },
    badgeText: { fontSize: 12, fontWeight: '700' },

    // ── Journey timeline ──
    jNode: { flexDirection: 'row', minHeight: 60 },

    // Left column: dot + lines above/below
    jNodeLeft:   { width: 36, alignItems: 'center' },
    jLineTop:    { flex: 1, width: 2, backgroundColor: GRAY3, marginBottom: 0 },
    jDot: {
      width: 28, height: 28, borderRadius: 14,
      borderWidth: 1.5, borderColor: GRAY3,
      backgroundColor: WHITE,
      justifyContent: 'center', alignItems: 'center',
      zIndex: 1,
    },
    jDotLogin: { backgroundColor: BLACK, borderColor: BLACK },
    jDotStop:  { backgroundColor: WHITE, borderColor: GRAY3 },
    jLineBottom: { flex: 1, width: 2, backgroundColor: GRAY3, marginTop: 0 },

    // Right column: text
    jNodeRight:  { flex: 1, paddingLeft: 12, paddingVertical: 6, justifyContent: 'center' },
    jNodeTitle:  { color: BLACK, fontSize: 14, fontWeight: '700' },
    jNodeTime:   { color: GRAY, fontSize: 12, fontWeight: '500', marginTop: 2 },
    jNodeMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
    jDwell:      { color: GRAY, fontSize: 12, fontWeight: '600' },
    jCatPill: {
      backgroundColor: WHITE, borderRadius: 6,
      paddingHorizontal: 7, paddingVertical: 2,
      borderWidth: 1, borderColor: GRAY3,
    },
    jCatPillText:    { color: GRAY, fontSize: 10, fontWeight: '700' },
    jCatPillPending: { borderColor: RED, backgroundColor: '#FFF3F2' },

    // Transit connector
    jConnector:     { flexDirection: 'row', minHeight: 32 },
    jConnectorLeft: { width: 36, alignItems: 'center' },
    jConnectorLine: { flex: 1, width: 2, backgroundColor: GRAY3 },
    jConnectorText: { flex: 1, color: GRAY2, fontSize: 11, fontWeight: '500', paddingLeft: 12, alignSelf: 'center' },

    // View on Map button
    jViewMapBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginTop: 16, paddingVertical: 11, paddingHorizontal: 14,
      backgroundColor: WHITE, borderRadius: 12,
      borderWidth: 1, borderColor: GRAY3,
    },
    jViewMapBtnText: { color: BLACK, fontSize: 13, fontWeight: '700', flex: 1 },

    // ── Stops summary ──
    stopsRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stopsDot:      { width: 9, height: 9, borderRadius: 4.5, flexShrink: 0 },
    stopsText:     { color: BLACK, fontSize: 14, fontWeight: '600', flex: 1 },
    stopsViewBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      backgroundColor: BLACK, borderRadius: 10,
      paddingVertical: 7, paddingHorizontal: 11,
    },
    stopsViewBtnText: { color: WHITE, fontSize: 12, fontWeight: '700' },

    // ── Client visit cards ──
    itemCard: {
      backgroundColor: CARD, borderRadius: 12,
      padding: 14, marginBottom: 8, gap: 5,
    },
    itemRow:      { flexDirection: 'row', alignItems: 'center', gap: 9 },
    itemName:     { color: BLACK, fontSize: 14, fontWeight: '700', flex: 1 },
    itemDuration: { color: GRAY, fontSize: 13 },
    itemSub:      { color: GRAY, fontSize: 13, marginLeft: 24 },

    // ── Sync card ──
    syncRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
    syncLabel:{ color: BLACK, fontSize: 15, fontWeight: '600', flex: 1 },
    syncBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: BLACK, borderRadius: 10,
      paddingVertical: 8, paddingHorizontal: 12,
    },
    syncBtnText: { color: WHITE, fontSize: 13, fontWeight: '700' },

    emptyText: { color: GRAY, fontSize: 14 },
  });
}
