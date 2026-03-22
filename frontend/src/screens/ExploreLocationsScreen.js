// ExploreLocationsScreen.js — Browse, edit, and delete saved locations
// Data flows:
//   AsyncStorage saved_locations_data → client / site / rest-stop pins
//   AsyncStorage base_locations_data / home_locations_data → base + home geo profiles
//   Edit saved loc    → navigate to RegisterLocationScreen in edit mode → AsyncStorage updated on save
//   Delete saved loc  → filter AsyncStorage saved_locations_data
//   Delete geo profile → filter AsyncStorage base/home + PUT /api/profile/geo
// Navigated to from MapScreen.js → "Explore locations" button

import { useState, useCallback, useMemo, useRef }             from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView,
         TextInput, StyleSheet, SafeAreaView, Alert,
         ActivityIndicator }                                   from 'react-native';
import { useFocusEffect }                                      from '@react-navigation/native';
import AsyncStorage                                            from '@react-native-async-storage/async-storage';
import { MaterialIcons }                                       from '@expo/vector-icons';
import { api }                                                 from '../services/api';

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const CARD  = '#F2F2F7';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const RED   = '#FF3B30';

const BASE_LOCATIONS_KEY = 'base_locations_data';
const HOME_LOCATIONS_KEY = 'home_locations_data';
const SAVED_LOCATIONS_KEY = 'saved_locations_data';

const FILTERS = [
  { key: 'all',       label: 'All',       icon: 'layers' },
  { key: 'client',    label: 'Client',    icon: 'people' },
  { key: 'site',      label: 'Site',      icon: 'factory' },
  { key: 'base',      label: 'Base',      icon: 'star' },
  { key: 'rest-stop', label: 'Rest stop', icon: 'pause' },
  { key: 'home',      label: 'Home',      icon: 'home' },
];

const CATEGORY_ICON  = { base: 'star', home: 'home', client: 'people', site: 'factory', 'rest-stop': 'pause' };
const CATEGORY_LABEL = { base: 'Base', home: 'Home', client: 'Client', site: 'Site', 'rest-stop': 'Rest stop' };

// Loads base + home geo profile arrays from AsyncStorage
async function loadGeoArrays() {
  const [baseArr, homeArr, baseLegacy, homeLegacy] = await Promise.all([
    AsyncStorage.getItem(BASE_LOCATIONS_KEY),
    AsyncStorage.getItem(HOME_LOCATIONS_KEY),
    AsyncStorage.getItem('base_location_data'),
    AsyncStorage.getItem('home_location_data'),
  ]);
  const bases = baseArr ? JSON.parse(baseArr) : baseLegacy ? [JSON.parse(baseLegacy)] : [];
  const homes = homeArr ? JSON.parse(homeArr) : homeLegacy ? [JSON.parse(homeLegacy)] : [];
  return { bases, homes };
}

function getCounts(locations) {
  const counts = { all: locations.length };
  for (const loc of locations) counts[loc.category] = (counts[loc.category] || 0) + 1;
  return counts;
}

function FilterChip({ f, active, count, onPress }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.7}>
      <MaterialIcons name={f.icon} size={13} color={active ? WHITE : GRAY} />
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
      {count > 0 && (
        <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
          <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Single location card with edit (saved locs only) and delete (all)
// Edit navigates to RegisterLocationScreen in edit mode; geo profiles edit in ManageProfileScreen
function LocationCard({ item, onDelete, onEdit }) {
  const isGeo = item.category === 'base' || item.category === 'home';

  return (
    <View style={styles.card}>
      <View style={styles.cardIconWrap}>
        <MaterialIcons name={CATEGORY_ICON[item.category] || 'place'} size={20} color={BLACK} />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.cardCatPill}>
            <Text style={styles.cardCatText}>{CATEGORY_LABEL[item.category] || item.category}</Text>
          </View>
          <Text style={styles.cardCoords} numberOfLines={1}>
            {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
          </Text>
        </View>
        {item.address ? (
          <Text style={styles.cardAddress} numberOfLines={2}>{item.address}</Text>
        ) : null}
      </View>

      <View style={styles.cardActions}>
        {/* Geo profiles are edited inside ManageProfileScreen (they have radius + pin flow) */}
        {!isGeo && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="edit" size={17} color={GRAY} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onDelete(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="delete-outline" size={18} color={RED} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EmptyState({ query, filter }) {
  const hasQuery = query.trim().length > 0;
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconWrap}>
        <MaterialIcons name={hasQuery ? 'search-off' : 'explore'} size={30} color={BLACK} />
      </View>
      <Text style={styles.emptyTitle}>
        {hasQuery ? 'No results found' : filter === 'all' ? 'No locations yet' : `No ${CATEGORY_LABEL[filter] || filter} locations`}
      </Text>
      <Text style={styles.emptySub}>
        {hasQuery
          ? `Nothing matched "${query}". Try a different name.`
          : filter === 'all'
            ? 'Mark locations on the map and they\'ll appear here.'
            : `You haven\'t saved any ${CATEGORY_LABEL[filter] || filter} locations yet.`}
      </Text>
    </View>
  );
}

export default function ExploreLocationsScreen({ navigation }) {
  const [all,       setAll]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all');
  const [query,     setQuery]     = useState('');

  // Raw mutable arrays kept in refs so delete/rename can read latest without stale closures
  const savedRef = useRef([]);
  const basesRef = useRef([]);
  const homesRef = useRef([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        AsyncStorage.getItem(SAVED_LOCATIONS_KEY).then(r => r ? JSON.parse(r) : []).catch(() => []),
        loadGeoArrays().catch(() => ({ bases: [], homes: [] })),
      ])
        .then(([saved, { bases, homes }]) => {
          if (!active) return;
          savedRef.current = saved;
          basesRef.current = bases;
          homesRef.current = homes;
          setAll(buildAll(bases, homes, saved));
        })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  // Merges geo + saved arrays into the flat display list
  function buildAll(bases, homes, saved) {
    return [
      ...bases.map((l, i) => ({ id: `base-${i}`, name: l.name || `Base ${i + 1}`, category: 'base', latitude: l.latitude, longitude: l.longitude, _idx: i })),
      ...homes.map((l, i) => ({ id: `home-${i}`, name: l.name || `Home ${i + 1}`, category: 'home', latitude: l.latitude, longitude: l.longitude, _idx: i })),
      ...saved.map(l       => ({ ...l, id: l.id ?? String(l.name) })),
    ];
  }

  // Removes a saved location from AsyncStorage by id
  async function deleteSavedLoc(item) {
    const newSaved = savedRef.current.filter(l => l.id !== item.id);
    savedRef.current = newSaved;
    await AsyncStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(newSaved));
    setAll(buildAll(basesRef.current, homesRef.current, newSaved));
  }

  // Removes a geo profile by index from the appropriate AsyncStorage key + server
  async function deleteGeoProfile(item) {
    const isBase = item.category === 'base';
    if (isBase) {
      const newBases = basesRef.current.filter((_, i) => i !== item._idx);
      basesRef.current = newBases;
      await AsyncStorage.setItem(BASE_LOCATIONS_KEY, JSON.stringify(newBases));
      api.setGeoProfiles(newBases, homesRef.current).catch(() => {});  // PUT /api/profile/geo
      setAll(buildAll(newBases, homesRef.current, savedRef.current));
    } else {
      const newHomes = homesRef.current.filter((_, i) => i !== item._idx);
      homesRef.current = newHomes;
      await AsyncStorage.setItem(HOME_LOCATIONS_KEY, JSON.stringify(newHomes));
      api.setGeoProfiles(basesRef.current, newHomes).catch(() => {});  // PUT /api/profile/geo
      setAll(buildAll(basesRef.current, newHomes, savedRef.current));
    }
  }

  // Handles delete for any location type — confirms before deleting
  function handleDelete(item) {
    const isGeo = item.category === 'base' || item.category === 'home';
    Alert.alert(
      'Delete Location',
      `Remove "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => isGeo ? deleteGeoProfile(item) : deleteSavedLoc(item),
        },
      ]
    );
  }

  // Navigates to RegisterLocationScreen in edit mode → handles all field edits incl. pin location
  function handleEdit(item) {
    navigation.navigate('RegisterLocation', {
      editId:    item.id,
      name:      item.name,
      category:  item.category,
      latitude:  item.latitude,
      longitude: item.longitude,
      radius:    item.radius ?? 100,
      address:   item.address ?? '',
    });
  }

  // Apply category filter then search query
  const filtered = useMemo(() => {
    let result = filter === 'all' ? all : all.filter(l => l.category === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(l => l.name.toLowerCase().includes(q));
    }
    return result;
  }, [all, filter, query]);

  const counts = getCounts(all);

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Explore Locations</Text>
          {!loading && (
            <Text style={styles.headerSub}>{all.length} location{all.length !== 1 ? 's' : ''} saved</Text>
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* ── Search + Filters ── */}
      <View style={styles.searchSection}>
        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={18} color={GRAY} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search locations…"
            placeholderTextColor={GRAY2}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="cancel" size={16} color={GRAY2} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {FILTERS.map(f => (
            <FilterChip key={f.key} f={f} active={filter === f.key} count={counts[f.key] || 0} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.divider} />

      {/* ── List ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BLACK} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState query={query} filter={filter} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={d => String(d.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <LocationCard
              item={item}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          )}
        />
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
  },
  backBtn:     { width: 36 },
  headerTitle: { color: BLACK, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  headerSub:   { color: GRAY, fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 2 },

  // Search + Filters
  searchSection: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 10,
    backgroundColor: CARD, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: GRAY3,
  },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: BLACK, paddingVertical: 0 },
  filtersRow:  { gap: 8, alignItems: 'center' },
  divider:     { height: 1, backgroundColor: GRAY3, marginBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 20, borderWidth: 1, borderColor: GRAY3, backgroundColor: WHITE,
  },
  chipActive:          { backgroundColor: BLACK, borderColor: BLACK },
  chipText:            { color: GRAY, fontSize: 13, fontWeight: '600' },
  chipTextActive:      { color: WHITE },
  chipBadge:           { backgroundColor: GRAY3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  chipBadgeActive:     { backgroundColor: 'rgba(255,255,255,0.18)' },
  chipBadgeText:       { color: GRAY, fontSize: 11, fontWeight: '700' },
  chipBadgeTextActive: { color: WHITE },

  // List
  list:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },
  separator: { height: 10 },

  // Card
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: WHITE, borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 14,
    borderWidth: 1, borderColor: GRAY3,
    shadowColor: BLACK, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
  },
  cardIconWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: CARD, justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  cardBody:    { flex: 1 },
  cardName:    { color: BLACK, fontSize: 15, fontWeight: '700', marginBottom: 5 },
  cardMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardCatPill: { backgroundColor: CARD, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  cardCatText: { color: GRAY, fontSize: 11, fontWeight: '700' },
  cardCoords:  { color: GRAY2, fontSize: 11, fontWeight: '500', flex: 1 },
  cardAddress: { color: GRAY, fontSize: 12, marginTop: 4, lineHeight: 17 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  actionBtn:   { padding: 4 },

  // States
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText:  { color: GRAY, fontSize: 13, fontWeight: '500' },
  emptyWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIconWrap:{ width: 64, height: 64, borderRadius: 20, backgroundColor: CARD, justifyContent: 'center', alignItems: 'center' },
  emptyTitle:   { color: BLACK, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptySub:     { color: GRAY, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
