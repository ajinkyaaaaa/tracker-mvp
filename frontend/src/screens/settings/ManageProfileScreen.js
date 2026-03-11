// settings/ManageProfileScreen.js — Edit profile picture, personal information, geo profiles
// Navigated to from SettingsScreen.js → Manage Profile row
// Receives geo profile data via AsyncStorage '_geo_pending' written by BaseLocationPinScreen
//   (focus listener reads and clears '_geo_pending' on each return)
//
// Data flows:
//   base_location_data AsyncStorage → MapScreen.js (star pin + geofence)
//   home_location_data AsyncStorage → MapScreen.js (home pin + geofence)

import { useState, useEffect, useRef }                        from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput,
         StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView,
         Platform }                                           from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE }           from 'react-native-maps';
import AsyncStorage                                           from '@react-native-async-storage/async-storage';
import * as Location                                          from 'expo-location';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { useAuth }                                            from '../../contexts/AuthContext';

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';

const PROFILE_KEY       = 'user_profile_info';
const BASE_LOCATION_KEY = 'base_location_data';  // { name, icon, latitude, longitude, radius } → MapScreen.js
const HOME_LOCATION_KEY = 'home_location_data';  // { name, icon, latitude, longitude, radius } → MapScreen.js

const LABEL_MAX = 25;

// Simple text input field row
function Field({ label, value, onChangeText, placeholder, keyboardType }) {
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

  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [address,      setAddress]      = useState('');
  const [phone,        setPhone]        = useState('');
  const [state,        setState]        = useState('');
  const [pincode,      setPincode]      = useState('');
  const [country,      setCountry]      = useState('India');

  // Base geo profile — icon always 'star'
  const [baseName,   setBaseName]   = useState('');
  const [baseCoords, setBaseCoords] = useState(null);
  const [baseRadius, setBaseRadius] = useState(100);

  // Home geo profile — icon always 'home'
  const [homeName,   setHomeName]   = useState('');
  const [homeCoords, setHomeCoords] = useState(null);
  const [homeRadius, setHomeRadius] = useState(100);

  const [saving,          setSaving]          = useState(false);
  const [locLoading,      setLocLoading]      = useState(null); // 'base' | 'home' | null
  const [geoBanner,       setGeoBanner]       = useState('');   // shown after returning from pin screen

  // Load all stored data on mount
  useEffect(() => {
    const parts      = (user?.name || '').split(' ');
    const savedFirst = parts[0] || '';
    const savedLast  = parts.slice(1).join(' ') || '';

    AsyncStorage.getItem(PROFILE_KEY).then(raw => {
      if (raw) {
        const d = JSON.parse(raw);
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
    });

    AsyncStorage.getItem(BASE_LOCATION_KEY).then(raw => {
      if (!raw) return;
      const d = JSON.parse(raw);
      setBaseName(d.name ?? '');
      setBaseRadius(d.radius ?? 100);
      if (d.latitude && d.longitude)
        setBaseCoords({ latitude: d.latitude, longitude: d.longitude });
    });

    AsyncStorage.getItem(HOME_LOCATION_KEY).then(raw => {
      if (!raw) return;
      const d = JSON.parse(raw);
      setHomeName(d.name ?? '');
      setHomeRadius(d.radius ?? 100);
      if (d.latitude && d.longitude)
        setHomeCoords({ latitude: d.latitude, longitude: d.longitude });
    });
  }, []);

  // Reads '_geo_pending' written by BaseLocationPinScreen after user confirms a pin
  // Uses focus listener so it fires every time this screen regains focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      const raw = await AsyncStorage.getItem('_geo_pending');
      if (!raw) return;
      await AsyncStorage.removeItem('_geo_pending');
      const { pickedCoords, pickedRadius, locationType } = JSON.parse(raw);
      if (locationType === 'base') {
        setBaseCoords(pickedCoords);
        setBaseRadius(pickedRadius ?? 100);
        setBaseName(prev => prev.trim() || 'Base Location');
      } else if (locationType === 'home') {
        setHomeCoords(pickedCoords);
        setHomeRadius(pickedRadius ?? 100);
        setHomeName(prev => prev.trim() || 'Home');
      }
      setGeoBanner('Geo profile registered — tap Save Changes to confirm.');
    });
    return unsubscribe;
  }, [navigation]);

  // Gets GPS then navigates to BaseLocationPinScreen for the given type
  async function handleAddGeoProfile(type) {
    setLocLoading(type);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location access is required.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const existingCoord = type === 'base' ? baseCoords : homeCoords;
      const existingRadius = type === 'base' ? baseRadius : homeRadius;
      const label = (type === 'base' ? baseName : homeName).trim() ||
                    (type === 'base' ? 'Base Location' : 'Home');
      navigation.navigate('BaseLocationPin', {
        initialCoord:  existingCoord ?? { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        label,
        locationType:  type,
        initialRadius: existingRadius,
      });
    } catch {
      Alert.alert('Error', 'Could not get current location. Try again.');
    } finally {
      setLocLoading(null);
    }
  }

  async function handleSave() {
    if (!firstName.trim()) { Alert.alert('Missing field', 'First name is required.'); return; }
    setSaving(true);
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
        firstName, lastName, address, phone, state, pincode, country,
      }));

      if (baseCoords) {
        await AsyncStorage.setItem(BASE_LOCATION_KEY, JSON.stringify({
          name: baseName || 'Base Location', icon: 'star',
          radius: baseRadius, latitude: baseCoords.latitude, longitude: baseCoords.longitude,
        }));
      } else {
        await AsyncStorage.removeItem(BASE_LOCATION_KEY);
      }

      if (homeCoords) {
        await AsyncStorage.setItem(HOME_LOCATION_KEY, JSON.stringify({
          name: homeName || 'Home', icon: 'home',
          radius: homeRadius, latitude: homeCoords.latitude, longitude: homeCoords.longitude,
        }));
      } else {
        await AsyncStorage.removeItem(HOME_LOCATION_KEY);
      }

      setGeoBanner('');
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch {
      Alert.alert('Error', 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase() || 'U';

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

          {/* Personal information */}
          <Text style={styles.sectionHeader}>PERSONAL INFORMATION</Text>
          <View style={styles.sectionCard}>
            <Field label="First Name"   value={firstName} onChangeText={setFirstName} />
            <View style={styles.divider} />
            <Field label="Last Name"    value={lastName}  onChangeText={setLastName} />
            <View style={styles.divider} />
            <Field label="Phone Number" value={phone}     onChangeText={setPhone} keyboardType="phone-pad" />
            <View style={styles.divider} />
            <Field label="Address"      value={address}   onChangeText={setAddress} />
            <View style={styles.divider} />
            <Field label="State"        value={state}     onChangeText={setState} />
            <View style={styles.divider} />
            <Field label="Pincode"      value={pincode}   onChangeText={setPincode} keyboardType="numeric" />
            <View style={styles.divider} />
            <Field label="Country"      value={country}   onChangeText={setCountry} />
          </View>

          {/* Base geo profile */}
          <Text style={styles.sectionHeader}>BASE GEO PROFILE</Text>
          <View style={styles.sectionCard}>
            <LabelField value={baseName} onChangeText={setBaseName} />
            {baseCoords && (
              <>
                <View style={styles.divider} />
                <GeoProfileCard
                  coord={baseCoords} radius={baseRadius}
                  icon="star" name={baseName || 'Base Location'}
                />
              </>
            )}
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.geoProfileBtn}
              onPress={() => handleAddGeoProfile('base')}
              activeOpacity={0.7}
              disabled={locLoading !== null}
            >
              <MaterialIcons name="star" size={16} color={BLACK} />
              <Text style={styles.geoProfileBtnText}>
                {locLoading === 'base' ? 'Getting location…'
                  : baseCoords ? 'Edit Base Geo Profile' : 'Add Base Geo Profile'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Home geo profile */}
          <Text style={styles.sectionHeader}>HOME GEO PROFILE</Text>
          <View style={styles.sectionCard}>
            <LabelField value={homeName} onChangeText={setHomeName} />
            {homeCoords && (
              <>
                <View style={styles.divider} />
                <GeoProfileCard
                  coord={homeCoords} radius={homeRadius}
                  icon="home" name={homeName || 'Home'}
                />
              </>
            )}
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.geoProfileBtn}
              onPress={() => handleAddGeoProfile('home')}
              activeOpacity={0.7}
              disabled={locLoading !== null}
            >
              <MaterialIcons name="home" size={16} color={BLACK} />
              <Text style={styles.geoProfileBtnText}>
                {locLoading === 'home' ? 'Getting location…'
                  : homeCoords ? 'Edit Home Geo Profile' : 'Add Home Geo Profile'}
              </Text>
            </TouchableOpacity>
          </View>

          {!!geoBanner && (
            <View style={styles.geoBanner}>
              <MaterialIcons name="check-circle-outline" size={15} color={BLACK} />
              <Text style={styles.geoBannerText}>{geoBanner}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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

  geoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14,
    borderWidth: 1, borderColor: GRAY3,
  },
  geoBannerText: { color: BLACK, fontSize: 13, fontWeight: '600', flex: 1 },

  saveBtn:     { backgroundColor: BLACK, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },
});
