// LoginCalendarModal.js — Modal showing a month calendar of login/logout sessions
// Opened by the "i" button in MapScreen.js login widget.
// Data flow: api.getLoginHistory() → GET /api/sync/login-history → [{login_time, logout_time}]

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';

const { width } = Dimensions.get('window');
const CELL = Math.floor((width - 80) / 7);

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseTS(ts) {
  if (!ts) return null;
  return new Date(ts.includes('T') || ts.includes('Z') ? ts : ts.replace(' ', 'T') + 'Z');
}
function fmt(ts, opts) {
  const d = parseTS(ts);
  return d ? d.toLocaleTimeString([], opts) : '';
}

export default function LoginCalendarModal({ visible, onClose }) {
  const today = new Date();
  const [year,     setYear]     = useState(today.getFullYear());
  const [month,    setMonth]    = useState(today.getMonth());
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null); // 'YYYY-MM-DD'

  useEffect(() => {
    if (visible) {
      setSelected(null);
      loadHistory();
    }
  }, [visible]);

  async function loadHistory() {
    try { setSessions(await api.getLoginHistory()); } catch {}
  }

  // Build date → [{login_time, logout_time}] lookup
  const dateMap = {};
  for (const s of sessions) {
    const d = parseTS(s.login_time);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    if (!dateMap[key]) dateMap[key] = [];
    dateMap[key].push(s);
  }

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else             { setMonth((m) => m - 1); }
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else              { setMonth((m) => m + 1); }
  }

  function buildGrid() {
    const firstDay    = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }

  function ds(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const cells           = buildGrid();
  const todayStr        = today.toISOString().slice(0, 10);
  const selectedSessions = selected ? (dateMap[selected] || []) : [];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        <View style={s.sheet}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>Login History</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={16} color={BLACK} />
            </TouchableOpacity>
          </View>

          {/* Month nav */}
          <View style={s.monthRow}>
            <TouchableOpacity style={s.arrow} onPress={prevMonth}>
              <Ionicons name="chevron-back" size={16} color={BLACK} />
            </TouchableOpacity>
            <Text style={s.monthLabel}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity style={s.arrow} onPress={nextMonth}>
              <Ionicons name="chevron-forward" size={16} color={BLACK} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week row */}
          <View style={s.row}>
            {DAY_LABELS.map((d, i) => (
              <View key={i} style={s.cell}>
                <Text style={s.dayLabel}>{d}</Text>
              </View>
            ))}
          </View>

          {/* Date grid */}
          <View style={s.grid}>
            {cells.map((day, idx) => {
              if (!day) return <View key={`e-${idx}`} style={s.cell} />;
              const key    = ds(day);
              const hasDot = !!dateMap[key];
              const isSel  = selected === key;
              const isToday = key === todayStr;
              return (
                <TouchableOpacity
                  key={key}
                  style={[s.cell, isSel && s.cellSel, isToday && !isSel && s.cellToday]}
                  onPress={() => hasDot && setSelected(isSel ? null : key)}
                  activeOpacity={hasDot ? 0.6 : 1}
                >
                  <Text style={[s.dayNum, isSel && s.dayNumSel]}>{day}</Text>
                  {hasDot && <View style={[s.dot, isSel && s.dotSel]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Session detail */}
          {selected && (
            <View style={s.detail}>
              <Text style={s.detailDate}>
                {parseTS(selected + 'T00:00:00')?.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
              {selectedSessions.length === 0 ? (
                <Text style={s.detailEmpty}>No sessions</Text>
              ) : (
                selectedSessions.map((sess, i) => (
                  <View key={i} style={s.sessRow}>
                    <View style={s.sessBlock}>
                      <Text style={s.sessMeta}>Login</Text>
                      <Text style={s.sessTime}>{fmt(sess.login_time, { hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                    {sess.logout_time && (
                      <View style={s.sessBlock}>
                        <Text style={s.sessMeta}>Logout</Text>
                        <Text style={s.sessTime}>{fmt(sess.logout_time, { hour: '2-digit', minute: '2-digit' })}</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44,
    borderTopWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.07, shadowRadius: 16, elevation: 12,
  },
  handle: { width: 36, height: 4, backgroundColor: GRAY2, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },

  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:    { color: BLACK, fontSize: 17, fontWeight: '800' },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: CARD, justifyContent: 'center', alignItems: 'center' },

  monthRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  arrow:      { width: 30, height: 30, borderRadius: 15, backgroundColor: CARD, justifyContent: 'center', alignItems: 'center' },
  monthLabel: { color: BLACK, fontSize: 14, fontWeight: '800' },

  row:  { flexDirection: 'row', marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: CELL, justifyContent: 'center', alignItems: 'center' },

  cellSel:   { backgroundColor: BLACK, borderRadius: CELL / 2 },
  cellToday: { backgroundColor: CARD,  borderRadius: CELL / 2 },

  dayLabel:  { color: GRAY2, fontSize: 10, fontWeight: '700' },
  dayNum:    { color: BLACK, fontSize: 13, fontWeight: '500' },
  dayNumSel: { color: WHITE, fontWeight: '800' },

  dot:    { width: 4, height: 4, borderRadius: 2, backgroundColor: BLACK, marginTop: 2 },
  dotSel: { backgroundColor: WHITE },

  detail: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: GRAY3 },
  detailDate:  { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  detailEmpty: { color: GRAY2, fontSize: 13 },

  sessRow:   { flexDirection: 'row', gap: 40, paddingVertical: 8, borderTopWidth: 1, borderColor: GRAY3 },
  sessBlock: {},
  sessMeta:  { color: GRAY,  fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  sessTime:  { color: BLACK, fontSize: 18, fontWeight: '800', marginTop: 2 },
});
