// TravelMapScreen.js — Full-screen interactive map of a day's GPS trail
// Navigated to from DayLogScreen.js → "View on Map" button in the TRAVEL card.
// Data flow: route.params.date → getTodayPath(date) → Polyline + start/end markers

import React, { useState, useEffect }              from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialIcons }                            from '@expo/vector-icons';
import { getTodayPath }                             from '../services/localDatabase';

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const GRAY  = '#6D6D72';
const GRAY3 = '#E5E5EA';
const GREEN = '#34C759';

// Returns a MapView region that fits all path points with padding
function pathRegion(pts) {
  const lats = pts.map(p => p.latitude);
  const lons = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const pad = 0.005;
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

// Total path distance in km
function totalDistanceKm(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += haversineKm(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  }
  return d;
}

export default function TravelMapScreen({ navigation, route }) {
  const { date } = route.params;
  const [path,    setPath]    = useState([]);
  const [loading, setLoading] = useState(true);

  // Loads GPS trail for the given date from local SQLite → renders as Polyline
  useEffect(() => {
    getTodayPath(date)
      .then(pts => setPath(pts.map(p => ({ latitude: p.latitude, longitude: p.longitude }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  const distKm    = path.length > 1 ? totalDistanceKm(path) : 0;
  const distLabel = distKm < 1
    ? `${Math.round(distKm * 1000)} m`
    : `${distKm.toFixed(1)} km`;
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  return (
    <View style={styles.container}>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BLACK} />
        </View>
      ) : path.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="route" size={44} color={GRAY} />
          <Text style={styles.emptyText}>No travel data for this day</Text>
        </View>
      ) : (
        <MapView
          style={StyleSheet.absoluteFillObject}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          region={pathRegion(path)}
          scrollEnabled
          zoomEnabled
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Polyline coordinates={path} strokeColor={BLACK} strokeWidth={3} />

          {/* Start dot — green */}
          <Marker coordinate={path[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.startDot} />
          </Marker>

          {/* End dot — black */}
          <Marker coordinate={path[path.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.endDot} />
          </Marker>
        </MapView>
      )}

      {/* ── Overlay: back button + stats pill ── */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <MaterialIcons name="arrow-back-ios" size={18} color={BLACK} />
        </TouchableOpacity>

        {path.length > 0 && (
          <View style={styles.statsPill}>
            <Text style={styles.statsDate}>{dateLabel}</Text>
            <View style={styles.statsDivider} />
            <MaterialIcons name="route" size={13} color={GRAY} />
            <Text style={styles.statsText}>{distLabel}</Text>
            <View style={styles.statsDivider} />
            <MaterialIcons name="location-on" size={13} color={GRAY} />
            <Text style={styles.statsText}>{path.length} pts</Text>
          </View>
        )}
      </SafeAreaView>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, backgroundColor: WHITE },
  emptyText: { color: GRAY, fontSize: 15, fontWeight: '600' },

  // Overlay row — back button + stats pill
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.96)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  statsPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  statsDate:    { color: BLACK, fontSize: 13, fontWeight: '700' },
  statsDivider: { width: 1, height: 14, backgroundColor: GRAY3 },
  statsText:    { color: GRAY, fontSize: 12, fontWeight: '600' },

  // Start (green) and end (black) path markers
  startDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: GREEN,
    borderWidth: 2.5, borderColor: WHITE,
    shadowColor: GREEN, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4,
  },
  endDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: BLACK,
    borderWidth: 2.5, borderColor: WHITE,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 4, elevation: 4,
  },
});
