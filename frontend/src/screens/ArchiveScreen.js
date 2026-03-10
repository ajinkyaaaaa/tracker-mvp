// ArchiveScreen.js — Daily activity log for the employee
// Lists today's idle-stop events (created by MapScreen.js idle detection).
// The employee taps a card to submit a response (what they were doing there).
//
// Data flows:
//   GET  /api/activities/today           → loadActivities()    → card list
//   PUT  /api/activities/:id/respond     → submitResponse()    → marks card 'completed'
//   AsyncStorage (muted_locations)       → muteLocationForHours() → local mute list

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Modal, TextInput, KeyboardAvoidingView,
  Platform, Alert, Animated, LayoutAnimation, UIManager,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Black & white palette
const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';
const RED   = '#FF3B30';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const QUICK_ACTIONS = [
  { label: 'Traffic',      icon: '🚗' },
  { label: 'Refreshments', icon: '☕' },
  { label: 'Rest Stop',    icon: '🛏' },
];
const MUTE_HOURS_OPTIONS = [1, 2, 4, 8];
const MUTE_STORAGE_KEY   = 'muted_locations';

function ScalePress({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      disabled={disabled}
      onPressIn={() => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 60 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 60 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

export default function ArchiveScreen({ navigation }) {
  const { logout } = useAuth();
  const [activities,       setActivities]      = useState([]);
  const [refreshing,       setRefreshing]       = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [responseText,     setResponseText]     = useState('');
  const [showMuteOptions,  setShowMuteOptions]  = useState(false);

  const navAnim    = useRef(new Animated.Value(0)).current;
  const listAnim   = useRef(new Animated.Value(30)).current;
  const listOpAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(listOpAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(listAnim, { toValue: 0, tension: 65, friction: 12, useNativeDriver: true }),
      ]),
    ]).start();
    loadActivities();
  }, []);

  async function loadActivities() {
    try {
      const data = await api.getTodayActivities();
      LayoutAnimation.configureNext({
        duration: 320,
        create: { type: 'easeInEaseOut', property: 'opacity' },
        update: { type: 'spring', springDamping: 0.7 },
      });
      setActivities(data);
    } catch {}
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadActivities();
    setRefreshing(false);
  }

  function formatTime(ts) {
    if (!ts) return '';
    const date = ts.includes('T') || ts.includes('Z') ? new Date(ts) : new Date(ts + 'Z');
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function openResponseModal(activity) {
    if (activity.status === 'completed') return;
    setSelectedActivity(activity);
    setResponseText('');
    setShowMuteOptions(false);
  }

  async function submitResponse(text) {
    if (!text.trim() || !selectedActivity) return;
    try {
      await api.respondToActivity(selectedActivity.id, text.trim());
      setSelectedActivity(null);
      setResponseText('');
      await loadActivities();
    } catch {}
  }

  async function muteLocationForHours(hours) {
    if (!selectedActivity) return;
    try {
      const raw   = await AsyncStorage.getItem(MUTE_STORAGE_KEY);
      const muted = raw ? JSON.parse(raw) : [];
      muted.push({ lat: selectedActivity.latitude, lng: selectedActivity.longitude, expiresAt: Date.now() + hours * 3600000 });
      await AsyncStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(muted));
      await api.respondToActivity(selectedActivity.id, `Muted for ${hours} hour${hours !== 1 ? 's' : ''} at this location`);
      setSelectedActivity(null);
      setShowMuteOptions(false);
      await loadActivities();
      Alert.alert('Muted', `Won't ask again here for ${hours}h.`);
    } catch {}
  }

  const pendingCount = activities.filter((a) => a.status === 'pending').length;

  function renderGeoCard({ item }) {
    const isPending = item.status === 'pending';
    return (
      <ScalePress
        style={[styles.card, isPending && styles.cardPending]}
        onPress={() => openResponseModal(item)}
      >
        {/* Mini map */}
        <View style={styles.miniMapContainer}>
          <MapView
            style={styles.miniMap}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{ latitude: item.latitude, longitude: item.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
            scrollEnabled={false} zoomEnabled={false} pitchEnabled={false} rotateEnabled={false}
          >
            <Marker
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              pinColor={isPending ? RED : '#000000'}
            />
          </MapView>

          <View style={styles.mapOverlay} />

          <View style={styles.triggerBadge}>
            <Text style={styles.triggerBadgeText}>{formatTime(item.triggered_at)}</Text>
          </View>

          {item.dwell_duration > 0 && (
            <View style={styles.dwellBadge}>
              <Text style={styles.dwellBadgeText}>{item.dwell_duration} min</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={styles.cardStatusRow}>
            <View style={[styles.statusChip, isPending ? styles.chipPending : styles.chipCompleted]}>
              <View style={[styles.chipDot, isPending ? styles.chipDotPending : styles.chipDotCompleted]} />
              <Text style={[styles.statusText, isPending ? styles.statusPending : styles.statusCompleted]}>
                {isPending ? 'Pending' : 'Completed'}
              </Text>
            </View>
            {isPending && <Text style={styles.tapHint}>Tap to respond →</Text>}
          </View>

          {item.response && (
            <View style={styles.responseRow}>
              <Text style={styles.responseLabel}>Response</Text>
              <Text style={styles.responseValue}>{item.response}</Text>
              {item.responded_at && (
                <Text style={styles.respondedAt}>at {formatTime(item.responded_at)}</Text>
              )}
            </View>
          )}

          {item.description && !item.response && (
            <Text style={styles.description}>{item.description}</Text>
          )}
        </View>
      </ScalePress>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── Floating Nav Pill ── */}
      <Animated.View style={[styles.navPill, { opacity: navAnim }]}>
        <TouchableOpacity onPress={() => navigation.navigate('Home')} style={styles.navItem}>
          <Text style={styles.navText}>Home</Text>
        </TouchableOpacity>
        <View style={styles.navDivider} />
        <View style={styles.navItem}>
          <Text style={[styles.navText, styles.navTextActive]}>Archive</Text>
          {pendingCount > 0 && (
            <View style={styles.navBadge}>
              <Text style={styles.navBadgeText}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.navDivider} />
        <TouchableOpacity onPress={logout} style={styles.navItem}>
          <Text style={styles.navText}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Section header ── */}
      <Animated.View style={[styles.sectionHeader, { opacity: listOpAnim, transform: [{ translateY: listAnim }] }]}>
        <Text style={styles.sectionTitle}>Today's Stops</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingPill}>
            <Text style={styles.pendingPillText}>{pendingCount} pending</Text>
          </View>
        )}
      </Animated.View>

      {/* ── List / Empty ── */}
      {activities.length === 0 ? (
        <Animated.View style={[styles.empty, { opacity: listOpAnim, transform: [{ translateY: listAnim }] }]}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No stops yet today</Text>
          <Text style={styles.emptyHint}>Activity stops appear when you stay in one place for 15+ minutes</Text>
        </Animated.View>
      ) : (
        <Animated.View style={[{ flex: 1 }, { opacity: listOpAnim, transform: [{ translateY: listAnim }] }]}>
          <FlatList
            data={activities}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderGeoCard}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLACK} />
            }
          />
        </Animated.View>
      )}

      {/* ── Response Modal ── */}
      <Modal visible={!!selectedActivity} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => { setSelectedActivity(null); setShowMuteOptions(false); }}
          />

          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>What were you doing here?</Text>
            {selectedActivity && (
              <Text style={styles.modalTime}>
                at {formatTime(selectedActivity.triggered_at)}
                {selectedActivity.dwell_duration > 0 && `  ·  ${selectedActivity.dwell_duration} min stop`}
              </Text>
            )}

            {/* Quick chips */}
            <View style={styles.quickRow}>
              {QUICK_ACTIONS.map((a) => (
                <ScalePress key={a.label} style={styles.quickChip} onPress={() => submitResponse(a.label)}>
                  <Text style={styles.quickChipIcon}>{a.icon}</Text>
                  <Text style={styles.quickChipText}>{a.label}</Text>
                </ScalePress>
              ))}
            </View>

            {/* Text input */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Or type your activity…"
                placeholderTextColor={GRAY2}
                value={responseText}
                onChangeText={setResponseText}
              />
              <ScalePress
                style={[styles.sendBtn, !responseText.trim() && styles.sendBtnOff]}
                onPress={() => submitResponse(responseText)}
                disabled={!responseText.trim()}
              >
                <Ionicons name="arrow-up" size={20} color={WHITE} />
              </ScalePress>
            </View>

            {/* Mute */}
            <View style={styles.muteSection}>
              {!showMuteOptions ? (
                <TouchableOpacity onPress={() => setShowMuteOptions(true)} style={styles.muteToggle}>
                  <Text style={styles.muteToggleText}>🔕  Don't ask again at this location</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={styles.muteLabel}>Mute for how long?</Text>
                  <View style={styles.muteRow}>
                    {MUTE_HOURS_OPTIONS.map((h) => (
                      <ScalePress key={h} style={styles.muteChip} onPress={() => muteLocationForHours(h)}>
                        <Text style={styles.muteChipText}>{h}h</Text>
                      </ScalePress>
                    ))}
                  </View>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Floating nav pill
  navPill: {
    position: 'absolute',
    top: 58, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 30, paddingVertical: 10, paddingHorizontal: 6,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
    zIndex: 10,
  },
  navItem:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 2 },
  navText:       { color: GRAY,  fontSize: 15, fontWeight: '700' },
  navTextActive: { color: BLACK },
  navDivider:    { width: 1, height: 16, backgroundColor: GRAY3 },
  navBadge: {
    backgroundColor: RED, borderRadius: 8,
    minWidth: 16, height: 16, paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 5,
  },
  navBadgeText: { color: WHITE, fontSize: 10, fontWeight: '900' },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 132, paddingHorizontal: 24, marginBottom: 8,
  },
  sectionTitle: { color: BLACK, fontSize: 22, fontWeight: '900', flex: 1 },
  pendingPill: {
    backgroundColor: 'rgba(255,59,48,0.1)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
  },
  pendingPillText: { color: RED, fontSize: 12, fontWeight: '800' },

  // List
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },

  // Empty state
  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 56, marginBottom: 18 },
  emptyTitle: { color: BLACK, fontSize: 19, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  emptyHint:  { color: GRAY,  fontSize: 14, textAlign: 'center', lineHeight: 21 },

  // Cards
  card: {
    backgroundColor: WHITE,
    borderRadius: 18, marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardPending: { borderColor: 'rgba(255,59,48,0.3)' },

  miniMapContainer: { height: 140, position: 'relative' },
  miniMap:          { flex: 1 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },

  triggerBadge: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: BLACK, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  triggerBadgeText: { color: WHITE, fontSize: 12, fontWeight: '800' },

  dwellBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: GRAY3,
  },
  dwellBadgeText: { color: BLACK, fontSize: 12, fontWeight: '700' },

  cardContent:   { padding: 14 },
  cardStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  statusChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, gap: 6 },
  chipPending:      { backgroundColor: 'rgba(255,59,48,0.08)' },
  chipCompleted:    { backgroundColor: CARD },
  chipDot:          { width: 7, height: 7, borderRadius: 4 },
  chipDotPending:   { backgroundColor: RED },
  chipDotCompleted: { backgroundColor: BLACK },
  statusText:       { fontSize: 12, fontWeight: '800' },
  statusPending:    { color: RED },
  statusCompleted:  { color: BLACK },
  tapHint:          { color: GRAY, fontSize: 12, fontStyle: 'italic' },

  responseRow:   { marginTop: 10 },
  responseLabel: { color: GRAY, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  responseValue: { color: BLACK, fontSize: 15, lineHeight: 22 },
  respondedAt:   { color: GRAY, fontSize: 11, marginTop: 4 },
  description:   { color: GRAY, fontSize: 15, marginTop: 10, lineHeight: 22 },

  // Response modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 26, paddingBottom: 44,
    borderTopWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 12,
  },
  modalHandle: {
    width: 36, height: 4, backgroundColor: GRAY2,
    borderRadius: 2, alignSelf: 'center', marginBottom: 22,
  },
  modalTitle: { color: BLACK, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  modalTime:  { color: GRAY,  fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 22 },

  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: CARD, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: GRAY3,
  },
  quickChipIcon: { fontSize: 15 },
  quickChipText: { color: BLACK, fontSize: 14, fontWeight: '700' },

  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  chatInput: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 14,
    color: BLACK, fontSize: 15,
    borderWidth: 1, borderColor: GRAY3,
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: BLACK,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnOff:  { opacity: 0.25 },

  // Mute
  muteSection:    { marginTop: 18 },
  muteToggle:     { alignSelf: 'center', paddingVertical: 10 },
  muteToggleText: { color: GRAY, fontSize: 14 },
  muteLabel:      { color: GRAY, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  muteRow:        { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  muteChip: {
    backgroundColor: CARD, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 11,
    borderWidth: 1, borderColor: GRAY3,
  },
  muteChipText: { color: BLACK, fontSize: 15, fontWeight: '800' },
});
