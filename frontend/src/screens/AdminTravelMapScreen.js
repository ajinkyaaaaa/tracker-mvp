// AdminTravelMapScreen.js — Full-screen GPS trail + stop markers for an employee's day
// Pushed from AdminDayLogScreen → "View on Map" button.
// route.params: { userId, date, employeeName }
//
// Data flows:
//   GET /api/admin/employee/:id/locations/:date  → api.getEmployeeLocations()  → black Polyline
//   GET /api/admin/employee/:id/activities/:date → api.getEmployeeActivities() → red stop markers
//
// Green dot = first GPS point (journey start); black dot = last point (journey end).
// Stats overlay shows employee name, date, total distance, and point count.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialIcons }                              from '@expo/vector-icons';
import { api }                                        from '../services/api';

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const GRAY  = '#6D6D72';
const GRAY3 = '#E5E5EA';
const GREEN = '#34C759';
const RED   = '#FF3B30';

// Returns a MapView region that fits all GPS points with padding
function computeRegion(pts) {
  const lats   = pts.map(p => p.latitude);
  const lons   = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const pad    = 0.005;
  return {
    latitude:       (minLat + maxLat) / 2,
    longitude:      (minLon + maxLon) / 2,
    latitudeDelta:  Math.max(maxLat - minLat, 0.006) + pad,
    longitudeDelta: Math.max(maxLon - minLon, 0.006) + pad,
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Sums haversine distances across an ordered GPS point array
function totalDistanceKm(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += haversineKm(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  }
  return d;
}

// Formats a timestamp string to "HH:MM"
function fmtTime(str) {
  if (!str) return '';
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminTravelMapScreen({ navigation, route }) {
  const { userId, date, employeeName } = route.params;

  const [path,       setPath]       = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Load GPS trail and stop markers in parallel on mount
  useEffect(() => {
    Promise.all([
      api.getEmployeeLocations(userId, date),
      api.getEmployeeActivities(userId, date),
    ])
      .then(([locs, acts]) => {
        setPath(locs.map(l => ({ latitude: l.latitude, longitude: l.longitude })));
        setActivities(acts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, date]);

  const distKm    = path.length > 1 ? totalDistanceKm(path) : 0;
  const distLabel = distKm < 1
    ? `${Math.round(distKm * 1000)} m`
    : `${distKm.toFixed(1)} km`;

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={BLACK} />
      </View>
    );
  }

  if (path.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{employeeName}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.center}>
          <MaterialIcons name="map" size={36} color={GRAY} />
          <Text style={styles.emptyTitle}>No GPS data for {dateLabel}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const region    = computeRegion(path);
  const startPt   = path[0];
  const endPt     = path[path.length - 1];

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
      >
        {/* GPS trail */}
        <Polyline
          coordinates={path}
          strokeColor={BLACK}
          strokeWidth={3}
        />

        {/* Start marker — green */}
        <Marker coordinate={startPt} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.startDot} />
        </Marker>

        {/* End marker — black */}
        <Marker coordinate={endPt} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.endDot} />
        </Marker>

        {/* Activity stop markers — red with callout */}
        {activities.map((act) => (
          <Marker
            key={act.id}
            coordinate={{ latitude: act.latitude, longitude: act.longitude }}
            pinColor={RED}
            title={act.description || 'Stop'}
            description={fmtTime(act.triggered_at)}
          />
        ))}
      </MapView>

      {/* Back button */}
      <TouchableOpacity
        style={styles.backOverlay}
        onPress={() => navigation.goBack()}
        activeOpacity={0.85}
      >
        <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
      </TouchableOpacity>

      {/* Stats overlay — bottom card */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <Text style={styles.statsName}>{employeeName}</Text>
          <Text style={styles.statsDate}>{dateLabel}</Text>
        </View>
        <View style={styles.statsPills}>
          <View style={styles.statsPill}>
            <MaterialIcons name="straighten" size={13} color={GRAY} />
            <Text style={styles.statsPillText}>{distLabel}</Text>
          </View>
          <View style={styles.statsPill}>
            <MaterialIcons name="my-location" size={13} color={GRAY} />
            <Text style={styles.statsPillText}>{path.length} pts</Text>
          </View>
          {activities.length > 0 && (
            <View style={styles.statsPill}>
              <MaterialIcons name="place" size={13} color={GRAY} />
              <Text style={styles.statsPillText}>{activities.length} stops</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  map:       { flex: 1 },
  safe:      { flex: 1, backgroundColor: WHITE },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: WHITE, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, backgroundColor: WHITE,
  },
  backBtn:     { width: 36, alignItems: 'flex-start' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: BLACK },

  emptyTitle: { fontSize: 15, fontWeight: '600', color: GRAY },

  // Map dots
  startDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: GREEN, borderWidth: 2, borderColor: WHITE,
  },
  endDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: BLACK, borderWidth: 2, borderColor: WHITE,
  },

  // Back button overlay (top-left)
  backOverlay: {
    position: 'absolute', top: 60, left: 16,
    backgroundColor: WHITE, borderRadius: 12,
    width: 40, height: 40,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
    elevation: 4,
  },

  // Stats card
  statsCard: {
    position: 'absolute', bottom: 40, left: 16, right: 16,
    backgroundColor: WHITE, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 5,
    gap: 10,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsName: { fontSize: 16, fontWeight: '800', color: BLACK },
  statsDate: { fontSize: 13, fontWeight: '600', color: GRAY },
  statsPills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F2F2F7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  statsPillText: { fontSize: 13, fontWeight: '600', color: GRAY },
});
