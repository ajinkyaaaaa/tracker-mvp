// AdminLiveScreen.js — Real-time fleet map tab (admin)
// Displayed as the "Live" tab inside AdminTabs (App.js → AdminRoot).
//
// Data flows:
//   WebSocket "employee-location" (app.py → handle_location_update) → live marker updates
//   GET /api/admin/live → api.getLiveEmployees() → initial + 15 s polled marker set
//   useAuth() → token → socket auth
//
// Markers: black pins with employee name labels.
// Online count badge: floating top-right card.

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE }    from 'react-native-maps';
import { io }                                  from 'socket.io-client';
import AsyncStorage                            from '@react-native-async-storage/async-storage';
import { MaterialIcons }                       from '@expo/vector-icons';
import { useTheme }                            from '../contexts/ThemeContext';
import { api, BASE_URL }                       from '../services/api';
import { useAuth }                             from '../contexts/AuthContext';

const SOCKET_URL = BASE_URL.replace('/api', '');

const DEFAULT_REGION = {
  latitude:      20.5937,
  longitude:     78.9629,
  latitudeDelta: 15,
  longitudeDelta: 15,
};

export default function AdminLiveScreen() {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const { user } = useAuth();

  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const socketRef = useRef(null);
  const mapRef    = useRef(null);

  // Connect WebSocket and start 15 s polling on mount
  useEffect(() => {
    connectSocket();
    loadLive();
    const interval = setInterval(loadLive, 15000);
    return () => {
      clearInterval(interval);
      socketRef.current?.disconnect();
    };
  }, []);

  // Opens socket connection; subscribes to real-time location pushes from app.py
  async function connectSocket() {
    const token  = await AsyncStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('employee-location', (data) => {
      setEmployees((prev) => {
        const idx     = prev.findIndex((e) => e.id === data.userId);
        const updated = {
          id: data.userId, name: data.name,
          latitude: data.latitude, longitude: data.longitude, is_online: 1,
        };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx]  = { ...copy[idx], ...updated };
          return copy;
        }
        return [...prev, updated];
      });
    });
    socketRef.current = socket;
  }

  // Fetches online employees with latest location → GET /api/admin/live
  async function loadLive() {
    try {
      const data = await api.getLiveEmployees();
      setEmployees(data.filter(e => e.latitude && e.longitude));
    } catch {}
    setLoading(false);
  }

  const onlineCount = employees.length;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: BG }]}>
        <ActivityIndicator size="large" color={BLACK} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {employees.map((emp) => (
          <Marker
            key={emp.id}
            coordinate={{ latitude: emp.latitude, longitude: emp.longitude }}
            title={emp.name}
            pinColor="#000000"
          />
        ))}
      </MapView>

      {/* Online count badge — floating top-right */}
      <View style={[styles.badge, { backgroundColor: WHITE }]}>
        <View style={styles.badgeDot} />
        <Text style={[styles.badgeText, { color: BLACK }]}>
          {onlineCount} online
        </Text>
      </View>

      {/* Empty state overlay */}
      {onlineCount === 0 && (
        <View style={styles.emptyOverlay}>
          <View style={[styles.emptyCard, { backgroundColor: WHITE }]}>
            <MaterialIcons name="sensors" size={28} color={BLACK} />
            <Text style={[styles.emptyTitle, { color: BLACK }]}>No one online</Text>
            <Text style={[styles.emptySub, { color: GRAY }]}>
              Live locations will appear here
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map:       { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Online count badge
  badge: {
    position: 'absolute', top: 60, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
    elevation: 4,
  },
  badgeDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
  badgeText: { fontSize: 13, fontWeight: '700' },

  // Empty state overlay
  emptyOverlay: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    alignItems: 'center',
  },
  emptyCard: {
    alignItems: 'center', gap: 6,
    borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20,
    shadowColor: '#000', shadowOpacity: 0.10, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 3,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptySub:   { fontSize: 13, fontWeight: '500' },
});
