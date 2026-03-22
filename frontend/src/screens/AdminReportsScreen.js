// AdminReportsScreen.js — Report generation and view screen (admin)
// Displayed as the "Reports" tab inside AdminTabs (App.js → AdminRoot).
//
// Data flows:
//   GET /api/admin/employees      → api.getEmployees()      → employee chip selector
//   GET /api/admin/report?...     → api.generateReport()    → report data
//
// Phase 1 (config): date range TextInputs + employee selector chips + Generate button.
// Phase 2 (report): collapsible employee sections with charts, stats, tables, share button.
//
// Charts are pure View-based (no external libraries):
//   - Login Punctuality: segmented horizontal pill bar
//   - Daily Travel: vertical bar chart (horizontal ScrollView if >14 days)
//   - Attendance: dot grid (flexWrap colored squares)

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, SafeAreaView, ActivityIndicator, Share, Animated,
} from 'react-native';
import { useFocusEffect }  from '@react-navigation/native';
import { MaterialIcons }   from '@expo/vector-icons';
import { useTheme }        from '../contexts/ThemeContext';
import { api }             from '../services/api';

const GREEN  = '#34C759';
const YELLOW = '#FFCC00';
const RED    = '#FF3B30';
const AMBER  = '#FFF8E1';
const AMBER_BORDER = '#FFD54F';

// Returns { start, end } as YYYY-MM-DD for the last 7 days (including today)
function getLast7Days() {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
  };
}

// Returns all YYYY-MM-DD strings between start and end inclusive
function dateRange(startStr, endStr) {
  const result = [];
  const cur    = new Date(startStr + 'T00:00:00');
  const last   = new Date(endStr   + 'T00:00:00');
  while (cur <= last) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// Formats a timestamp string to "HH:MM"
function fmtTime(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

// Formats YYYY-MM-DD to "21 Mar"
function fmtDate(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString('default', { day: 'numeric', month: 'short' });
}

// Formats a UTC timestamp string to "21 Mar 2026, 14:30"
function fmtGenerated(str) {
  if (!str) return '';
  return new Date(str).toLocaleString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Single-letter day label from a YYYY-MM-DD string
function dayLetter(dateStr) {
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(dateStr + 'T00:00:00').getDay()];
}

// Truncates a string to maxLen characters, appending '...' if needed
function trunc(str, maxLen) {
  if (!str) return '—';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

// Builds share text for one employee section
function buildShareText(emp, startDate, endDate, totalDays) {
  const kmTotal   = emp.daily_distances.reduce((s, d) => s + d.distance_km, 0);
  const pending   = (emp.stops || []).filter(s => s.status === 'pending').length;
  const onTimePct = emp.login_days.length > 0
    ? Math.round(emp.login_days.filter(l => l.on_time).length / emp.login_days.length * 100)
    : 0;

  let out = `\n=== ${emp.name} ===\n`;
  out += `Days Worked: ${emp.login_days.length} / ${totalDays}\n`;
  out += `Total Distance: ${kmTotal.toFixed(1)} km\n`;
  out += `Stops: ${emp.stops.length} (${pending} pending)\n`;
  out += `On Time: ${onTimePct}%\n`;
  out += `\nLOGIN LOG:\n`;
  for (const l of emp.login_days) {
    out += `${l.date} ${fmtTime(l.login_time)} ${l.on_time ? 'On Time' : 'Late'}\n`;
  }
  out += `\nSTOPS:\n`;
  for (const s of emp.stops) {
    out += `${s.triggered_at?.slice(0, 10) || ''} ${fmtTime(s.triggered_at)} ${s.dwell_duration ? s.dwell_duration + 'm' : ''} ${s.status} - ${trunc(s.response, 40)}\n`;
  }
  return out;
}


// ── Segmented Login Punctuality Bar ──────────────────────────────────────────
function PunctualityBar({ loginDays, totalDays }) {
  const onTime  = loginDays.filter(l => l.on_time).length;
  const late    = loginDays.filter(l => !l.on_time).length;
  const absent  = totalDays - loginDays.length;
  const tot     = totalDays || 1;

  const onTimePct  = onTime  / tot;
  const latePct    = late    / tot;
  const absentPct  = absent  / tot;

  return (
    <View style={barStyles.wrap}>
      <Text style={barStyles.title}>LOGIN PUNCTUALITY</Text>
      <View style={barStyles.bar}>
        {onTimePct > 0 && (
          <View style={[barStyles.seg, { flex: onTimePct, backgroundColor: GREEN,
            borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
            borderTopRightRadius: latePct === 0 && absentPct === 0 ? 10 : 0,
            borderBottomRightRadius: latePct === 0 && absentPct === 0 ? 10 : 0,
          }]} />
        )}
        {latePct > 0 && (
          <View style={[barStyles.seg, { flex: latePct, backgroundColor: YELLOW,
            borderTopLeftRadius: onTimePct === 0 ? 10 : 0,
            borderBottomLeftRadius: onTimePct === 0 ? 10 : 0,
            borderTopRightRadius: absentPct === 0 ? 10 : 0,
            borderBottomRightRadius: absentPct === 0 ? 10 : 0,
          }]} />
        )}
        {absentPct > 0 && (
          <View style={[barStyles.seg, { flex: absentPct, backgroundColor: '#C7C7CC',
            borderTopLeftRadius: onTimePct === 0 && latePct === 0 ? 10 : 0,
            borderBottomLeftRadius: onTimePct === 0 && latePct === 0 ? 10 : 0,
            borderTopRightRadius: 10, borderBottomRightRadius: 10,
          }]} />
        )}
      </View>
      <View style={barStyles.legend}>
        <View style={barStyles.legendItem}>
          <View style={[barStyles.legendDot, { backgroundColor: GREEN }]} />
          <Text style={barStyles.legendText}>On Time ({onTime})</Text>
        </View>
        <View style={barStyles.legendItem}>
          <View style={[barStyles.legendDot, { backgroundColor: YELLOW }]} />
          <Text style={barStyles.legendText}>Late ({late})</Text>
        </View>
        <View style={barStyles.legendItem}>
          <View style={[barStyles.legendDot, { backgroundColor: '#C7C7CC' }]} />
          <Text style={barStyles.legendText}>Absent ({absent})</Text>
        </View>
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  wrap:       { marginBottom: 16 },
  title:      { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#6D6D72', marginBottom: 8 },
  bar:        { height: 20, flexDirection: 'row', borderRadius: 10, overflow: 'hidden', backgroundColor: '#E5E5EA' },
  seg:        { height: 20 },
  legend:     { flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#6D6D72', fontWeight: '600' },
});


// ── Daily Distance Bar Chart ──────────────────────────────────────────────────
function DistanceChart({ dailyDistances }) {
  const MAX_BAR_H  = 80;
  const maxKm      = Math.max(...dailyDistances.map(d => d.distance_km), 0.1);
  const useScroll  = dailyDistances.length > 14;
  const BAR_W      = Math.max(24, Math.min(40, 300 / dailyDistances.length));

  const content = (
    <View style={distStyles.bars}>
      {dailyDistances.map((d, i) => {
        const h = Math.max(4, (d.distance_km / maxKm) * MAX_BAR_H);
        return (
          <View key={i} style={[distStyles.barCol, { width: BAR_W }]}>
            {d.distance_km > 0 && (
              <Text style={distStyles.barLabel}>{d.distance_km.toFixed(1)}</Text>
            )}
            <View style={[distStyles.bar, { height: h }]} />
            <Text style={distStyles.dayLabel}>{dayLetter(d.date)}</Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={distStyles.wrap}>
      <Text style={distStyles.title}>DAILY TRAVEL (KM)</Text>
      {useScroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}

const distStyles = StyleSheet.create({
  wrap:     { marginBottom: 16 },
  title:    { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#6D6D72', marginBottom: 8 },
  bars:     { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol:   { alignItems: 'center', gap: 3 },
  bar:      { backgroundColor: '#000000', borderRadius: 4, width: '70%' },
  barLabel: { fontSize: 9, color: '#6D6D72', fontWeight: '600' },
  dayLabel: { fontSize: 10, color: '#6D6D72', fontWeight: '700' },
});


// ── Attendance Dot Grid ────────────────────────────────────────────────────────
function AttendanceGrid({ loginDays, dates }) {
  const today      = new Date().toISOString().slice(0, 10);
  const loginMap   = {};
  for (const l of loginDays) loginMap[l.date] = l;

  return (
    <View style={gridStyles.wrap}>
      <Text style={gridStyles.title}>ATTENDANCE</Text>
      <View style={gridStyles.grid}>
        {dates.map((d) => {
          const login  = loginMap[d];
          const future = d > today;
          let bg;
          if (future)        bg = '#C7C7CC';
          else if (!login)   bg = RED;
          else if (login.on_time) bg = GREEN;
          else               bg = YELLOW;

          return (
            <View key={d} style={[gridStyles.dot, { backgroundColor: bg }]}>
              <Text style={gridStyles.dotNum}>{parseInt(d.slice(8), 10)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const gridStyles = StyleSheet.create({
  wrap:   { marginBottom: 16 },
  title:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#6D6D72', marginBottom: 8 },
  grid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  dot:    { width: 22, height: 22, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  dotNum: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
});


// ── Employee Report Section ───────────────────────────────────────────────────
function EmployeeSection({ emp, dates, BLACK, CARD, GRAY, GRAY2, GRAY3, WHITE }) {
  const [expanded, setExpanded] = useState(true);

  const totalDays  = dates.length;
  const worked     = emp.login_days.length;
  const kmTotal    = emp.daily_distances.reduce((s, d) => s + d.distance_km, 0);
  const pending    = (emp.stops || []).filter(s => s.status === 'pending').length;
  const onTimePct  = worked > 0
    ? Math.round(emp.login_days.filter(l => l.on_time).length / worked * 100)
    : 0;

  return (
    <View style={[empStyles.section, { backgroundColor: CARD }]}>

      {/* Collapse header */}
      <TouchableOpacity
        style={empStyles.sectionHeader}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.75}
      >
        <Text style={[empStyles.empName, { color: BLACK }]}>{emp.name}</Text>
        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={22} color={GRAY}
        />
      </TouchableOpacity>

      {expanded && (
        <>
          {/* Summary pills */}
          <View style={empStyles.pills}>
            <View style={[empStyles.pill, { backgroundColor: WHITE }]}>
              <Text style={[empStyles.pillVal, { color: BLACK }]}>{worked}/{totalDays}</Text>
              <Text style={[empStyles.pillLabel, { color: GRAY }]}>Days</Text>
            </View>
            <View style={[empStyles.pill, { backgroundColor: WHITE }]}>
              <Text style={[empStyles.pillVal, { color: BLACK }]}>{kmTotal.toFixed(1)}</Text>
              <Text style={[empStyles.pillLabel, { color: GRAY }]}>km</Text>
            </View>
            <View style={[empStyles.pill, { backgroundColor: WHITE }]}>
              <Text style={[empStyles.pillVal, { color: BLACK }]}>{emp.stops.length}</Text>
              <Text style={[empStyles.pillLabel, { color: GRAY }]}>Stops</Text>
            </View>
            <View style={[empStyles.pill, { backgroundColor: WHITE }]}>
              <Text style={[empStyles.pillVal, { color: BLACK }]}>{onTimePct}%</Text>
              <Text style={[empStyles.pillLabel, { color: GRAY }]}>On Time</Text>
            </View>
          </View>

          {/* Punctuality bar */}
          <PunctualityBar loginDays={emp.login_days} totalDays={totalDays} />

          {/* Distance chart */}
          <DistanceChart dailyDistances={emp.daily_distances} />

          {/* Attendance grid */}
          <AttendanceGrid loginDays={emp.login_days} dates={dates} />

          {/* Unsynced disclaimer */}
          {emp.unsynced_dates.length > 0 && (
            <View style={[empStyles.unsyncedCard, { borderColor: AMBER_BORDER }]}>
              <MaterialIcons name="warning-amber" size={16} color="#B8860B" />
              <Text style={empStyles.unsyncedText}>
                Data may be incomplete for {emp.unsynced_dates.length} day(s) — sync records are missing for{' '}
                {emp.unsynced_dates.slice(0, 5).join(', ')}{emp.unsynced_dates.length > 5 ? '...' : ''}.
                {' '}This means location and activity data for those days may not yet be available.
              </Text>
            </View>
          )}

          {/* Login log table */}
          {emp.login_days.length > 0 && (
            <>
              <Text style={[empStyles.detailLabel, { color: GRAY }]}>LOGIN LOG</Text>
              <View style={[empStyles.table, { backgroundColor: WHITE, borderColor: GRAY3 }]}>
                <View style={[empStyles.tableRow, empStyles.tableHead, { borderBottomColor: GRAY3 }]}>
                  <Text style={[empStyles.thDate, { color: GRAY }]}>Date</Text>
                  <Text style={[empStyles.thTime, { color: GRAY }]}>Time</Text>
                  <Text style={[empStyles.thStatus, { color: GRAY }]}>Status</Text>
                  <Text style={[empStyles.thLoc, { color: GRAY }]}>Location</Text>
                </View>
                {emp.login_days.map((l, i) => (
                  <View
                    key={i}
                    style={[empStyles.tableRow, i < emp.login_days.length - 1 && { borderBottomWidth: 1, borderBottomColor: GRAY3 }]}
                  >
                    <Text style={[empStyles.tdDate, { color: BLACK }]}>{fmtDate(l.date)}</Text>
                    <Text style={[empStyles.tdTime, { color: BLACK }]}>{fmtTime(l.login_time)}</Text>
                    <Text style={[empStyles.tdStatus, { color: l.on_time ? GREEN : '#B8860B' }]}>
                      {l.on_time ? 'On Time' : 'Late'}
                    </Text>
                    <Text style={[empStyles.tdLoc, { color: GRAY }]} numberOfLines={1}>
                      {trunc(l.location_name, 18)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Stops table */}
          {emp.stops.length > 0 && (
            <>
              <Text style={[empStyles.detailLabel, { color: GRAY }]}>STOPS</Text>
              <View style={[empStyles.table, { backgroundColor: WHITE, borderColor: GRAY3 }]}>
                <View style={[empStyles.tableRow, empStyles.tableHead, { borderBottomColor: GRAY3 }]}>
                  <Text style={[empStyles.thDate, { color: GRAY }]}>Date</Text>
                  <Text style={[empStyles.thTime, { color: GRAY }]}>Time</Text>
                  <Text style={[empStyles.thDwell, { color: GRAY }]}>Dwell</Text>
                  <Text style={[empStyles.thStatus, { color: GRAY }]}>Status</Text>
                  <Text style={[empStyles.tdResp, { color: GRAY }]}>Response</Text>
                </View>
                {emp.stops.map((s, i) => (
                  <View
                    key={i}
                    style={[empStyles.tableRow, i < emp.stops.length - 1 && { borderBottomWidth: 1, borderBottomColor: GRAY3 }]}
                  >
                    <Text style={[empStyles.thDate, { color: BLACK }]}>
                      {fmtDate(s.triggered_at?.slice(0, 10) || '')}
                    </Text>
                    <Text style={[empStyles.thTime, { color: BLACK }]}>{fmtTime(s.triggered_at)}</Text>
                    <Text style={[empStyles.thDwell, { color: GRAY }]}>
                      {s.dwell_duration ? `${s.dwell_duration}m` : '—'}
                    </Text>
                    <Text style={[empStyles.thStatus, { color: s.status === 'pending' ? RED : GREEN }]}>
                      {s.status === 'pending' ? 'Pending' : 'Done'}
                    </Text>
                    <Text style={[empStyles.tdResp, { color: GRAY }]} numberOfLines={1}>
                      {trunc(s.response, 40)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

const empStyles = StyleSheet.create({
  section:       { borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  empName:       { fontSize: 17, fontWeight: '800' },
  pills:         { flexDirection: 'row', gap: 8, marginBottom: 16 },
  pill:          { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 2 },
  pillVal:       { fontSize: 18, fontWeight: '800' },
  pillLabel:     { fontSize: 10, fontWeight: '700' },
  detailLabel:   { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  table:         { borderRadius: 10, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  tableHead:     { borderBottomWidth: 1 },
  tableRow:      { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  thDate:        { width: 56, fontSize: 11, fontWeight: '700' },
  thTime:        { width: 48, fontSize: 11, fontWeight: '700' },
  thStatus:      { width: 52, fontSize: 11, fontWeight: '700' },
  thLoc:         { flex: 1, fontSize: 11, fontWeight: '700' },
  thDwell:       { width: 40, fontSize: 11, fontWeight: '700' },
  tdDate:        { width: 56, fontSize: 11 },
  tdTime:        { width: 48, fontSize: 11 },
  tdStatus:      { width: 52, fontSize: 11, fontWeight: '700' },
  tdLoc:         { flex: 1, fontSize: 11 },
  tdResp:        { flex: 1, fontSize: 11 },
  unsyncedCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: AMBER, borderWidth: 1, borderRadius: 10,
    padding: 10, marginBottom: 12,
  },
  unsyncedText: { flex: 1, fontSize: 12, color: '#7A5C00', fontWeight: '500', lineHeight: 17 },
});


// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AdminReportsScreen() {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();

  const defaultRange = getLast7Days();
  const [phase,       setPhase]       = useState('config');  // 'config' | 'report'
  const [startDate,   setStartDate]   = useState(defaultRange.start);
  const [endDate,     setEndDate]     = useState(defaultRange.end);
  const [employees,   setEmployees]   = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);  // empty = all
  const [allSelected, setAllSelected] = useState(true);
  const [generating,  setGenerating]  = useState(false);
  const [report,      setReport]      = useState(null);

  // Load employee list on focus
  useFocusEffect(
    useCallback(() => {
      api.getEmployees()
        .then(data => setEmployees(data))
        .catch(() => {});
    }, [])
  );

  // Toggle a single employee chip in the selector
  function toggleEmployee(id) {
    if (allSelected) {
      setAllSelected(false);
      setSelectedIds([id]);
      return;
    }
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  // Toggles "All" chip — selects all employees
  function toggleAll() {
    setAllSelected(true);
    setSelectedIds([]);
  }

  // Calls /api/admin/report and transitions to report phase
  async function handleGenerateReport() {
    setGenerating(true);
    try {
      const ids  = allSelected ? employees.map(e => e.id) : selectedIds;
      const data = await api.generateReport(ids, startDate, endDate);
      setReport(data);
      setPhase('report');
    } catch (e) {
      // Keep user in config on error
    }
    setGenerating(false);
  }

  // Builds and triggers the native Share sheet
  async function handleShare() {
    if (!report) return;
    const totalDays = dateRange(report.start_date, report.end_date).length;
    let text = `VISPL REPORT\nPeriod: ${report.start_date} to ${report.end_date}\nGenerated: ${fmtGenerated(report.generated_at)}\n`;
    for (const emp of report.employees) {
      text += buildShareText(emp, report.start_date, report.end_date, totalDays);
    }
    try { await Share.share({ message: text }); } catch {}
  }

  const configValid = startDate.length === 10 && endDate.length === 10 && startDate <= endDate;

  if (phase === 'report' && report) {
    const dates = dateRange(report.start_date, report.end_date);
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>
        {/* Sticky header */}
        <View style={[styles.reportHeader, { borderBottomColor: GRAY3, backgroundColor: BG }]}>
          <TouchableOpacity style={styles.backToConfig} onPress={() => setPhase('config')}>
            <MaterialIcons name="arrow-back-ios" size={16} color={BLACK} />
            <Text style={[styles.backToConfigText, { color: BLACK }]}>Config</Text>
          </TouchableOpacity>
          <Text style={[styles.reportTitle, { color: BLACK }]}>Report</Text>
          <TouchableOpacity onPress={handleShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="share" size={22} color={BLACK} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Metadata */}
          <View style={[styles.metaCard, { backgroundColor: CARD }]}>
            <Text style={[styles.metaRange, { color: BLACK }]}>
              {fmtDate(report.start_date)} — {fmtDate(report.end_date)}
            </Text>
            <Text style={[styles.metaSub, { color: GRAY }]}>
              Generated {fmtGenerated(report.generated_at)} · {report.employees.length} employee{report.employees.length !== 1 ? 's' : ''}
            </Text>
          </View>

          {/* Employee sections */}
          {report.employees.map((emp) => (
            <EmployeeSection
              key={emp.id}
              emp={emp}
              dates={dates}
              BLACK={BLACK} CARD={CARD} GRAY={GRAY}
              GRAY2={GRAY2} GRAY3={GRAY3} WHITE={WHITE}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Config phase ──
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <Text style={[styles.headerTitle, { color: BLACK }]}>Reports</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Date range card */}
        <Text style={[styles.sectionHeader, { color: GRAY }]}>DATE RANGE</Text>
        <View style={[styles.card, { backgroundColor: CARD }]}>
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={[styles.dateFieldLabel, { color: GRAY }]}>From</Text>
              <TextInput
                style={[styles.dateInput, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={GRAY2}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <MaterialIcons name="arrow-forward" size={18} color={GRAY2} style={{ marginTop: 22 }} />
            <View style={styles.dateField}>
              <Text style={[styles.dateFieldLabel, { color: GRAY }]}>To</Text>
              <TextInput
                style={[styles.dateInput, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={GRAY2}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          </View>
        </View>

        {/* Employee selector card */}
        <Text style={[styles.sectionHeader, { color: GRAY }]}>EMPLOYEES</Text>
        <View style={[styles.card, { backgroundColor: CARD }]}>
          <View style={styles.chipWrap}>
            {/* All chip */}
            <TouchableOpacity
              style={[styles.chip, allSelected && { backgroundColor: BLACK }]}
              onPress={toggleAll}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, { color: allSelected ? WHITE : BLACK }]}>All</Text>
            </TouchableOpacity>

            {/* Individual employee chips */}
            {employees.map((e) => {
              const selected = !allSelected && selectedIds.includes(e.id);
              return (
                <TouchableOpacity
                  key={e.id}
                  style={[styles.chip, selected && { backgroundColor: BLACK }]}
                  onPress={() => toggleEmployee(e.id)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, { color: selected ? WHITE : BLACK }]}>
                    {e.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Generate button */}
        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: BLACK, opacity: configValid && !generating ? 1 : 0.4 }]}
          onPress={handleGenerateReport}
          disabled={!configValid || generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color={WHITE} size="small" />
          ) : (
            <>
              <MaterialIcons name="insert-chart" size={18} color={WHITE} />
              <Text style={[styles.generateBtnText, { color: WHITE }]}>Generate Report</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },

  header: {
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '800' },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 2,
  },
  card: { borderRadius: 16, padding: 16, marginBottom: 20 },

  dateRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateField:     { flex: 1, gap: 5 },
  dateFieldLabel:{ fontSize: 12, fontWeight: '700' },
  dateInput: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontWeight: '600',
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#E5E5EA',
  },
  chipText: { fontSize: 13, fontWeight: '700' },

  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16, marginTop: 4,
  },
  generateBtnText: { fontSize: 16, fontWeight: '800' },

  // Report view header
  reportHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backToConfig:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backToConfigText: { fontSize: 14, fontWeight: '600' },
  reportTitle:      { fontSize: 17, fontWeight: '700' },

  // Report metadata card
  metaCard:  { borderRadius: 14, padding: 14, marginBottom: 16 },
  metaRange: { fontSize: 17, fontWeight: '800' },
  metaSub:   { fontSize: 13, fontWeight: '500', marginTop: 3 },
});
