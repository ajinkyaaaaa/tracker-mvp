// settings/ManageProfileScreen.js — Edit personal information and geo profiles
// Navigated to from SettingsScreen.js → Manage Profile row
// Receives geo profile data via AsyncStorage '_geo_pending' written by BaseLocationPinScreen
//   (focus listener reads and clears '_geo_pending' on each return)
//
// Data flows:
//   On mount: AsyncStorage → instant local load; then GET /api/profile → server overwrite + AsyncStorage refresh
//   Text fields: onChangeText → debounced 1.5 s → AsyncStorage + PUT /api/profile
//   Geo profiles: add/edit/remove → immediate AsyncStorage + PUT /api/profile/geo
//   base_locations_data AsyncStorage → MapScreen.js (star pins + geofence circles, array)
//   home_locations_data AsyncStorage → MapScreen.js (home pins + geofence circles, array)

import { useState, useEffect, useRef }                        from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput,
         StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView,
         Platform }                                           from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE }           from 'react-native-maps';
import AsyncStorage                                           from '@react-native-async-storage/async-storage';
import { getCurrentLocation }                                  from '../../services/locationService';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { useAuth }                                            from '../../contexts/AuthContext';
import { useTheme }                                           from '../../contexts/ThemeContext';
import { api }                                               from '../../services/api';

const PROFILE_KEY        = 'user_profile_info';
const BASE_LOCATIONS_KEY = 'base_locations_data';  // Array<{ name, latitude, longitude, radius }> → MapScreen.js
const HOME_LOCATIONS_KEY = 'home_locations_data';  // Array<{ name, latitude, longitude, radius }> → MapScreen.js
// Legacy single-item keys (read-only, for migration)
const BASE_LEGACY_KEY    = 'base_location_data';
const HOME_LEGACY_KEY    = 'home_location_data';

const LABEL_MAX = 25;

// Simple text input field row
function Field({ label, value, onChangeText, placeholder, keyboardType }) {
  const { GRAY2 } = useTheme();
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={GRAY2}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

// Label field with 25-char counter
function LabelField({ value, onChangeText }) {
  const { GRAY2 } = useTheme();
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.field}>
      <View style={styles.labelFieldHeader}>
        <Text style={styles.fieldLabel}>Label</Text>
        <Text style={styles.charCount}>{value.length}/{LABEL_MAX}</Text>
      </View>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={t => onChangeText(t.slice(0, LABEL_MAX))}
        placeholder="e.g. Office, Home…"
        placeholderTextColor={GRAY2}
        maxLength={LABEL_MAX}
      />
    </View>
  );
}

// Small map preview card for a saved geo profile
// pointerEvents="none" prevents touch conflicts inside ScrollView
function GeoProfileCard({ coord, radius, icon, name }) {
  const { WHITE } = useTheme();
  const styles = makeStyles(useTheme());
  if (!coord) return null;
  return (
    <View style={styles.mapCard} pointerEvents="none">
      <MapView
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude:       coord.latitude,
          longitude:      coord.longitude,
          latitudeDelta:  (radius / 111000) * 4,
          longitudeDelta: (radius / 111000) * 4,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        showsCompass={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        liteMode  // Android only — improves performance for static map cards
      >
        <Circle
          center={coord}
          radius={radius}
          strokeColor="rgba(0,0,0,0.50)"
          fillColor="rgba(0,0,0,0.07)"
          strokeWidth={1.5}
        />
        <Marker coordinate={coord} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={styles.mapCardPin}>
            <MaterialIcons name={icon} size={12} color={WHITE} />
          </View>
        </Marker>
      </MapView>
      <View style={styles.mapCardLabel}>
        <MaterialIcons name={icon} size={12} color={WHITE} />
        <Text style={styles.mapCardLabelText} numberOfLines={1}>{name}</Text>
        <Text style={styles.mapCardRadius}>{radius}m</Text>
      </View>
    </View>
  );
}

// Navigated to from SettingsScreen.js → Manage Profile row
export default function ManageProfileScreen({ navigation }) {
  const { user } = useAuth();
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [address,      setAddress]      = useState('');
  const [phone,        setPhone]        = useState('');
  const [state,        setState]        = useState('');
  const [pincode,      setPincode]      = useState('');
  const [country,      setCountry]      = useState('India');

  // Geo profile arrays — each item: { name, latitude, longitude, radius }
  const [baseLocations, setBaseLocations] = useState([]);
  const [homeLocations, setHomeLocations] = useState([]);

  const [locLoading, setLocLoading] = useState(null); // 'base' | 'home' | null
  const [geoBanner,  setGeoBanner]  = useState('');   // shown after returning from pin screen

  const saveDebounceRef = useRef(null);

  // Writes personal info to AsyncStorage then syncs to server (best-effort).
  // Called by the debounce timer — fires 1.5 s after the last keystroke.
  async function autoSavePersonalInfo(fields) {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(fields));
    try { await api.upsertProfile(fields); } catch {}  // PUT /api/profile
  }

  // Debounces personal info saves: starts a 1.5 s timer on each keystroke.
  function debouncedPersonalSave(fields) {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => autoSavePersonalInfo(fields), 1500);
  }

  // Writes geo arrays to AsyncStorage then syncs to server (best-effort).
  // Called immediately after any geo profile mutation (add, edit, remove).
  async function saveGeoProfiles(newBase, newHome) {
    await AsyncStorage.setItem(BASE_LOCATIONS_KEY, JSON.stringify(newBase));
    await AsyncStorage.setItem(HOME_LOCATIONS_KEY, JSON.stringify(newHome));
    try { await api.setGeoProfiles(newBase, newHome); } catch {}  // PUT /api/profile/geo
  }

  // Load all stored data on mount: AsyncStorage first (instant), then server (authoritative).
  // Sequential async so legacy migration writes to new key before deleting the old one.
  useEffect(() => {
    const nameParts  = (user?.name || '').split(' ');
    const savedFirst = nameParts[0] || '';
    const savedLast  = nameParts.slice(1).join(' ') || '';

    async function init() {
      // Step 1: local AsyncStorage (instant render)
      const profileRaw = await AsyncStorage.getItem(PROFILE_KEY);
      if (profileRaw) {
        const d = JSON.parse(profileRaw);
        setFirstName(d.firstName ?? savedFirst);
        setLastName(d.lastName   ?? savedLast);
        setAddress(d.address     ?? '');
        setPhone(d.phone         ?? '');
        setState(d.state         ?? '');
        setPincode(d.pincode     ?? '');
        setCountry(d.country     ?? 'India');
      } else {
        setFirstName(savedFirst);
        setLastName(savedLast);
      }

      // Geo profiles — read all four keys, migrate legacy → new key, then delete legacy
      const [baseArr, baseLeg, homeArr, homeLeg] = await Promise.all([
        AsyncStorage.getItem(BASE_LOCATIONS_KEY),
        AsyncStorage.getItem(BASE_LEGACY_KEY),
        AsyncStorage.getItem(HOME_LOCATIONS_KEY),
        AsyncStorage.getItem(HOME_LEGACY_KEY),
      ]);

      const bases = baseArr ? JSON.parse(baseArr) : baseLeg ? [JSON.parse(baseLeg)] : [];
      const homes = homeArr ? JSON.parse(homeArr) : homeLeg ? [JSON.parse(homeLeg)] : [];

      setBaseLocations(bases);
      setHomeLocations(homes);

      // Write migrated data to new keys before deleting legacy
      if (!baseArr && baseLeg) await AsyncStorage.setItem(BASE_LOCATIONS_KEY, JSON.stringify(bases));
      if (!homeArr && homeLeg) await AsyncStorage.setItem(HOME_LOCATIONS_KEY, JSON.stringify(homes));
      await AsyncStorage.multiRemove([BASE_LEGACY_KEY, HOME_LEGACY_KEY]);

      // Step 2: Fetch from server — overwrites local if server has data.
      // If server is empty but local has data, uploads local → server (migrates pre-sync installs).
      try {
        const { personal_info, geo_profiles } = await api.getProfile();  // GET /api/profile

        if (personal_info?.first_name !== undefined) {
          const fi = personal_info.first_name ?? savedFirst;
          const la = personal_info.last_name  ?? savedLast;
          const ph = personal_info.phone      ?? '';
          const ad = personal_info.address    ?? '';
          const st = personal_info.state      ?? '';
          const pc = personal_info.pincode    ?? '';
          const co = personal_info.country    ?? 'India';
          setFirstName(fi); setLastName(la); setAddress(ad);
          setPhone(ph); setState(st); setPincode(pc); setCountry(co);
          AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
            firstName: fi, lastName: la, phone: ph, address: ad, state: st, pincode: pc, country: co,
          }));
        } else {
          // Server has no personal info — upload whatever is stored locally
          const raw = await AsyncStorage.getItem(PROFILE_KEY);
          if (raw) {
            const d = JSON.parse(raw);
            api.upsertProfile({
              first_name: d.firstName, last_name: d.lastName, phone: d.phone,
              address: d.address, state: d.state, pincode: d.pincode, country: d.country,
            }).catch(() => {});
          }
        }

        if (geo_profiles?.base?.length || geo_profiles?.home?.length) {
          if (geo_profiles.base?.length) {
            setBaseLocations(geo_profiles.base);
            AsyncStorage.setItem(BASE_LOCATIONS_KEY, JSON.stringify(geo_profiles.base));
          }
          if (geo_profiles.home?.length) {
            setHomeLocations(geo_profiles.home);
            AsyncStorage.setItem(HOME_LOCATIONS_KEY, JSON.stringify(geo_profiles.home));
          }
        } else {
          // Server has no geo profiles — upload local data to server
          const [baseRaw, homeRaw] = await Promise.all([
            AsyncStorage.getItem(BASE_LOCATIONS_KEY),
            AsyncStorage.getItem(HOME_LOCATIONS_KEY),
          ]);
          const localBase = baseRaw ? JSON.parse(baseRaw) : [];
          const localHome = homeRaw ? JSON.parse(homeRaw) : [];
          if (localBase.length || localHome.length) {
            api.setGeoProfiles(localBase, localHome).catch(() => {});
          }
        }
      } catch {}
    }
    init();
  }, []);

  // Reads '_geo_pending' written by BaseLocationPinScreen after user confirms a pin.
  // Uses focus listener so it fires every time this screen regains focus.
  // Immediately saves updated geo arrays to AsyncStorage + server.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      const raw = await AsyncStorage.getItem('_geo_pending');
      if (!raw) return;
      await AsyncStorage.removeItem('_geo_pending');
      const { pickedCoords, pickedRadius, locationType, locationIndex = -1 } = JSON.parse(raw);
      const update = (prev, defaultName) => {
        const arr = [...prev];
        if (locationIndex === -1) {
          arr.push({ name: `${defaultName} ${arr.length + 1}`, latitude: pickedCoords.latitude, longitude: pickedCoords.longitude, radius: pickedRadius ?? 100 });
        } else {
          arr[locationIndex] = { ...arr[locationIndex], latitude: pickedCoords.latitude, longitude: pickedCoords.longitude, radius: pickedRadius ?? 100 };
        }
        return arr;
      };

      // Compute updated arrays before calling setters (state values are stale inside closure)
      setBaseLocations(prev => {
        const newBase = locationType === 'base' ? update(prev, 'Base Location') : prev;
        setHomeLocations(prevHome => {
          const newHome = locationType === 'home' ? update(prevHome, 'Home') : prevHome;
          saveGeoProfiles(newBase, newHome);
          return newHome;
        });
        return newBase;
      });
      setGeoBanner('Geo profile registered.');
    });
    return unsubscribe;
  }, [navigation]);

  // Gets GPS (if needed) then navigates to BaseLocationPinScreen for add (index=-1) or edit (index≥0)
  async function handleAddGeoProfile(type, index = -1) {
    setLocLoading(type);
    try {
      const locations   = type === 'base' ? baseLocations : homeLocations;
      const existing    = index >= 0 ? locations[index] : null;
      const defaultName = type === 'base' ? 'Base Location' : 'Home';
      const label       = existing?.name || `${defaultName} ${locations.length + 1}`;
      let initialCoord  = existing ? { latitude: existing.latitude, longitude: existing.longitude } : null;

      if (!initialCoord) {
        const loc = await getCurrentLocation();
        if (!loc) { Alert.alert('Error', 'Could not get current location. Try again.'); return; }
        initialCoord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      }

      navigation.navigate('BaseLocationPin', {
        initialCoord,
        label,
        locationType:  type,
        initialRadius: existing?.radius ?? 100,
        locationIndex: index,
      });
    } catch {} finally {
      setLocLoading(null);
    }
  }

  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase() || 'U';

  // Helper: builds a complete fields object from current state + one overridden value
  function personalFields(overrides) {
    return { firstName, lastName, address, phone, state, pincode, country, ...overrides };
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Profile</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <TouchableOpacity
                style={styles.cameraBtn}
                onPress={() => Alert.alert('Coming Soon', 'Photo upload will be available in a future update.')}
              >
                <MaterialIcons name="photo-camera" size={16} color={WHITE} />
              </TouchableOpacity>
            </View>
            <Text style={styles.avatarHint}>Tap the camera to change photo</Text>
          </View>

          {/* Personal information — each field auto-saves 1.5 s after the last keystroke */}
          <Text style={styles.sectionHeader}>PERSONAL INFORMATION</Text>
          <View style={styles.sectionCard}>
            <Field label="First Name"   value={firstName} onChangeText={v => { setFirstName(v);  debouncedPersonalSave(personalFields({ firstName: v }));  }} />
            <View style={styles.divider} />
            <Field label="Last Name"    value={lastName}  onChangeText={v => { setLastName(v);   debouncedPersonalSave(personalFields({ lastName: v }));   }} />
            <View style={styles.divider} />
            <Field label="Phone Number" value={phone}     onChangeText={v => { setPhone(v);      debouncedPersonalSave(personalFields({ phone: v }));      }} keyboardType="phone-pad" />
            <View style={styles.divider} />
            <Field label="Address"      value={address}   onChangeText={v => { setAddress(v);    debouncedPersonalSave(personalFields({ address: v }));    }} />
            <View style={styles.divider} />
            <Field label="State"        value={state}     onChangeText={v => { setState(v);      debouncedPersonalSave(personalFields({ state: v }));      }} />
            <View style={styles.divider} />
            <Field label="Pincode"      value={pincode}   onChangeText={v => { setPincode(v);    debouncedPersonalSave(personalFields({ pincode: v }));    }} keyboardType="numeric" />
            <View style={styles.divider} />
            <Field label="Country"      value={country}   onChangeText={v => { setCountry(v);    debouncedPersonalSave(personalFields({ country: v }));    }} />
          </View>

          {/* Base geo profiles — multiple supported */}
          <Text style={styles.sectionHeader}>BASE GEO PROFILES</Text>
          {baseLocations.map((loc, i) => (
            <View key={`base-${i}`} style={[styles.sectionCard, { marginBottom: 12 }]}>
              <View style={styles.geoItemHeader}>
                <MaterialIcons name="star" size={14} color={GRAY} />
                <Text style={styles.geoItemIndex}>Base {i + 1}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Label</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={loc.name}
                  onChangeText={t => {
                    const newBase = baseLocations.map((b, idx) => idx === i ? { ...b, name: t } : b);
                    setBaseLocations(newBase);
                    saveGeoProfiles(newBase, homeLocations);
                  }}
                  placeholder="e.g. Main Office…"
                  placeholderTextColor={GRAY2}
                  maxLength={25}
                />
              </View>
              <View style={styles.divider} />
              <GeoProfileCard coord={{ latitude: loc.latitude, longitude: loc.longitude }} radius={loc.radius} icon="star" name={loc.name || `Base ${i + 1}`} />
              <View style={styles.divider} />
              <View style={styles.geoItemActions}>
                <TouchableOpacity style={styles.geoActionBtn} onPress={() => handleAddGeoProfile('base', i)} disabled={locLoading !== null} activeOpacity={0.7}>
                  <MaterialIcons name="edit" size={15} color={BLACK} />
                  <Text style={styles.geoActionBtnText}>Edit Pin</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.geoActionBtn, styles.geoActionRemove]}
                  onPress={() => {
                    const newBase = baseLocations.filter((_, idx) => idx !== i);
                    setBaseLocations(newBase);
                    saveGeoProfiles(newBase, homeLocations);
                  }} activeOpacity={0.7}>
                  <MaterialIcons name="delete-outline" size={15} color="#FF3B30" />
                  <Text style={[styles.geoActionBtnText, { color: '#FF3B30' }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[styles.sectionCard, styles.geoAddBtn]} onPress={() => handleAddGeoProfile('base', -1)} disabled={locLoading !== null} activeOpacity={0.7}>
            <MaterialIcons name="add" size={18} color={BLACK} />
            <Text style={styles.geoProfileBtnText}>{locLoading === 'base' ? 'Getting location…' : 'Add Base Location'}</Text>
          </TouchableOpacity>

          {/* Home geo profiles — multiple supported */}
          <Text style={[styles.sectionHeader, { marginTop: 20 }]}>HOME GEO PROFILES</Text>
          {homeLocations.map((loc, i) => (
            <View key={`home-${i}`} style={[styles.sectionCard, { marginBottom: 12 }]}>
              <View style={styles.geoItemHeader}>
                <MaterialIcons name="home" size={14} color={GRAY} />
                <Text style={styles.geoItemIndex}>Home {i + 1}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Label</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={loc.name}
                  onChangeText={t => {
                    const newHome = homeLocations.map((h, idx) => idx === i ? { ...h, name: t } : h);
                    setHomeLocations(newHome);
                    saveGeoProfiles(baseLocations, newHome);
                  }}
                  placeholder="e.g. Home…"
                  placeholderTextColor={GRAY2}
                  maxLength={25}
                />
              </View>
              <View style={styles.divider} />
              <GeoProfileCard coord={{ latitude: loc.latitude, longitude: loc.longitude }} radius={loc.radius} icon="home" name={loc.name || `Home ${i + 1}`} />
              <View style={styles.divider} />
              <View style={styles.geoItemActions}>
                <TouchableOpacity style={styles.geoActionBtn} onPress={() => handleAddGeoProfile('home', i)} disabled={locLoading !== null} activeOpacity={0.7}>
                  <MaterialIcons name="edit" size={15} color={BLACK} />
                  <Text style={styles.geoActionBtnText}>Edit Pin</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.geoActionBtn, styles.geoActionRemove]}
                  onPress={() => {
                    const newHome = homeLocations.filter((_, idx) => idx !== i);
                    setHomeLocations(newHome);
                    saveGeoProfiles(baseLocations, newHome);
                  }} activeOpacity={0.7}>
                  <MaterialIcons name="delete-outline" size={15} color="#FF3B30" />
                  <Text style={[styles.geoActionBtnText, { color: '#FF3B30' }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[styles.sectionCard, styles.geoAddBtn]} onPress={() => handleAddGeoProfile('home', -1)} disabled={locLoading !== null} activeOpacity={0.7}>
            <MaterialIcons name="add" size={18} color={BLACK} />
            <Text style={styles.geoProfileBtnText}>{locLoading === 'home' ? 'Getting location…' : 'Add Home Location'}</Text>
          </TouchableOpacity>

          {!!geoBanner && (
            <View style={styles.geoBanner}>
              <MaterialIcons name="check-circle-outline" size={15} color={BLACK} />
              <Text style={styles.geoBannerText}>{geoBanner}</Text>
            </View>
          )}

          <View style={{ height: 16 }} />

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) { return StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: GRAY3,
  },
  backBtn:     { width: 36, alignItems: 'flex-start' },
  headerTitle: { color: BLACK, fontSize: 17, fontWeight: '700' },

  scroll: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 48 },

  avatarSection: { alignItems: 'center', marginBottom: 36 },
  avatarWrap:    { position: 'relative', marginBottom: 10 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: WHITE, fontSize: 28, fontWeight: '800' },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: GRAY, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: BG,
  },
  avatarHint: { color: GRAY, fontSize: 12 },

  sectionHeader: {
    color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: CARD, borderRadius: 14, marginBottom: 28, overflow: 'hidden',
  },
  field:      { paddingVertical: 12, paddingHorizontal: 16 },
  fieldLabel: { color: GRAY, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  fieldInput: { color: BLACK, fontSize: 15, fontWeight: '500', paddingVertical: 2 },
  divider:    { height: 1, backgroundColor: GRAY3, marginLeft: 16 },

  labelFieldHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  charCount:        { color: GRAY2, fontSize: 11 },

  // Map preview card
  mapCard: {
    height: 140, marginHorizontal: 16, marginVertical: 12,
    borderRadius: 12, overflow: 'hidden',
    backgroundColor: CARD,
  },
  mapCardPin: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: WHITE,
  },
  mapCardLabel: {
    position: 'absolute', bottom: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20,
  },
  mapCardLabelText: { color: WHITE, fontSize: 12, fontWeight: '700' },
  mapCardRadius:    { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '500' },

  geoProfileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  geoProfileBtnText: { color: BLACK, fontSize: 14, fontWeight: '600' },

  geoItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16 },
  geoItemIndex:  { color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  geoItemActions: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 10,
  },
  geoActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: CARD, borderRadius: 10,
    borderWidth: 1, borderColor: GRAY3,
  },
  geoActionRemove: { marginLeft: 'auto' },
  geoActionBtnText: { color: BLACK, fontSize: 13, fontWeight: '600' },
  geoAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 0,
  },

  geoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14,
    borderWidth: 1, borderColor: GRAY3,
  },
  geoBannerText: { color: BLACK, fontSize: 13, fontWeight: '600', flex: 1 },
}); }
