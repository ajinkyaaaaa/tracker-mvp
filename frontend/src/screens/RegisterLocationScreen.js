// RegisterLocationScreen.js — Create or edit a saved location pin
// Create mode: route.params { latitude, longitude } — coords from MapScreen.js drop-pin
// Edit mode:   route.params { editId, name, category, latitude, longitude, radius, address }
//              — navigated from ExploreLocationsScreen edit button
// Data flows:
//   googlePlacesSearch() → Google Places Autocomplete API → address suggestions
//   googlePlaceDetails() → Google Places Details API → exact coords + formatted address
//   handleSave() create  → prepends new item to AsyncStorage saved_locations_data
//   handleSave() edit    → updates existing item in AsyncStorage saved_locations_data by editId

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator, Keyboard,
  Platform, Animated, SafeAreaView, KeyboardAvoidingView,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const CARD  = '#F2F2F7';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';

const PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY;

const CATEGORIES = [
  { key: 'client',    label: 'Client',    icon: 'people' },
  { key: 'site',      label: 'Site',      icon: 'factory' },
  { key: 'rest-stop', label: 'Rest stop', icon: 'pause' },
];

const RADIUS_PRESETS = [50, 100, 150, 200];

// Returns Google Places autocomplete predictions biased near coord
async function googlePlacesSearch(query, coord) {
  let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${PLACES_KEY}&components=country:in&language=en`;
  if (coord) url += `&location=${coord.latitude},${coord.longitude}&radius=50000`;
  const res  = await fetch(url);
  const data = await res.json();
  return (data.predictions || []).map(p => ({
    id:       p.place_id,
    title:    p.structured_formatting?.main_text || p.description.split(',')[0],
    subtitle: p.description,
    placeId:  p.place_id,
  }));
}

// Fetches lat/lng and formatted address for a Google place_id
async function googlePlaceDetails(placeId) {
  const url  = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address&key=${PLACES_KEY}`;
  const res  = await fetch(url);
  const data = await res.json();
  const loc  = data.result?.geometry?.location;
  return { latitude: loc?.lat, longitude: loc?.lng, address: data.result?.formatted_address || '' };
}

export default function RegisterLocationScreen({ route, navigation }) {
  const { editId = null } = route.params;
  const isEdit = editId != null;

  // Pin coord — updated when the map stops moving (center-pin pattern)
  const [pinCoord, setPinCoord] = useState({
    latitude:  route.params.latitude,
    longitude: route.params.longitude,
  });
  // Live coord shown while panning so the readout updates in real time
  const [liveCoord, setLiveCoord] = useState({
    latitude:  route.params.latitude,
    longitude: route.params.longitude,
  });
  const [mapMoving, setMapMoving] = useState(false);
  const skipFirstRegionChange = useRef(true); // ignore the initial onRegionChange fired on mount

  // Form state — pre-filled in edit mode
  const [name,              setName]              = useState(route.params.name     ?? '');
  const [category,          setCategory]          = useState(route.params.category ?? 'client');
  const [address,           setAddress]           = useState(route.params.address  ?? '');
  const [addressCoord,      setAddressCoord]      = useState(null);
  const [preferPinLocation, setPreferPinLocation] = useState(true);
  const [radius,            setRadius]            = useState(route.params.radius   ?? 100);

  // Search state
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [showResults, setShowResults] = useState(false);

  const searchTimer = useRef(null);
  const mapRef      = useRef(null);

  // The coordinate used for saving: pin when toggle is on, address when toggle is off
  const effectiveCoord = (preferPinLocation || !addressCoord) ? pinCoord : addressCoord;
  // Displayed in coord readout — live while panning, settled when stopped
  const displayCoord   = (preferPinLocation || !addressCoord)
    ? (mapMoving ? liveCoord : pinCoord)
    : addressCoord;

  // Animate map to address coord when one is selected via Google Places search
  useEffect(() => {
    if (!addressCoord) return;
    mapRef.current?.animateToRegion({
      latitude:      addressCoord.latitude,
      longitude:     addressCoord.longitude,
      latitudeDelta:  0.004,
      longitudeDelta: 0.004,
    }, 450);
  }, [addressCoord]);

  // Debounced Google Places search — biased near current pin position
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (query.length < 3) { setResults([]); setShowResults(false); return; }
    const biasCoord = pinCoord;
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await googlePlacesSearch(query, biasCoord);
        setResults(r);
        setShowResults(r.length > 0);
      } catch {}
      finally { setSearching(false); }
    }, 500);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  // Selects a Places prediction — fetches exact coords and formatted address
  async function selectResult(item) {
    setQuery(item.title);
    setResults([]);
    setShowResults(false);
    Keyboard.dismiss();
    setSearching(true);
    try {
      const details = await googlePlaceDetails(item.placeId);
      if (details.latitude) {
        setAddressCoord({ latitude: details.latitude, longitude: details.longitude });
        setAddress(details.address);
      }
    } catch {
      setAddress(item.subtitle);
    }
    setSearching(false);
  }

  // Writes to AsyncStorage saved_locations_data and navigates back.
  // Edit mode: updates the existing item by editId. Create mode: prepends a new item.
  async function handleSave() {
    if (!name.trim()) { Alert.alert('Required', 'Please enter a location name'); return; }
    try {
      const raw      = await AsyncStorage.getItem('saved_locations_data');
      const existing = raw ? JSON.parse(raw) : [];
      if (isEdit) {
        const updated = existing.map(l =>
          l.id === editId
            ? { ...l, name: name.trim(), category, latitude: effectiveCoord.latitude, longitude: effectiveCoord.longitude, radius, address: address || null }
            : l
        );
        await AsyncStorage.setItem('saved_locations_data', JSON.stringify(updated));
      } else {
        const newPin = {
          id:         Date.now(),
          name:       name.trim(),
          category,
          latitude:   effectiveCoord.latitude,
          longitude:  effectiveCoord.longitude,
          radius,
          address:    address || null,
          created_at: new Date().toISOString(),
        };
        await AsyncStorage.setItem('saved_locations_data', JSON.stringify([newPin, ...existing]));
      }
      navigation.goBack();
    } catch {
      Alert.alert('Save Failed', 'Could not save location. Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? 'Edit Location' : 'Register Location'}</Text>
          <View style={styles.headerBack} />
        </View>

        {/* ── Map — center-pin location picker ── */}
        {/* Pan the map to move the pin; the crosshair stays fixed at center */}
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{
              latitude:      pinCoord.latitude,
              longitude:     pinCoord.longitude,
              latitudeDelta:  0.004,
              longitudeDelta: 0.004,
            }}
            scrollEnabled={preferPinLocation}
            zoomEnabled
            rotateEnabled={false}
            pitchEnabled={false}
            showsUserLocation={false}
            showsMyLocationButton={false}
            onRegionChange={region => {
              if (skipFirstRegionChange.current) { skipFirstRegionChange.current = false; return; }
              if (!preferPinLocation) return;
              setMapMoving(true);
              setLiveCoord({ latitude: region.latitude, longitude: region.longitude });
            }}
            onRegionChangeComplete={region => {
              if (!preferPinLocation) return;
              setMapMoving(false);
              setPinCoord({ latitude: region.latitude, longitude: region.longitude });
            }}
          >
            {/* Geofence circle tracks the live coord while panning */}
            <Circle
              center={mapMoving ? liveCoord : pinCoord}
              radius={radius}
              strokeColor="rgba(0,0,0,0.50)"
              fillColor="rgba(0,0,0,0.07)"
              strokeWidth={1.5}
            />
            {/* Address pin — shown as a fixed marker when "prefer address" is active */}
            {!preferPinLocation && addressCoord && (
              <Marker coordinate={addressCoord} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
                <View style={styles.mapPin}>
                  <MaterialIcons name="location-pin" size={22} color={WHITE} />
                </View>
              </Marker>
            )}
          </MapView>

          {/* Center crosshair pin — always at map center, lifts while map is moving */}
          {preferPinLocation && (
            <View style={styles.centerPinWrap} pointerEvents="none">
              <View style={[styles.mapPin, mapMoving && styles.mapPinLifted]}>
                <MaterialIcons name="location-pin" size={22} color={WHITE} />
              </View>
              {mapMoving && <View style={styles.pinShadowDot} />}
            </View>
          )}

          {/* Coord readout — updates live while panning */}
          <View style={styles.mapLabelWrap}>
            <View style={styles.mapLabel}>
              <MaterialIcons name="gps-fixed" size={11} color={GRAY} />
              <Text style={styles.mapLabelText}>
                {displayCoord.latitude.toFixed(5)},  {displayCoord.longitude.toFixed(5)}
              </Text>
            </View>
          </View>

          {/* Hint shown only when pin mode is active */}
          {preferPinLocation && (
            <View style={styles.mapHintWrap}>
              <View style={styles.mapHint}>
                <MaterialIcons name="open-with" size={11} color={GRAY} />
                <Text style={styles.mapHintText}>Pan map to reposition pin</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Form ── */}
        <ScrollView
          style={styles.form}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Location label */}
          <Text style={styles.fieldLabel}>LOCATION LABEL</Text>
          <TextInput
            style={styles.nameInput}
            placeholder="e.g. Acme HQ, Site B, Rest Stop"
            placeholderTextColor={GRAY2}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />

          {/* Category */}
          <Text style={styles.fieldLabel}>CATEGORY</Text>
          <View style={styles.catRow}>
            {CATEGORIES.map(cat => {
              const active = category === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.catChip, active && styles.catChipActive]}
                  onPress={() => setCategory(cat.key)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name={cat.icon} size={15} color={active ? WHITE : GRAY} />
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.divider} />

          {/* Address search */}
          <Text style={styles.fieldLabel}>ADDRESS</Text>
          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={18} color={GRAY} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search Google address…"
              placeholderTextColor={GRAY2}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {searching && <ActivityIndicator size="small" color={GRAY} />}
          </View>

          {/* Address search results */}
          {showResults && (
            <View style={styles.resultsWrap}>
              {results.map((item, index) => (
                <View key={item.id}>
                  {index > 0 && <View style={styles.resultDivider} />}
                  <TouchableOpacity style={styles.resultRow} onPress={() => selectResult(item)} activeOpacity={0.7}>
                    <MaterialIcons name="location-on" size={15} color={GRAY} style={{ marginTop: 1, flexShrink: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.resultSub}   numberOfLines={1}>{item.subtitle}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
              <Text style={styles.poweredBy}>
                {Platform.OS === 'ios' ? 'Powered by Google Maps for iOS' : 'Powered by Google Maps for Android'}
              </Text>
            </View>
          )}

          {/* Confirmed address display */}
          {!!address && !showResults && (
            <View style={styles.confirmedAddress}>
              <MaterialIcons name="check-circle" size={15} color={BLACK} />
              <Text style={styles.confirmedAddressText} numberOfLines={2}>{address}</Text>
              <TouchableOpacity
                onPress={() => { setAddress(''); setAddressCoord(null); setQuery(''); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={14} color={GRAY} />
              </TouchableOpacity>
            </View>
          )}

          {/* Prefer Pin Location toggle — only shown when address has been searched */}
          {!!addressCoord && (
            <>
              <View style={styles.divider} />
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Prefer Pin Location</Text>
                  <Text style={styles.toggleSub}>
                    {preferPinLocation
                      ? 'Saving exact dropped pin coordinates'
                      : 'Saving searched address coordinates'}
                  </Text>
                </View>
                <Switch
                  value={preferPinLocation}
                  onValueChange={setPreferPinLocation}
                  trackColor={{ false: GRAY3, true: BLACK }}
                  thumbColor={WHITE}
                  ios_backgroundColor={GRAY3}
                />
              </View>
              {!preferPinLocation && (
                <View style={styles.toggleHint}>
                  <MaterialIcons name="info-outline" size={13} color={GRAY} />
                  <Text style={styles.toggleHintText}>
                    The pin you dropped and the address location don't match. Enable this to use your exact pin position.
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.divider} />

          {/* Geofence radius */}
          <Text style={styles.fieldLabel}>GEOFENCE RADIUS</Text>
          <View style={styles.radiusRow}>
            {RADIUS_PRESETS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.radiusChip, radius === r && styles.radiusChipActive]}
                onPress={() => setRadius(r)}
                activeOpacity={0.75}
              >
                <Text style={[styles.radiusChipText, radius === r && styles.radiusChipTextActive]}>{r}m</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ height: 24 }} />

          {/* Save button */}
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            activeOpacity={0.85}
          >
            <MaterialIcons name="check" size={20} color={WHITE} />
            <Text style={styles.saveBtnText}>{isEdit ? 'Update Location' : 'Save Location'}</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: GRAY3,
  },
  headerBack:  { width: 36, alignItems: 'flex-start' },
  headerTitle: { color: BLACK, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },

  // Map
  mapWrap: { height: 280, backgroundColor: CARD },
  mapLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: GRAY3,
  },
  mapLabelWrap: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    alignItems: 'center',
  },
  mapLabelText: { color: GRAY, fontSize: 11, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  mapHintWrap: {
    position: 'absolute', top: 10, left: 0, right: 0,
    alignItems: 'center',
  },
  mapHint: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: GRAY3,
  },
  mapHintText: { color: GRAY, fontSize: 11, fontWeight: '500' },
  // Center-pin crosshair: pin tip (bottom-center of the 36px pin view) anchors to map center
  // translateY: -18 shifts the pin up by half its height so the tip sits at the exact center point
  centerPinWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    transform: [{ translateY: -18 }],
  },
  mapPinLifted: {
    transform: [{ translateY: -10 }],
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 12,
  },
  // Small dot appears under the pin tip while moving — visual anchor for precision
  pinShadowDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.30)',
    marginTop: -2,
  },

  // Pin markers on map preview
  mapPin: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: WHITE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  mapPinFaded: { backgroundColor: GRAY3, borderColor: WHITE },

  // Form
  form:        { flex: 1 },
  formContent: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  fieldLabel:  { color: GRAY, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },

  // Name input
  nameInput: {
    backgroundColor: CARD, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    color: BLACK, fontSize: 15, fontWeight: '500',
    borderWidth: 1, borderColor: GRAY3,
  },

  // Category chips
  catRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    backgroundColor: CARD, borderWidth: 1, borderColor: GRAY3,
  },
  catChipActive:     { backgroundColor: BLACK, borderColor: BLACK },
  catChipText:       { color: GRAY, fontSize: 13, fontWeight: '700' },
  catChipTextActive: { color: WHITE },

  // Divider
  divider: { height: 1, backgroundColor: GRAY3, marginVertical: 8 },

  // Address search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: GRAY3,
  },
  searchInput: { flex: 1, fontSize: 15, color: BLACK, paddingVertical: 0 },

  // Results list
  resultsWrap: {
    backgroundColor: WHITE, borderRadius: 14,
    borderWidth: 1, borderColor: GRAY3,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 6,
  },
  resultDivider: { height: 1, backgroundColor: GRAY3, marginLeft: 38 },
  resultRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13 },
  resultTitle: { color: BLACK, fontSize: 14, fontWeight: '600' },
  resultSub:   { color: GRAY,  fontSize: 11, marginTop: 1 },
  poweredBy:   { color: GRAY2, fontSize: 10, textAlign: 'right', paddingHorizontal: 10, paddingVertical: 6 },

  // Confirmed address
  confirmedAddress: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: CARD, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: GRAY3,
  },
  confirmedAddressText: { flex: 1, color: BLACK, fontSize: 13, lineHeight: 18, fontWeight: '500' },

  // Prefer Pin Location toggle
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 4,
  },
  toggleTextWrap: { flex: 1, gap: 3 },
  toggleTitle: { color: BLACK, fontSize: 15, fontWeight: '700' },
  toggleSub:   { color: GRAY,  fontSize: 12, fontWeight: '500' },
  toggleHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: CARD, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  toggleHintText: { flex: 1, color: GRAY, fontSize: 12, lineHeight: 17 },

  // Geofence radius
  radiusRow: { flexDirection: 'row', gap: 10 },
  radiusChip: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: CARD, borderWidth: 1.5, borderColor: GRAY3,
  },
  radiusChipActive:     { backgroundColor: BLACK, borderColor: BLACK },
  radiusChipText:       { color: GRAY,  fontSize: 15, fontWeight: '700' },
  radiusChipTextActive: { color: WHITE },

  // Save button
  saveBtn: {
    backgroundColor: BLACK, borderRadius: 18,
    paddingVertical: 17, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveBtnText: { color: WHITE, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
});
