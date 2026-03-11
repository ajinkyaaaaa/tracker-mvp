// AdminBugReportsScreen.js — Bug reports inbox for admins
// Navigated to from AdminDashboardScreen.js → bug reports entry point
// Data: api.getBugReports() → GET /api/bugs (routes/bugs.py)
// Resolve action: api.resolveBug(id) → PATCH /api/bugs/:id/resolve

import { useState, useEffect, useCallback }                   from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet,
         SafeAreaView, ActivityIndicator, Alert }              from 'react-native';
import { MaterialIcons }                                       from '@expo/vector-icons';
import { api }                                                 from '../services/api';

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';
const GREEN = '#34C759';
const RED   = '#FF3B30';

// Formats a SQLite datetime string for display
function formatDate(raw) {
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })
       + '  '
       + d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

// Single bug report card
function BugCard({ report, onResolve }) {
  const isOpen = report.status === 'open';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardUser}>
          <Text style={styles.cardName}>{report.user_name}</Text>
          <Text style={styles.cardEmail}>{report.user_email}</Text>
        </View>
        <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeResolved]}>
          <Text style={[styles.badgeText, { color: isOpen ? RED : GREEN }]}>
            {isOpen ? 'Open' : 'Resolved'}
          </Text>
        </View>
      </View>

      <Text style={styles.cardDesc}>{report.description}</Text>
      <Text style={styles.cardDate}>{formatDate(report.created_at)}</Text>

      {isOpen && (
        <TouchableOpacity style={styles.resolveBtn} onPress={() => onResolve(report.id)} activeOpacity={0.8}>
          <MaterialIcons name="check-circle-outline" size={16} color={WHITE} />
          <Text style={styles.resolveBtnText}>Mark Resolved</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Navigated to from AdminDashboardScreen via AdminStack (App.js → AdminRoot)
export default function AdminBugReportsScreen({ navigation }) {
  const [reports,  setReports]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.getBugReports();   // GET /api/bugs
      setReports(data.reports);
    } catch (e) {
      setError(e.message || 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleResolve(id) {
    Alert.alert('Mark as Resolved', 'Are you sure you want to mark this report as resolved?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resolve', onPress: async () => {
          try {
            await api.resolveBug(id);   // PATCH /api/bugs/:id/resolve
            setReports(prev => prev.map(r => r.id === id ? { ...r, status: 'resolved' } : r));
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bug Reports</Text>
        <TouchableOpacity style={styles.backBtn} onPress={load}>
          <MaterialIcons name="refresh" size={22} color={BLACK} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={BLACK} />
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.centre}>
          <MaterialIcons name="bug-report" size={48} color={GRAY2} />
          <Text style={styles.emptyText}>No bug reports yet</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={r => String(r.id)}
          renderItem={({ item }) => <BugCard report={item} onResolve={handleResolve} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
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

  list: { padding: 16, gap: 12, paddingBottom: 40 },

  card: {
    backgroundColor: CARD, borderRadius: 16,
    padding: 16, gap: 10,
  },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardUser:     { gap: 2, flex: 1 },
  cardName:     { color: BLACK, fontSize: 15, fontWeight: '700' },
  cardEmail:    { color: GRAY,  fontSize: 12 },
  badge:        { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeOpen:    { backgroundColor: '#FFF0EF' },
  badgeResolved:{ backgroundColor: '#EDFBF1' },
  badgeText:    { fontSize: 12, fontWeight: '700' },
  cardDesc:     { color: BLACK, fontSize: 14, lineHeight: 20 },
  cardDate:     { color: GRAY2, fontSize: 11 },

  resolveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BLACK, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, alignSelf: 'flex-start',
  },
  resolveBtnText: { color: WHITE, fontSize: 13, fontWeight: '700' },

  centre:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { color: RED, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn:  { backgroundColor: BLACK, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  emptyText: { color: GRAY, fontSize: 16, fontWeight: '600' },
});
