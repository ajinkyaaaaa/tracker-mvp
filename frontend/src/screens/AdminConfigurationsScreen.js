// AdminConfigurationsScreen.js — Company-wide admin configuration settings
// Pushed from AdminSettingsScreen → navigate('AdminConfigurations').
//
// Data flows:
//   GET /api/settings/login-deadline          → api.getLoginDeadline()        → deadlineInput
//   PUT /api/settings/admin/login-deadline    → api.updateLoginDeadline()     → saveDeadline()
//   GET /api/settings/logout-time             → api.getLogoutTime()           → logoutInput
//   PUT /api/settings/admin/logout-time       → api.updateLogoutTime()        → saveLogout()
//   GET /api/settings/tracking-intervals      → api.getTrackingIntervals()    → interval inputs
//   PUT /api/settings/admin/tracking-intervals→ api.updateTrackingIntervals() → saveIntervals()
//
// All three settings load in parallel on mount via Promise.all.
// Each setting card has its own Save button and saving/success state.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native';
import { MaterialIcons }  from '@expo/vector-icons';
import { useTheme }       from '../contexts/ThemeContext';
import { api }            from '../services/api';

// Validates HH:MM format (00:00–23:59)
function isValidTime(str) {
  if (!/^\d{2}:\d{2}$/.test(str)) return false;
  const [h, m] = str.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// Renders a single settings card with title, optional description, content, and Save button
function SettingCard({ title, description, children, onSave, saving, BLACK, CARD, GRAY, GRAY3, WHITE }) {
  return (
    <View style={[cardStyles.card, { backgroundColor: CARD }]}>
      <Text style={[cardStyles.title, { color: BLACK }]}>{title}</Text>
      {description ? (
        <Text style={[cardStyles.desc, { color: GRAY }]}>{description}</Text>
      ) : null}
      <View style={cardStyles.content}>{children}</View>
      <TouchableOpacity
        style={[cardStyles.saveBtn, { backgroundColor: BLACK, opacity: saving ? 0.6 : 1 }]}
        onPress={onSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving ? (
          <ActivityIndicator color={WHITE} size="small" />
        ) : (
          <>
            <MaterialIcons name="check" size={16} color={WHITE} />
            <Text style={[cardStyles.saveBtnText, { color: WHITE }]}>Save</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card:       { borderRadius: 16, padding: 16, marginBottom: 20 },
  title:      { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  desc:       { fontSize: 13, fontWeight: '500', lineHeight: 18, marginBottom: 12 },
  content:    { marginBottom: 14 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 13,
  },
  saveBtnText: { fontSize: 14, fontWeight: '800' },
});


export default function AdminConfigurationsScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();

  const [loading, setLoading] = useState(true);

  const [deadlineInput,  setDeadlineInput]  = useState('09:00');
  const [deadlineSaving, setDeadlineSaving] = useState(false);

  const [logoutInput,  setLogoutInput]  = useState('18:00');
  const [logoutSaving, setLogoutSaving] = useState(false);

  const [activeInput,   setActiveInput]   = useState('30');
  const [idleInput,     setIdleInput]     = useState('300');
  const [intervalSaving, setIntervalSaving] = useState(false);

  // Load all three settings in parallel on mount
  useEffect(() => {
    Promise.all([
      api.getLoginDeadline(),
      api.getLogoutTime(),
      api.getTrackingIntervals(),
    ])
      .then(([deadlineData, logoutData, intervalData]) => {
        if (deadlineData?.login_deadline)  setDeadlineInput(deadlineData.login_deadline);
        if (logoutData?.logout_time)       setLogoutInput(logoutData.logout_time);
        if (intervalData?.interval_active !== undefined) setActiveInput(String(intervalData.interval_active));
        if (intervalData?.interval_idle   !== undefined) setIdleInput(String(intervalData.interval_idle));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Saves login deadline → PUT /api/settings/admin/login-deadline
  async function saveDeadline() {
    if (!isValidTime(deadlineInput)) {
      Alert.alert('Invalid time', 'Please enter a valid time in HH:MM format (e.g. 09:00).');
      return;
    }
    setDeadlineSaving(true);
    try {
      await api.updateLoginDeadline(deadlineInput);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not save login deadline.');
    }
    setDeadlineSaving(false);
  }

  // Saves auto-logout time → PUT /api/settings/admin/logout-time
  async function saveLogout() {
    if (!isValidTime(logoutInput)) {
      Alert.alert('Invalid time', 'Please enter a valid time in HH:MM format (e.g. 18:00).');
      return;
    }
    setLogoutSaving(true);
    try {
      await api.updateLogoutTime(logoutInput);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not save logout time.');
    }
    setLogoutSaving(false);
  }

  // Saves tracking intervals → PUT /api/settings/admin/tracking-intervals
  async function saveIntervals() {
    const active = parseInt(activeInput, 10);
    const idle   = parseInt(idleInput, 10);
    if (isNaN(active) || active < 1 || isNaN(idle) || idle < 1) {
      Alert.alert('Invalid intervals', 'Intervals must be positive numbers (in seconds).');
      return;
    }
    setIntervalSaving(true);
    try {
      await api.updateTrackingIntervals(active, idle);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not save tracking intervals.');
    }
    setIntervalSaving(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>
        <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: BLACK }]}>Configurations</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BLACK} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: BLACK }]}>Configurations</Text>
          <Text style={[styles.headerSub, { color: GRAY }]}>Settings apply to all users</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* LOGIN DEADLINE */}
        <SettingCard
          title="Login Deadline"
          description="Logins at or before this time are marked on time. After this time = late."
          onSave={saveDeadline}
          saving={deadlineSaving}
          BLACK={BLACK} CARD={CARD} GRAY={GRAY} GRAY3={GRAY3} WHITE={WHITE}
        >
          <TextInput
            style={[styles.input, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
            value={deadlineInput}
            onChangeText={setDeadlineInput}
            placeholder="HH:MM"
            placeholderTextColor={GRAY2}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
        </SettingCard>

        {/* AUTO-LOGOUT TIME */}
        <SettingCard
          title="Auto-Logout Time"
          description="All employees are automatically logged out at this time. Takes effect within 60 seconds."
          onSave={saveLogout}
          saving={logoutSaving}
          BLACK={BLACK} CARD={CARD} GRAY={GRAY} GRAY3={GRAY3} WHITE={WHITE}
        >
          <TextInput
            style={[styles.input, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
            value={logoutInput}
            onChangeText={setLogoutInput}
            placeholder="HH:MM"
            placeholderTextColor={GRAY2}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
        </SettingCard>

        {/* LOCATION PING INTERVALS */}
        <SettingCard
          title="Location Ping Intervals"
          description={
            `On the road (outside saved locations): ping every X seconds → smooth travel map\n` +
            `Parked (inside a saved location): ping every X seconds → saves battery\n\n` +
            `Takes effect when employees next open the app.`
          }
          onSave={saveIntervals}
          saving={intervalSaving}
          BLACK={BLACK} CARD={CARD} GRAY={GRAY} GRAY3={GRAY3} WHITE={WHITE}
        >
          <View style={styles.intervalRow}>
            <View style={styles.intervalField}>
              <Text style={[styles.intervalLabel, { color: GRAY }]}>On road (s)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
                value={activeInput}
                onChangeText={setActiveInput}
                placeholder="30"
                placeholderTextColor={GRAY2}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.intervalField}>
              <Text style={[styles.intervalLabel, { color: GRAY }]}>Parked (s)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: WHITE, color: BLACK, borderColor: GRAY3 }]}
                value={idleInput}
                onChangeText={setIdleInput}
                placeholder="300"
                placeholderTextColor={GRAY2}
                keyboardType="number-pad"
              />
            </View>
          </View>
        </SettingCard>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 48 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn:      { width: 36, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: 17, fontWeight: '700' },
  headerSub:    { fontSize: 12, fontWeight: '500', marginTop: 2 },

  input: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '600',
  },

  intervalRow:  { flexDirection: 'row', gap: 12 },
  intervalField:{ flex: 1, gap: 6 },
  intervalLabel:{ fontSize: 12, fontWeight: '700' },
});
