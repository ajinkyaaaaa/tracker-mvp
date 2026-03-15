// CalendarScreen.js — Month grid showing sync status per day
// Filled black dot = synced to server; hollow circle = local data not yet synced; none = no data.
// Tap a pending day → SyncScreen for that date.
//
// Data flows:
//   localDatabase.js → getSyncLog() / getPendingDays() → local dot status
//   api.getSyncStatus()                                → server-confirmed synced dates
//   Merge both → date→status map rendered as dots on the grid

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, ScrollView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { getSyncLog, getPendingDays } from '../services/localDatabase';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const CELL_SIZE = Math.floor((width - 32) / 7);

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY3 } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY3 });
  const today     = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth()); // 0-indexed
  const [dateMap, setDateMap] = useState({}); // { 'YYYY-MM-DD': 'synced' | 'pending' }
  const navAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    loadStatus();
  }, []);

  // Merges local sync log + server status into dateMap
  async function loadStatus() {
    const map = {};
    try {
      // Local pending days (have unsynced data)
      const pendingDays = await getPendingDays();
      for (const d of pendingDays) map[d] = 'pending';

      // Local sync log (days marked synced locally)
      const localLog = await getSyncLog();
      for (const row of localLog) {
        if (row.status === 'synced') map[row.date] = 'synced';
      }

      // Server-confirmed synced dates (authoritative)
      const serverLog = await api.getSyncStatus();
      for (const row of serverLog) {
        map[row.date] = 'synced';
      }
    } catch {}
    setDateMap(map);
  }

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else             { setMonth((m) => m - 1); }
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else              { setMonth((m) => m + 1); }
  }

  // Build grid: leading empty cells + day cells
  function buildGrid() {
    const firstDay    = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }

  function dateString(day) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  }

  function isToday(day) {
    return year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
  }

  function handleDayPress(day) {
    const ds     = dateString(day);
    const status = dateMap[ds];
    if (status === 'pending') navigation.navigate('Sync', { date: ds });
  }

  const cells   = buildGrid();
  const months  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <View style={styles.container}>

      {/* ── Back button ── */}
      <Animated.View style={[styles.header, { opacity: navAnim }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sync Calendar</Text>
        <View style={{ width: 40 }} />
      </Animated.View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Month navigation ── */}
        <View style={styles.monthRow}>
          <TouchableOpacity style={styles.monthArrow} onPress={prevMonth}>
            <Ionicons name="chevron-back" size={22} color={BLACK} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{months[month]} {year}</Text>
          <TouchableOpacity style={styles.monthArrow} onPress={nextMonth}>
            <Ionicons name="chevron-forward" size={22} color={BLACK} />
          </TouchableOpacity>
        </View>

        {/* ── Day-of-week header ── */}
        <View style={styles.dayLabelRow}>
          {DAY_LABELS.map((d) => (
            <View key={d} style={[styles.cell, styles.dayLabelCell]}>
              <Text style={styles.dayLabelText}>{d}</Text>
            </View>
          ))}
        </View>

        {/* ── Calendar grid ── */}
        <View style={styles.grid}>
          {cells.map((day, idx) => {
            if (!day) return <View key={`empty-${idx}`} style={styles.cell} />;

            const ds     = dateString(day);
            const status = dateMap[ds];
            const todayCell = isToday(day);

            return (
              <TouchableOpacity
                key={ds}
                style={[styles.cell, todayCell && styles.cellToday]}
                onPress={() => handleDayPress(day)}
                activeOpacity={status === 'pending' ? 0.6 : 1}
              >
                <Text style={[styles.dayNum, todayCell && styles.dayNumToday]}>{day}</Text>

                {/* Sync status dot */}
                {status === 'synced' && (
                  <View style={styles.dotSynced} />
                )}
                {status === 'pending' && (
                  <View style={styles.dotPending} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Legend ── */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.dotSynced} />
            <Text style={styles.legendText}>Synced</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.dotPending} />
            <Text style={styles.legendText}>Pending sync — tap to sync</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY3 }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16,
      borderBottomWidth: 1, borderColor: GRAY3,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: CARD, justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { color: BLACK, fontSize: 17, fontWeight: '800' },

    scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

    monthRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 20,
    },
    monthArrow: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: CARD, justifyContent: 'center', alignItems: 'center',
    },
    monthLabel: { color: BLACK, fontSize: 18, fontWeight: '800' },

    dayLabelRow: { flexDirection: 'row' },
    dayLabelCell:{ justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
    dayLabelText:{ color: GRAY, fontSize: 12, fontWeight: '700' },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },

    cell: {
      width: CELL_SIZE, height: CELL_SIZE,
      justifyContent: 'center', alignItems: 'center',
    },
    cellToday: {
      backgroundColor: CARD, borderRadius: CELL_SIZE / 2,
    },
    dayNum:      { color: BLACK, fontSize: 15, fontWeight: '600' },
    dayNumToday: { fontWeight: '900' },

    dotSynced: {
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: BLACK, marginTop: 3,
    },
    dotPending: {
      width: 6, height: 6, borderRadius: 3,
      borderWidth: 1.5, borderColor: BLACK, marginTop: 3,
      backgroundColor: 'transparent',
    },

    legend: {
      flexDirection: 'row', gap: 24, marginTop: 28, justifyContent: 'center',
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    legendText: { color: GRAY, fontSize: 13 },
  });
}
