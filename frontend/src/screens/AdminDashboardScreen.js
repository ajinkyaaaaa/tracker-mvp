// AdminDashboardScreen.js — Fleet management for admin users
// Three tabs:
//   Live View   — real-time employee map, updated via WebSocket + 15 s polling
//   History tab — date + employee selector; shows GPS trail + activity markers
//   Settings    — company-wide config (login deadline, logout time)
//
// Data flows:
//   WebSocket "employee-location" (app.py → handle_location_update) → live map markers
//   GET /api/admin/live                              → loadLiveEmployees() (polled every 15 s)
//   GET /api/admin/employees                         → loadEmployees()    → chip selector
//   GET /api/admin/employee/:id/locations/:date      → loadHistory()      → Polyline
//   GET /api/admin/employee/:id/activities/:date     → loadHistory()      → red pin markers
//   GET /api/settings/login-deadline                 → loadSettings()     → Settings tab
//   PUT /api/admin/settings/login-deadline           → saveDeadline()     → Settings tab
//   GET /api/settings/logout-time                    → loadSettings()     → Settings tab
//   PUT /api/admin/settings/logout-time              → saveLogoutTime()   → Settings tab

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Platform, TextInput, Alert,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, BASE_URL } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

const SOCKET_URL = BASE_URL.replace('/api', '');

const RED   = '#FF3B30';

export default function AdminDashboardScreen() {
  const { logout } = useAuth();
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });
  const [tab,               setTab]               = useState('live');
  const [liveEmployees,     setLiveEmployees]     = useState([]);
  const [employees,         setEmployees]         = useState([]);
  const [selectedEmployee,  setSelectedEmployee]  = useState(null);
  const [selectedDate,      setSelectedDate]      = useState(new Date().toISOString().split('T')[0]);
  const [historyPath,       setHistoryPath]       = useState([]);
  const [historyActivities, setHistoryActivities] = useState([]);
  const [deadlineInput,        setDeadlineInput]        = useState('09:00');
  const [deadlineSaving,       setDeadlineSaving]       = useState(false);
  const [logoutTimeInput,      setLogoutTimeInput]      = useState('18:00');
  const [logoutTimeSaving,     setLogoutTimeSaving]     = useState(false);
  const [trackingActiveInput,  setTrackingActiveInput]  = useState('3');   // seconds outside geofence
  const [trackingIdleInput,    setTrackingIdleInput]    = useState('30');  // seconds inside geofence
  const [trackingIntervalSaving, setTrackingIntervalSaving] = useState(false);
  const socketRef = useRef(null);
  const mapRef    = useRef(null);

  useEffect(() => {
    connectSocket();
    loadEmployees();
    loadLiveEmployees();
    loadSettings();
    const interval = setInterval(loadLiveEmployees, 15000);
    return () => {
      clearInterval(interval);
      socketRef.current?.disconnect();
    };
  }, []);

  async function connectSocket() {
    const token  = await AsyncStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('employee-location', (data) => {
      setLiveEmployees((prev) => {
        const idx     = prev.findIndex((e) => e.id === data.userId);
        const updated = { id: data.userId, name: data.name, latitude: data.latitude, longitude: data.longitude, is_online: 1 };
        if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...updated }; return copy; }
        return [...prev, updated];
      });
    });
    socketRef.current = socket;
  }

  async function loadEmployees() {
    try { const data = await api.getEmployees(); setEmployees(data); } catch {}
  }

  async function loadLiveEmployees() {
    try { const data = await api.getLiveEmployees(); setLiveEmployees(data); } catch {}
  }

  async function loadHistory() {
    if (!selectedEmployee) { Alert.alert('Select', 'Please select an employee first'); return; }
    try {
      const [locations, activities] = await Promise.all([
        api.getEmployeeLocations(selectedEmployee.id, selectedDate),
        api.getEmployeeActivities(selectedEmployee.id, selectedDate),
      ]);
      setHistoryPath(locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude })));
      setHistoryActivities(activities);
      if (locations.length > 0 && mapRef.current) {
        mapRef.current.animateToRegion({ latitude: locations[0].latitude, longitude: locations[0].longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 });
      }
    } catch (err) { Alert.alert('Error', err.message); }
  }

  // Fetches current settings from server → Settings tab initial values
  async function loadSettings() {
    try {
      const [{ login_deadline }, { logout_time }, { interval_active, interval_idle }] = await Promise.all([
        api.getLoginDeadline(),
        api.getLogoutTime(),
        api.getTrackingIntervals(),
      ]);
      if (login_deadline)  setDeadlineInput(login_deadline);
      if (logout_time)     setLogoutTimeInput(logout_time);
      if (interval_active) setTrackingActiveInput(String(interval_active));
      if (interval_idle)   setTrackingIdleInput(String(interval_idle));
    } catch {}
  }

  // Saves updated login deadline → PUT /api/admin/settings/login-deadline
  async function saveDeadline() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deadlineInput.trim())) {
      Alert.alert('Invalid Time', 'Please enter a valid time in HH:MM format (e.g. 09:00)');
      return;
    }
    setDeadlineSaving(true);
    try {
      await api.updateLoginDeadline(deadlineInput.trim());
      Alert.alert('Saved', `Login deadline updated to ${deadlineInput.trim()}`);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setDeadlineSaving(false);
    }
  }

  // Saves tracking ping intervals → PUT /api/admin/settings/tracking-intervals
  // active = seconds between pings when outside all geofences (road tracking)
  // idle   = seconds between pings when inside a saved-location geofence (parked)
  async function saveTrackingIntervals() {
    const active = parseInt(trackingActiveInput);
    const idle   = parseInt(trackingIdleInput);
    if (!active || active < 1 || !idle || idle < 1) {
      Alert.alert('Invalid', 'Both intervals must be positive whole numbers (seconds).');
      return;
    }
    setTrackingIntervalSaving(true);
    try {
      await api.updateTrackingIntervals(active, idle);
      Alert.alert('Saved', `Tracking: ${active}s outside geofence, ${idle}s inside geofence.\nTakes effect on next employee app open.`);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setTrackingIntervalSaving(false);
    }
  }

  // Saves updated logout time → PUT /api/admin/settings/logout-time
  // All logged-in employees will be auto-logged out at this time (polled every 60 s by AuthContext)
  async function saveLogoutTime() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(logoutTimeInput.trim())) {
      Alert.alert('Invalid Time', 'Please enter a valid time in HH:MM format (e.g. 18:00)');
      return;
    }
    setLogoutTimeSaving(true);
    try {
      await api.updateLogoutTime(logoutTimeInput.trim());
      Alert.alert('Saved', `Auto-logout time updated to ${logoutTimeInput.trim()}`);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLogoutTimeSaving(false);
    }
  }

  return (
    <View style={styles.container}>

      {/* ── Tab bar ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'live' && styles.tabActive]}
          onPress={() => setTab('live')}
        >
          <Text style={[styles.tabText, tab === 'live' && styles.tabTextActive]}>Live View</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'history' && styles.tabActive]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'settings' && styles.tabActive]}
          onPress={() => setTab('settings')}
        >
          <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {tab === 'settings' ? (
        /* ── SETTINGS ── */
        <View style={styles.settingsPanel}>
          <Text style={styles.settingsTitle}>Company Settings</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>LOGIN DEADLINE</Text>
              <Text style={styles.settingDesc}>
                Logins at or before this time are marked green (on time / early).
                Logins after this time are marked yellow (late).
              </Text>
            </View>
            <View style={styles.settingControl}>
              <TextInput
                style={styles.timeInput}
                value={deadlineInput}
                onChangeText={setDeadlineInput}
                placeholder="09:00"
                placeholderTextColor={GRAY2}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <TouchableOpacity
                style={[styles.saveBtn, deadlineSaving && styles.saveBtnDisabled]}
                onPress={saveDeadline}
                disabled={deadlineSaving}
              >
                <Text style={styles.saveBtnText}>{deadlineSaving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingDivider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>AUTO-LOGOUT TIME</Text>
              <Text style={styles.settingDesc}>
                All employees are automatically logged out at this time.
                Changes take effect within 60 seconds for active sessions.
              </Text>
            </View>
            <View style={styles.settingControl}>
              <TextInput
                style={styles.timeInput}
                value={logoutTimeInput}
                onChangeText={setLogoutTimeInput}
                placeholder="18:00"
                placeholderTextColor={GRAY2}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <TouchableOpacity
                style={[styles.saveBtn, logoutTimeSaving && styles.saveBtnDisabled]}
                onPress={saveLogoutTime}
                disabled={logoutTimeSaving}
              >
                <Text style={styles.saveBtnText}>{logoutTimeSaving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingDivider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>LOCATION PING INTERVALS</Text>
              <Text style={styles.settingDesc}>
                On the road (outside all geofences): ping every N seconds for accurate travel logs.{'\n'}
                Parked (inside a saved location): ping every N seconds to save battery.{'\n'}
                Takes effect on next employee app open.
              </Text>
            </View>
            <View style={[styles.settingControl, { gap: 8 }]}>
              <View style={styles.intervalRow}>
                <Text style={[styles.intervalLabel, { color: GRAY }]}>On road (s)</Text>
                <TextInput
                  style={styles.intervalInput}
                  value={trackingActiveInput}
                  onChangeText={setTrackingActiveInput}
                  placeholder="3"
                  placeholderTextColor={GRAY2}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
              <View style={styles.intervalRow}>
                <Text style={[styles.intervalLabel, { color: GRAY }]}>Parked (s)</Text>
                <TextInput
                  style={styles.intervalInput}
                  value={trackingIdleInput}
                  onChangeText={setTrackingIdleInput}
                  placeholder="30"
                  placeholderTextColor={GRAY2}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
              <TouchableOpacity
                style={[styles.saveBtn, trackingIntervalSaving && styles.saveBtnDisabled]}
                onPress={saveTrackingIntervals}
                disabled={trackingIntervalSaving}
              >
                <Text style={styles.saveBtnText}>{trackingIntervalSaving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : tab === 'live' ? (
        /* ── LIVE VIEW ── */
        <View style={styles.content}>
          <MapView
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{ latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
          >
            {liveEmployees
              .filter((e) => e.latitude && e.longitude)
              .map((emp) => (
                <Marker
                  key={emp.id}
                  coordinate={{ latitude: emp.latitude, longitude: emp.longitude }}
                  title={emp.name}
                  pinColor="#000000"
                />
              ))}
          </MapView>

          <View style={styles.onlineCount}>
            <Text style={styles.onlineCountText}>{liveEmployees.length} Online</Text>
          </View>
        </View>
      ) : (
        /* ── HISTORY VIEW ── */
        <View style={styles.content}>
          {/* Employee selector */}
          <View style={styles.selectorBar}>
            <FlatList
              horizontal
              data={employees}
              keyExtractor={(e) => e.id.toString()}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.empChip, selectedEmployee?.id === item.id && styles.empChipActive]}
                  onPress={() => setSelectedEmployee(item)}
                >
                  <Text style={[styles.empChipText, selectedEmployee?.id === item.id && styles.empChipTextActive]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          {/* Date input & load */}
          <View style={styles.dateBar}>
            <TextInput
              style={styles.dateInput}
              value={selectedDate}
              onChangeText={setSelectedDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={GRAY2}
            />
            <TouchableOpacity style={styles.loadBtn} onPress={loadHistory}>
              <Text style={styles.loadBtnText}>Load</Text>
            </TouchableOpacity>
          </View>

          {/* History map */}
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{ latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
          >
            {historyPath.length > 1 && (
              <Polyline coordinates={historyPath} strokeColor={BLACK} strokeWidth={4} />
            )}
            {historyActivities.map((a) => (
              <Marker
                key={a.id}
                coordinate={{ latitude: a.latitude, longitude: a.longitude }}
                title={a.description}
                description={new Date(a.triggered_at).toLocaleTimeString()}
                pinColor={RED}
              />
            ))}
          </MapView>
        </View>
      )}
    </View>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    tabBar: {
      flexDirection: 'row',
      paddingTop: 60,
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 8,
      alignItems: 'center',
      backgroundColor: WHITE,
      borderBottomWidth: 1,
      borderBottomColor: GRAY3,
    },
    tab: {
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 10,
      backgroundColor: CARD,
    },
    tabActive:     { backgroundColor: BLACK },
    tabText:       { color: GRAY,  fontWeight: '700', fontSize: 14 },
    tabTextActive: { color: WHITE },

    logoutBtn:     { marginLeft: 'auto' },
    logoutBtnText: { color: RED, fontSize: 13, fontWeight: '700' },

    content: { flex: 1 },
    map:     { flex: 1 },

    onlineCount: {
      position: 'absolute',
      top: 12, right: 16,
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8,
      borderWidth: 1, borderColor: GRAY3,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
    },
    onlineCountText: { color: BLACK, fontWeight: '700', fontSize: 14 },

    selectorBar: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: WHITE,
      borderBottomWidth: 1,
      borderBottomColor: GRAY3,
    },
    empChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: CARD,
      marginRight: 8,
      borderWidth: 1,
      borderColor: GRAY3,
    },
    empChipActive:     { backgroundColor: BLACK, borderColor: BLACK },
    empChipText:       { color: GRAY,  fontWeight: '600', fontSize: 14 },
    empChipTextActive: { color: WHITE },

    dateBar: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
      backgroundColor: WHITE,
      borderBottomWidth: 1,
      borderBottomColor: GRAY3,
    },
    dateInput: {
      flex: 1,
      backgroundColor: CARD,
      borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 10,
      color: BLACK, fontSize: 14,
      borderWidth: 1, borderColor: GRAY3,
    },
    loadBtn: {
      backgroundColor: BLACK,
      borderRadius: 10,
      paddingHorizontal: 20,
      justifyContent: 'center',
    },
    loadBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },

    settingsPanel: {
      flex: 1, backgroundColor: BG,
      paddingHorizontal: 20, paddingTop: 28,
    },
    settingsTitle: { color: BLACK, fontSize: 20, fontWeight: '900', marginBottom: 28 },
    settingRow: {
      backgroundColor: WHITE,
      borderRadius: 16, padding: 18,
      borderWidth: 1, borderColor: GRAY3,
      gap: 16,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    settingInfo:    {},
    settingDivider: { height: 12 },
    settingLabel: { color: GRAY, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
    settingDesc:  { color: GRAY, fontSize: 13, lineHeight: 18 },
    settingControl: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    intervalRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 120 },
    intervalLabel:  { fontSize: 11, fontWeight: '700', width: 72 },
    intervalInput: {
      flex: 1,
      backgroundColor: CARD, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      color: BLACK, fontSize: 18, fontWeight: '800',
      borderWidth: 1, borderColor: GRAY3,
      textAlign: 'center',
    },
    timeInput: {
      flex: 1,
      backgroundColor: CARD, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12,
      color: BLACK, fontSize: 22, fontWeight: '800',
      borderWidth: 1, borderColor: GRAY3,
      letterSpacing: 1,
    },
    saveBtn: {
      backgroundColor: BLACK, borderRadius: 10,
      paddingHorizontal: 22, paddingVertical: 12,
    },
    saveBtnDisabled: { backgroundColor: GRAY2 },
    saveBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  });
}
