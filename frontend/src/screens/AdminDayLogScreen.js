// AdminDayLogScreen.js — Admin view of an employee's day log for a selected date
// Pushed from AdminEmployeesScreen → navigation.navigate('AdminDayLog', { employee })
//
// Data flows:
//   GET /api/admin/employee/:id/day-log/:date → api.getEmployeeDayLog() → login + stops timeline
//   GET /api/settings/login-deadline          → api.getLoginDeadline()  → on-time badge threshold
//   "View on Map" → navigate('AdminTravelMap', { userId, date, employeeName })
//
// Journey timeline mirrors DayLogScreen.js dot+line style.
// Date navigation arrows let admin step day by day.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { MaterialIcons }  from '@expo/vector-icons';
import { useTheme }       from '../contexts/ThemeContext';
import { api }            from '../services/api';

const GREEN  = '#34C759';
const YELLOW = '#FFCC00';
const RED    = '#FF3B30';
const LOGIN_DEADLINE_DEFAULT = '09:00';

// Parses an ISO or space-separated timestamp string into a Date
function parseDate(str) {
  if (!str) return new Date(0);
  return new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
}

// Formats a timestamp string to "HH:MM" local time
function fmtTime(str) {
  const d = parseDate(str);
  return d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

// Formats YYYY-MM-DD to "Monday, 21 Mar" style
function fmtDateFull(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// Formats minutes to "45m" or "2h 15m"
function fmtMins(m) {
  if (!m || m <= 0) return '';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}

// Returns YYYY-MM-DD string offset by `days` from `dateStr`
function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Minutes of transit between end of prevEvent and start of nextEvent
function transitMins(prev, next) {
  const prevEnd = prev.type === 'login'
    ? prev.time
    : new Date(prev.time.getTime() + (prev.dwell || 0) * 60000);
  return Math.max(0, Math.round((next.time - prevEnd) / 60000));
}

// Builds journey event array from login + stops; each event has type/time/dwell/location/status
function buildJourney(login, stops) {
  const events = [];
  if (login) {
    events.push({
      type: 'login',
      time: parseDate(login.login_time),
      location: login.login_location_name
        ? { name: login.login_location_name, cat: login.login_location_cat }
        : null,
    });
  }
  const sorted = [...stops].sort((a, b) => parseDate(a.triggered_at) - parseDate(b.triggered_at));
  for (const s of sorted) {
    events.push({
      type:     'stop',
      time:     parseDate(s.triggered_at),
      dwell:    s.dwell_duration,
      location: s.location_name ? { name: s.location_name, cat: s.location_cat } : null,
      status:   s.status,
    });
  }
  return events;
}

export default function AdminDayLogScreen({ navigation, route }) {
  const { employee } = route.params;
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();

  const todayStr = new Date().toISOString().slice(0, 10);

  const [selectedDate,  setSelectedDate]  = useState(todayStr);
  const [loginDeadline, setLoginDeadline] = useState(LOGIN_DEADLINE_DEFAULT);
  const [dayData,       setDayData]       = useState(null);   // { login, stops, location_count }
  const [loading,       setLoading]       = useState(true);

  // Fetch login deadline once on mount → GET /api/settings/login-deadline
  useEffect(() => {
    api.getLoginDeadline()
      .then(({ login_deadline }) => { if (login_deadline) setLoginDeadline(login_deadline); })
      .catch(() => {});
  }, []);

  // Reload day data whenever date changes
  useEffect(() => {
    loadDayData(selectedDate);
  }, [selectedDate]);

  // Fetches login + stops for selected employee and date → GET /api/admin/employee/:id/day-log/:date
  async function loadDayData(date) {
    setLoading(true);
    try {
      const data = await api.getEmployeeDayLog(employee.id, date);
      setDayData(data);
    } catch {
      setDayData(null);
    }
    setLoading(false);
  }

  const login        = dayData?.login    || null;
  const stops        = dayData?.stops    || [];
  const locCount     = dayData?.location_count || 0;
  const pendingCount = stops.filter(s => s.status === 'pending').length;

  // Determine login on-time status
  let loginStatus = null;
  if (login) {
    const d        = parseDate(login.login_time);
    const total    = d.getHours() * 60 + d.getMinutes();
    const [dh, dm] = loginDeadline.split(':').map(Number);
    loginStatus    = total <= dh * 60 + dm ? 'ontime' : 'late';
  }

  const journeyEvents = buildJourney(login, stops);
  const isToday       = selectedDate === todayStr;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerName, { color: BLACK }]} numberOfLines={1}>
            {employee.name}
          </Text>
          <Text style={[styles.headerSub, { color: GRAY }]}>Day Log</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Date navigation */}
      <View style={[styles.dateNav, { borderBottomColor: GRAY3 }]}>
        <TouchableOpacity style={styles.dateArrow} onPress={() => setSelectedDate(d => offsetDate(d, -1))}>
          <MaterialIcons name="chevron-left" size={26} color={BLACK} />
        </TouchableOpacity>
        <View style={styles.dateLabelWrap}>
          {isToday ? (
            <View style={[styles.todayPill, { backgroundColor: BLACK }]}>
              <Text style={[styles.todayPillText, { color: WHITE }]}>Today</Text>
            </View>
          ) : null}
          <Text style={[styles.dateLabel, { color: BLACK }]}>{fmtDateFull(selectedDate)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.dateArrow, selectedDate >= todayStr && { opacity: 0.3 }]}
          onPress={() => setSelectedDate(d => offsetDate(d, 1))}
          disabled={selectedDate >= todayStr}
        >
          <MaterialIcons name="chevron-right" size={26} color={BLACK} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BLACK} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* LOGIN section */}
          <Text style={[styles.sectionHeader, { color: GRAY }]}>LOGIN</Text>
          <View style={[styles.card, { backgroundColor: CARD }]}>
            {login ? (
              <>
                <View style={styles.loginRow}>
                  <MaterialIcons name="login" size={22} color={BLACK} />
                  <Text style={[styles.loginTime, { color: BLACK }]}>{fmtTime(login.login_time)}</Text>
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
                </View>
                <Text style={[styles.deadlineHint, { color: GRAY2 }]}>
                  Deadline: {loginDeadline}
                </Text>
                {login.login_location_name ? (
                  <View style={styles.locRow}>
                    <MaterialIcons name="place" size={14} color={GRAY} />
                    <Text style={[styles.locName, { color: GRAY }]} numberOfLines={1}>
                      {login.login_location_name}
                    </Text>
                    {login.login_location_cat ? (
                      <View style={[styles.catPill, { backgroundColor: WHITE, borderColor: GRAY3 }]}>
                        <Text style={[styles.catPillText, { color: GRAY }]}>
                          {login.login_location_cat}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={[styles.emptyText, { color: GRAY }]}>No login recorded for this day</Text>
            )}
          </View>

          {/* TRAVEL section — journey timeline */}
          <Text style={[styles.sectionHeader, { color: GRAY }]}>TRAVEL</Text>
          <View style={[styles.card, { backgroundColor: CARD }]}>
            {journeyEvents.length === 0 ? (
              <Text style={[styles.emptyText, { color: GRAY }]}>No travel data recorded</Text>
            ) : (
              journeyEvents.map((event, i) => {
                const isLast  = i === journeyEvents.length - 1;
                const transit = !isLast ? transitMins(event, journeyEvents[i + 1]) : null;
                const isLogin = event.type === 'login';

                return (
                  <React.Fragment key={i}>
                    {/* Journey node */}
                    <View style={styles.jNode}>
                      <View style={styles.jNodeLeft}>
                        {i > 0 && <View style={[styles.jLineTop, { backgroundColor: GRAY3 }]} />}
                        <View style={[
                          styles.jDot,
                          isLogin
                            ? { backgroundColor: BLACK, borderColor: BLACK }
                            : { backgroundColor: WHITE, borderColor: GRAY3 },
                        ]}>
                          <MaterialIcons
                            name={isLogin ? 'login' : 'place'}
                            size={11}
                            color={isLogin ? WHITE : BLACK}
                          />
                        </View>
                        {!isLast && <View style={[styles.jLineBottom, { backgroundColor: GRAY3 }]} />}
                      </View>
                      <View style={styles.jNodeRight}>
                        <Text style={[styles.jTitle, { color: BLACK }]} numberOfLines={1}>
                          {isLogin
                            ? (event.location?.name || 'Login')
                            : (event.location?.name || 'Stop')}
                        </Text>
                        <Text style={[styles.jTime, { color: GRAY }]}>{fmtTime(event.time.toISOString())}</Text>
                        <View style={styles.jMeta}>
                          {!isLogin && event.dwell > 0 && (
                            <Text style={[styles.jDwell, { color: GRAY }]}>{fmtMins(event.dwell)}</Text>
                          )}
                          {isLogin && (
                            <View style={[styles.jPill, { backgroundColor: WHITE, borderColor: GRAY3 }]}>
                              <Text style={[styles.jPillText, { color: GRAY }]}>Login</Text>
                            </View>
                          )}
                          {!isLogin && event.location?.cat && (
                            <View style={[styles.jPill, { backgroundColor: WHITE, borderColor: GRAY3 }]}>
                              <Text style={[styles.jPillText, { color: GRAY }]}>{event.location.cat}</Text>
                            </View>
                          )}
                          {!isLogin && event.status === 'pending' && (
                            <View style={[styles.jPill, { backgroundColor: '#FFF3F2', borderColor: RED }]}>
                              <Text style={[styles.jPillText, { color: RED }]}>Pending</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Transit connector */}
                    {!isLast && (
                      <View style={styles.jConnector}>
                        <View style={styles.jConnectorLeft}>
                          <View style={[styles.jConnectorLine, { backgroundColor: GRAY3 }]} />
                        </View>
                        <Text style={[styles.jConnectorText, { color: GRAY2 }]}>
                          {transit > 0 ? `${fmtMins(transit)} in transit` : '—'}
                        </Text>
                      </View>
                    )}
                  </React.Fragment>
                );
              })
            )}

            {/* View on Map button */}
            {locCount > 0 && (
              <TouchableOpacity
                style={[styles.mapBtn, { backgroundColor: WHITE, borderColor: GRAY3 }]}
                onPress={() => navigation.navigate('AdminTravelMap', {
                  userId: employee.id,
                  date: selectedDate,
                  employeeName: employee.name,
                })}
                activeOpacity={0.8}
              >
                <MaterialIcons name="map" size={15} color={BLACK} />
                <Text style={[styles.mapBtnText, { color: BLACK }]}>View on Map</Text>
                <MaterialIcons name="arrow-forward" size={14} color={GRAY} />
              </TouchableOpacity>
            )}
          </View>

          {/* STOPS section */}
          {stops.length > 0 && (
            <>
              <Text style={[styles.sectionHeader, { color: GRAY }]}>STOPS</Text>
              <View style={[styles.card, { backgroundColor: CARD }]}>
                <View style={styles.stopsRow}>
                  <View style={[styles.stopsDot, {
                    backgroundColor: pendingCount > 0 ? RED : GREEN,
                  }]} />
                  <Text style={[styles.stopsText, { color: BLACK }]}>
                    {stops.length} stop{stops.length !== 1 ? 's' : ''}
                    {pendingCount > 0 ? ` — ${pendingCount} pending` : ' — all responded'}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Empty state if no data at all */}
          {!login && stops.length === 0 && locCount === 0 && (
            <View style={styles.emptyState}>
              <MaterialIcons name="event-busy" size={36} color={GRAY2} />
              <Text style={[styles.emptyStateTitle, { color: BLACK }]}>No data for this day</Text>
              <Text style={[styles.emptyStateSub, { color: GRAY }]}>
                No login, stops, or GPS data was recorded.
              </Text>
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 56 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn:      { width: 36, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName:   { fontSize: 16, fontWeight: '700' },
  headerSub:    { fontSize: 12, fontWeight: '500', marginTop: 1 },

  dateNav: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1,
  },
  dateArrow:    { width: 48, alignItems: 'center', justifyContent: 'center' },
  dateLabelWrap:{ flex: 1, alignItems: 'center', gap: 4 },
  todayPill:    { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2 },
  todayPillText:{ fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  dateLabel:    { fontSize: 14, fontWeight: '700' },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 2,
  },
  card: { borderRadius: 14, padding: 16, marginBottom: 20 },

  // Login card
  loginRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loginTime:   { fontSize: 24, fontWeight: '800' },
  deadlineHint:{ fontSize: 12, fontWeight: '500', marginTop: 6, marginLeft: 32 },
  locRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 32 },
  locName:     { fontSize: 13, fontWeight: '600', flex: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeText:   { fontSize: 12, fontWeight: '700' },
  catPill:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  catPillText: { fontSize: 11, fontWeight: '700' },

  // Journey timeline
  jNode:       { flexDirection: 'row', minHeight: 60 },
  jNodeLeft:   { width: 36, alignItems: 'center' },
  jLineTop:    { flex: 1, width: 2, marginBottom: 0 },
  jDot: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center', zIndex: 1,
  },
  jLineBottom: { flex: 1, width: 2, marginTop: 0 },
  jNodeRight:  { flex: 1, paddingLeft: 12, paddingVertical: 6, justifyContent: 'center' },
  jTitle:      { fontSize: 14, fontWeight: '700' },
  jTime:       { fontSize: 12, fontWeight: '500', marginTop: 2 },
  jMeta:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  jDwell:      { fontSize: 12, fontWeight: '600' },
  jPill:       { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  jPillText:   { fontSize: 10, fontWeight: '700' },
  jConnector:     { flexDirection: 'row', minHeight: 32 },
  jConnectorLeft: { width: 36, alignItems: 'center' },
  jConnectorLine: { flex: 1, width: 2 },
  jConnectorText: { flex: 1, fontSize: 11, fontWeight: '500', paddingLeft: 12, alignSelf: 'center' },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16, paddingVertical: 11, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1,
  },
  mapBtnText: { fontSize: 13, fontWeight: '700', flex: 1 },

  // Stops summary
  stopsRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopsDot:  { width: 9, height: 9, borderRadius: 4.5 },
  stopsText: { fontSize: 14, fontWeight: '600', flex: 1 },

  // Empty state
  emptyText:       { fontSize: 14 },
  emptyState:      { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyStateTitle: { fontSize: 16, fontWeight: '700' },
  emptyStateSub:   { fontSize: 13, fontWeight: '500', textAlign: 'center' },
});
