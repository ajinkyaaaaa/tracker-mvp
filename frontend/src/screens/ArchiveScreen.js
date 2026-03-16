// ArchiveScreen.js — Daily activity log for the employee
// Lists today's idle-stop events created by MapScreen.js idle detection.
// The employee taps a card to submit a response (what they were doing there).
//
// Data flows:
//   localDatabase.js → getStopsByDate(todayDate)   → loadActivities() → card list
//   localDatabase.js → respondToStop(id, response) → submitResponse()  → marks card 'completed'
//   AsyncStorage (muted_locations)                 → muteLocationForHours() → local mute list

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Alert, Animated, LayoutAnimation, UIManager, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStopsByDate, respondToStop } from '../services/localDatabase';
import StopResponseModal from '../components/StopResponseModal';
import NavPill           from '../components/NavPill';
import { useTheme } from '../contexts/ThemeContext';

const RED = '#FF3B30';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MUTE_STORAGE_KEY = 'muted_locations';

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
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE, isDark } = useTheme();
  const styles = makeStyles(useTheme());

  const [activities,       setActivities]      = useState([]);
  const [refreshing,       setRefreshing]       = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);

  const navAnim    = useRef(new Animated.Value(0)).current;
  const listAnim   = useRef(new Animated.Value(30)).current;
  const listOpAnim = useRef(new Animated.Value(0)).current;

  const todayDate = new Date().toISOString().slice(0, 10);

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

  // Reload whenever the screen is focused — ensures stops inserted after a notification tap appear immediately
  useFocusEffect(useCallback(() => { loadActivities(); }, []));

  // Reads today's stops from local SQLite → no network call
  async function loadActivities() {
    try {
      const data = await getStopsByDate(todayDate);
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
  }

  // Passed to StopResponseModal as onSubmit → respondToStop → reload
  async function submitResponse(text) {
    if (!selectedActivity) return;
    try {
      await respondToStop(selectedActivity.id, text);
      setSelectedActivity(null);
      await loadActivities();
    } catch {}
  }

  // Passed to StopResponseModal as onMute → AsyncStorage mute + respondToStop → reload
  async function muteLocationForHours(hours) {
    if (!selectedActivity) return;
    try {
      const raw   = await AsyncStorage.getItem(MUTE_STORAGE_KEY);
      const muted = raw ? JSON.parse(raw) : [];
      muted.push({ lat: selectedActivity.latitude, lng: selectedActivity.longitude, expiresAt: Date.now() + hours * 3600000 });
      await AsyncStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(muted));
      await respondToStop(selectedActivity.id, `Muted for ${hours} hour${hours !== 1 ? 's' : ''} at this location`);
      setSelectedActivity(null);
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
        </View>
      </ScalePress>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── Nav Pill ── */}
      <NavPill
        activeTab="archive"
        navigation={navigation}
        pendingCount={pendingCount}
        animValue={navAnim}
        pillBg={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.92)'}
      />

      {/* ── List / Empty — section header lives inside scroll so nav pill never overlaps ── */}
      <Animated.View style={[{ flex: 1 }, { opacity: listOpAnim, transform: [{ translateY: listAnim }] }]}>
        {activities.length === 0 ? (
          <View style={styles.emptyOuter}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Today's Stops</Text>
            </View>
            <View style={styles.empty}>
              <MaterialIcons name="location-off" size={52} color={GRAY} style={{ marginBottom: 18 }} />
              <Text style={styles.emptyTitle}>No stops yet today</Text>
              <Text style={styles.emptyHint}>Activity stops appear when you stay in one place for 15+ minutes</Text>
            </View>
          </View>
        ) : (
          <FlatList
            data={activities}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderGeoCard}
            ListHeaderComponent={
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Today's Stops</Text>
                {pendingCount > 0 && (
                  <View style={styles.pendingPill}>
                    <Text style={styles.pendingPillText}>{pendingCount} pending</Text>
                  </View>
                )}
              </View>
            }
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLACK} />
            }
          />
        )}
      </Animated.View>

      {/* ── Response modal (shared component) ── */}
      <StopResponseModal
        activity={selectedActivity}
        onSubmit={submitResponse}
        onMute={muteLocationForHours}
        onClose={() => setSelectedActivity(null)}
      />
    </View>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },


    // 56 (pill top) + 6 (pill paddingTop) + 2 (navTab padding) + 8 (capsule padding) + 20 (icon) + 8 + 2 + 6 = 108px pill bottom; +18px gap
    sectionHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 24, paddingBottom: 12, paddingTop: 4,
    },
    sectionTitle: { color: BLACK, fontSize: 22, fontWeight: '900', flex: 1 },
    pendingPill: {
      backgroundColor: 'rgba(255,59,48,0.1)',
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
      borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
    },
    pendingPillText: { color: RED, fontSize: 12, fontWeight: '800' },

    // paddingTop clears the absolute-positioned nav pill (bottom ~108px) + 18px breathing room
    list:      { paddingHorizontal: 20, paddingTop: 126, paddingBottom: 48 },
    emptyOuter:{ flex: 1, paddingTop: 118 },
    empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingBottom: 80 },
    emptyTitle:{ color: BLACK, fontSize: 19, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
    emptyHint: { color: GRAY,  fontSize: 14, textAlign: 'center', lineHeight: 21 },

    card: {
      backgroundColor: CARD,
      borderRadius: 18, marginBottom: 14,
      overflow: 'hidden',
      borderWidth: 1, borderColor: GRAY3,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },
    cardPending: { borderColor: 'rgba(255,59,48,0.3)' },

    miniMapContainer: { height: 140, position: 'relative' },
    miniMap:          { flex: 1 },
    mapOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.03)' },

    triggerBadge: {
      position: 'absolute', top: 10, left: 10,
      backgroundColor: BLACK, borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    triggerBadgeText: { color: WHITE, fontSize: 12, fontWeight: '800' },

    dwellBadge: {
      position: 'absolute', top: 10, right: 10,
      backgroundColor: CARD, borderRadius: 8,
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
  });
}
