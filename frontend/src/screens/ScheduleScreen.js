// ScheduleScreen.js — Today's schedule (placeholder)
// Navigated to from MapScreen bottom action row → "Today's Schedule"

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export default function ScheduleScreen({ navigation }) {
  const { BG, BLACK, GRAY, GRAY3 } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: BG }]}>
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: BLACK }]}>Today's Schedule</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.empty}>
        <MaterialIcons name="calendar-today" size={52} color={GRAY} style={{ marginBottom: 18 }} />
        <Text style={[styles.emptyTitle, { color: BLACK }]}>Schedule coming soon</Text>
        <Text style={[styles.emptyHint, { color: GRAY }]}>Your daily schedule will appear here</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  back:  { width: 36, height: 36, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 40, paddingBottom: 80,
  },
  emptyTitle: { fontSize: 19, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  emptyHint:  { fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
