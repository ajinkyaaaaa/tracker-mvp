// AdminDashboardScreen.js — Fleet management for admin users
// Three tabs:
//   Live View   — real-time employee map, updated via WebSocket + 15 s polling
//   History tab — date + employee selector; shows GPS trail + activity markers
//   Settings    — company-wide config (login deadline) → PUT /api/admin/settings/login-deadline
//
// Data flows:
//   WebSocket "employee-location" (app.py → handle_location_update) → live map markers
//   GET /api/admin/live                              → loadLiveEmployees() (polled every 15 s)
//   GET /api/admin/employees                         → loadEmployees()    → chip selector
//   GET /api/admin/employee/:id/locations/:date      → loadHistory()      → Polyline
//   GET /api/admin/employee/:id/activities/:date     → loadHistory()      → red pin markers
//   GET /api/settings/login-deadline                 → loadDeadline()     → Settings tab
//   PUT /api/admin/settings/login-deadline           → saveDeadline()     → Settings tab

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

const SOCKET_URL = BASE_URL.replace('/api', '');

// Black & white palette
const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';
const RED   = '#FF3B30';

export default function AdminDashboardScreen() {
  const { logout } = useAuth();
  const [tab,               setTab]               = useState('live');
  const [liveEmployees,     setLiveEmployees]     = useState([]);
  const [employees,         setEmployees]         = useState([]);
  const [selectedEmployee,  setSelectedEmployee]  = useState(null);
  const [selectedDate,      setSelectedDate]      = useState(new Date().toISOString().split('T')[0]);
  const [historyPath,       setHistoryPath]       = useState([]);
  const [historyActivities, setHistoryActivities] = useState([]);
  const [deadlineInput,     setDeadlineInput]     = useState('09:00');
  const [deadlineSaving,    setDeadlineSaving]    = useState(false);
  const socketRef = useRef(null);
  const mapRef    = useRef(null);

  useEffect(() => {
    connectSocket();
    loadEmployees();
    loadLiveEmployees();
    loadDeadline();
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

  // Fetches current login deadline from server → Settings tab initial value
  async function loadDeadline() {
    try {
      const { login_deadline } = await api.getLoginDeadline();
      if (login_deadline) setDeadlineInput(login_deadline);
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

const styles = StyleSheet.create({
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
  settingInfo:  {},
  settingLabel: { color: GRAY, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  settingDesc:  { color: GRAY, fontSize: 13, lineHeight: 18 },
  settingControl: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
