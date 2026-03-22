// AdminEmployeesScreen.js — Employee list tab (admin)
// Displayed as the "Employees" tab inside AdminTabs (App.js → AdminRoot).
//
// Data flows:
//   GET /api/admin/employees → api.getEmployees() → employee FlatList
//   Tap employee card → navigate('AdminDayLog', { employee: { id, name } })
//
// Search filters by name or email. Online dot colour reflects is_online.
// Pull-to-refresh and useFocusEffect reload the list.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect }    from '@react-navigation/native';
import { MaterialIcons }     from '@expo/vector-icons';
import { useTheme }          from '../contexts/ThemeContext';
import { api }               from '../services/api';

// Generates a 1–2 letter avatar from an employee name
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

export default function AdminEmployeesScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();

  const [employees,  setEmployees]  = useState([]);
  const [query,      setQuery]      = useState('');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Reload employee list on every screen focus → GET /api/admin/employees
  useFocusEffect(
    useCallback(() => {
      loadEmployees(false);
    }, [])
  );

  // Fetches all employees from API; sets loading/refreshing state accordingly
  async function loadEmployees(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await api.getEmployees();
      setEmployees(data);
    } catch {}
    if (isRefresh) setRefreshing(false); else setLoading(false);
  }

  // Filters employee list by name or email substring (case-insensitive)
  const filtered = query.trim()
    ? employees.filter(e =>
        e.name?.toLowerCase().includes(query.toLowerCase()) ||
        e.email?.toLowerCase().includes(query.toLowerCase())
      )
    : employees;

  // Renders a single employee row card
  function renderEmployee({ item }) {
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: CARD }]}
        onPress={() => navigation.navigate('AdminDayLog', { employee: { id: item.id, name: item.name } })}
        activeOpacity={0.75}
      >
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: BLACK }]}>
          <Text style={[styles.avatarText, { color: WHITE }]}>{initials(item.name)}</Text>
        </View>

        {/* Name + email */}
        <View style={styles.cardInfo}>
          <Text style={[styles.cardName, { color: BLACK }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.cardEmail, { color: GRAY }]} numberOfLines={1}>{item.email}</Text>
        </View>

        {/* Online dot */}
        <View style={[styles.onlineDot, { backgroundColor: item.is_online ? '#34C759' : GRAY2 }]} />
        <MaterialIcons name="chevron-right" size={20} color={GRAY2} />
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <Text style={[styles.headerTitle, { color: BLACK }]}>Employees</Text>
        <Text style={[styles.headerCount, { color: GRAY }]}>{employees.length}</Text>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: CARD }]}>
        <MaterialIcons name="search" size={18} color={GRAY2} />
        <TextInput
          style={[styles.searchInput, { color: BLACK }]}
          placeholder="Search by name or email"
          placeholderTextColor={GRAY2}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={16} color={GRAY2} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BLACK} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEmployee}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadEmployees(true)}
              tintColor={BLACK}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="people" size={36} color={GRAY2} />
              <Text style={[styles.emptyText, { color: GRAY }]}>No employees found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', flex: 1 },
  headerCount: { fontSize: 15, fontWeight: '600' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },

  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },

  // Avatar circle
  avatar:     { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800' },

  cardInfo:  { flex: 1 },
  cardName:  { fontSize: 15, fontWeight: '700' },
  cardEmail: { fontSize: 13, fontWeight: '500', marginTop: 2 },

  onlineDot: { width: 9, height: 9, borderRadius: 4.5 },

  empty:     { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyText: { fontSize: 15, fontWeight: '600' },
});
