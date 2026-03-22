// settings/BaseLocationPinScreen.js — 2-step geo-profile pin picker
// Step 1: Search address + pan map to place crosshair pin
// Step 2: Pick geofence radius from 4 presets (50 / 100 / 150 / 200 m)
//
// Address search: Google Places Autocomplete → Place Details for coordinates
// On confirm → saves result to AsyncStorage '_geo_pending' then calls navigation.goBack()
//   ManageProfileScreen reads '_geo_pending' in its focus listener
//
// route.params: { initialCoord, label, locationType ('base'|'home'), initialRadius, locationIndex (-1 = new) }

import { useState, useRef, useEffect }                        from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet,
         SafeAreaView, Platform, FlatList,
         ActivityIndicator, Keyboard }                        from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE }                   from 'react-native-maps';
import AsyncStorage                                           from '@react-native-async-storage/async-storage';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { useTheme }                                           from '../../contexts/ThemeContext';

const RADIUS_PRESETS = [50, 100, 150, 200];

const PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY;

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

// Fetches lat/lng for a Google place_id to animate the map there
async function googlePlaceDetails(placeId) {
  const url  = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${PLACES_KEY}`;
  const res  = await fetch(url);
  const data = await res.json();
  const loc  = data.result?.geometry?.location;
  return loc ? { latitude: loc.lat, longitude: loc.lng } : null;
}

export default function BaseLocationPinScreen({ navigation, route }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const { initialCoord, label, locationType, initialRadius, locationIndex = -1 } = route.params;

  const [step,        setStep]        = useState(1);
  const [center,      setCenter]      = useState(initialCoord); // tracks map centre in step 1
  const [confirmed,   setConfirmed]   = useState(null);         // locked after "Set Pin Here"
  const [radius,      setRadius]      = useState(
    RADIUS_PRESETS.includes(initialRadius) ? initialRadius : 100
  );

  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [showResults, setShowResults] = useState(false);

  const mapRef      = useRef(null);
  const searchTimer = useRef(null);
  const isBase      = locationType === 'base';
  const pinIcon     = isBase ? 'star' : 'home';

  // Debounced Google Places search — fires 600 ms after user stops typing
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (query.length < 3) { setResults([]); setShowResults(false); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await googlePlacesSearch(query, center);
        setResults(r);
        setShowResults(r.length > 0);
      } catch {}
      finally { setSearching(false); }
    }, 600);
    return () => clearTimeout(searchTimer.current);
  }, [query, center]);

  // Fetches Place Details for coordinates then animates map to that location
  async function selectResult(item) {
    setQuery(item.title);
    setResults([]);
    setShowResults(false);
    Keyboard.dismiss();
    setSearching(true);
    try {
      const coord = await googlePlaceDetails(item.placeId);
      if (coord) {
        setCenter(coord);
        mapRef.current?.animateToRegion(
          { ...coord, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 500,
        );
      }
    } catch {}
    setSearching(false);
  }

  function handleSetPin() {
    Keyboard.dismiss();
    setConfirmed(center);
    mapRef.current?.animateToRegion(
      { ...center, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 400,
    );
    setTimeout(() => setStep(2), 450);
  }

  function handleBack() {
    if (step === 2) { setStep(1); return; }
    navigation.goBack();
  }

  // Saves result to AsyncStorage then goes back — avoids pushing a new ManageProfile
  // ManageProfileScreen reads '_geo_pending' in its focus listener
  async function handleConfirm() {
    await AsyncStorage.setItem('_geo_pending', JSON.stringify({
      pickedCoords: confirmed,
      pickedRadius: radius,
      locationType,
      locationIndex,
    }));
    navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerSide} onPress={handleBack}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {label || (isBase ? 'Base Geo Profile' : 'Home Geo Profile')}
          </Text>
          <Text style={styles.headerSub}>
            {step === 1 ? 'Step 1 of 2  ·  Place pin' : 'Step 2 of 2  ·  Set geofence'}
          </Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      {/* Step 1: address search bar */}
      {step === 1 && (
        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <MaterialIcons name="search" size={20} color={GRAY} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search address…"
              placeholderTextColor={GRAY2}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={GRAY} />}
          </View>

          {showResults && (
            <FlatList
              style={styles.resultsList}
              data={results}
              keyExtractor={r => String(r.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultRow}
                  onPress={() => selectResult(item)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="location-on" size={16} color={GRAY} style={{ marginTop: 2 }} />
                  <View style={styles.resultText}>
                    <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.resultSub}   numberOfLines={1}>{item.subtitle}</Text>
                  </View>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.resultDivider} />}
              ListFooterComponent={
                <Text style={styles.poweredBy}>
                  {Platform.OS === 'ios' ? 'Powered by Google Maps for iOS' : 'Powered by Google Maps for Android'}
                </Text>
              }
            />
          )}
        </View>
      )}

      {/* Map */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={{
            latitude:       initialCoord.latitude,
            longitude:      initialCoord.longitude,
            latitudeDelta:  0.003,
            longitudeDelta: 0.003,
          }}
          pitchEnabled={false}
          rotateEnabled={false}
          showsCompass={false}
          showsMyLocationButton={false}
          scrollEnabled={step === 1}
          zoomEnabled={step === 1}
          onRegionChangeComplete={r =>
            step === 1 && setCenter({ latitude: r.latitude, longitude: r.longitude })
          }
        >
          {step === 2 && confirmed && (
            <Circle
              center={confirmed}
              radius={radius}
              strokeColor="rgba(0,0,0,0.55)"
              fillColor="rgba(0,0,0,0.07)"
              strokeWidth={1.5}
            />
          )}
        </MapView>

        {/* Crosshair overlay — shifted up so the dot tip aligns with map geographic centre */}
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={styles.crosshairStack}>
            <View style={[styles.crosshairPin, isBase ? styles.pinBase : styles.pinHome]}>
              <MaterialIcons name={pinIcon} size={18} color={WHITE} />
            </View>
            <View style={styles.crosshairStem} />
            <View style={styles.crosshairDot}  />
          </View>
        </View>
      </View>

      {/* Bottom panel */}
      {step === 1 ? (
        <View style={styles.panel}>
          <Text style={styles.panelHint}>Pan the map to position the pin</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSetPin} activeOpacity={0.85}>
            <MaterialIcons name="push-pin" size={18} color={WHITE} />
            <Text style={styles.primaryBtnText}>Set Pin Here</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.radiusLabel}>GEOFENCE RADIUS</Text>
          <View style={styles.presetRow}>
            {RADIUS_PRESETS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.presetChip, radius === r && styles.presetChipActive]}
                onPress={() => setRadius(r)}
                activeOpacity={0.75}
              >
                <Text style={[styles.presetChipText, radius === r && styles.presetChipTextActive]}>
                  {r}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <MaterialIcons name="check" size={18} color={WHITE} />
            <Text style={styles.primaryBtnText}>Confirm Geo Profile</Text>
          </TouchableOpacity>
        </View>
      )}

    </SafeAreaView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: GRAY3, backgroundColor: BG,
  },
  headerSide:   { width: 36 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerTitle:  { color: BLACK, fontSize: 16, fontWeight: '700' },
  headerSub:    { color: GRAY,  fontSize: 11, fontWeight: '500' },

  searchWrap: { backgroundColor: BG, zIndex: 10 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 12, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: CARD, borderRadius: 12,
  },
  searchInput: { flex: 1, color: BLACK, fontSize: 15 },
  resultsList: {
    maxHeight: 220, marginHorizontal: 12, marginTop: -4, marginBottom: 8,
    backgroundColor: BG, borderRadius: 12,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 8,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  resultText:    { flex: 1 },
  resultTitle:   { color: BLACK, fontSize: 14, fontWeight: '600' },
  resultSub:     { color: GRAY,  fontSize: 12, marginTop: 1 },
  resultDivider: { height: 1, backgroundColor: GRAY3, marginLeft: 44 },
  poweredBy:     { color: GRAY2, fontSize: 10, textAlign: 'right', paddingHorizontal: 10, paddingVertical: 6 },

  mapWrap: { flex: 1, position: 'relative', overflow: 'hidden' },

  crosshairWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  // Pin 44 + stem 12 + dot 6 = 62px total. Shift up by half (31px) so the dot tip
  // sits exactly on the map's geographic centre coordinate.
  crosshairStack: { alignItems: 'center', transform: [{ translateY: -31 }] },
  crosshairPin: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: WHITE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },
  pinBase:       { backgroundColor: BLACK },
  pinHome:       { backgroundColor: '#444444' },
  crosshairStem: { width: 2, height: 12, backgroundColor: BLACK },
  crosshairDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: BLACK },

  panel: {
    backgroundColor: BG, paddingHorizontal: 20, paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    borderTopWidth: 1, borderTopColor: GRAY3, gap: 14,
  },
  panelHint: { color: GRAY, fontSize: 13, textAlign: 'center' },

  radiusLabel: { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  presetRow:   { flexDirection: 'row', gap: 10 },
  presetChip: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: CARD, alignItems: 'center',
    borderWidth: 1.5, borderColor: GRAY3,
  },
  presetChipActive:     { backgroundColor: BLACK, borderColor: BLACK },
  presetChipText:       { color: GRAY, fontSize: 15, fontWeight: '700' },
  presetChipTextActive: { color: WHITE },

  primaryBtn: {
    backgroundColor: BLACK, borderRadius: 14, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },
}); }
