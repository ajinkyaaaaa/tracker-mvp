// AdminSettingsScreen.js — Settings tab for admin
// Displayed as the "Settings" tab inside AdminTabs (App.js → AdminRoot).
//
// Data flows:
//   useAuth() → user (name, email) → admin avatar card
//   navigate('AdminConfigurations') → AdminConfigurationsScreen.js
//   navigate('AdminBugReports')     → AdminBugReportsScreen.js
//   useAuth().logout()              → clears JWT and returns to login
//
// Configurations row uses an indigo (#4F46E5) accent — the only non-B&W accent in the admin UI.

import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView,
} from 'react-native';
import { MaterialIcons }  from '@expo/vector-icons';
import { useTheme }       from '../contexts/ThemeContext';
import { useAuth }        from '../contexts/AuthContext';

const INDIGO = '#4F46E5';

// Generates 1–2 letter initials from a name string
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

// Renders a standard settings row (icon, title, optional subtitle, chevron)
function SettingsRow({ iconName, iconBg, label, subtitle, onPress, borderColor, tintColor }) {
  return (
    <TouchableOpacity
      style={[styles.row, tintColor && { borderColor: tintColor, borderWidth: 1 }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg || '#F2F2F7' }]}>
        <MaterialIcons name={iconName} size={20} color={tintColor || '#000000'} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: tintColor || '#000000' }]}>{label}</Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      <MaterialIcons name="chevron-right" size={20} color={tintColor || '#C7C7CC'} />
    </TouchableOpacity>
  );
}

// Section wrapper with a title label above the rows
function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

export default function AdminSettingsScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG }]}>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: GRAY3 }]}>
        <Text style={[styles.headerTitle, { color: BLACK }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Admin avatar card */}
        <View style={[styles.avatarCard, { backgroundColor: CARD }]}>
          <View style={[styles.avatar, { backgroundColor: BLACK }]}>
            <Text style={[styles.avatarText, { color: WHITE }]}>{initials(user?.name)}</Text>
          </View>
          <View style={styles.avatarInfo}>
            <Text style={[styles.avatarName, { color: BLACK }]}>{user?.name || 'Admin'}</Text>
            <Text style={[styles.avatarEmail, { color: GRAY }]}>{user?.email || ''}</Text>
            <View style={[styles.roleBadge, { backgroundColor: BLACK }]}>
              <Text style={[styles.roleBadgeText, { color: WHITE }]}>Administrator</Text>
            </View>
          </View>
        </View>

        {/* ADMIN section */}
        <Section title="ADMIN">
          {/* Configurations row — indigo accent */}
          <TouchableOpacity
            style={[styles.row, styles.indigoRow]}
            onPress={() => navigation.navigate('AdminConfigurations')}
            activeOpacity={0.75}
          >
            <View style={[styles.rowIcon, { backgroundColor: INDIGO }]}>
              <MaterialIcons name="tune" size={20} color={WHITE} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: INDIGO }]}>Configurations</Text>
              <Text style={[styles.rowSub, { color: GRAY }]} numberOfLines={1}>
                Login deadline, auto-logout, tracking intervals
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={INDIGO} />
          </TouchableOpacity>
        </Section>

        {/* SUPPORT section */}
        <Section title="SUPPORT">
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('AdminBugReports')}
            activeOpacity={0.75}
          >
            <View style={[styles.rowIcon, { backgroundColor: CARD }]}>
              <MaterialIcons name="bug-report" size={20} color={BLACK} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: BLACK }]}>Bug Reports</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={GRAY2} />
          </TouchableOpacity>
        </Section>

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: CARD }]}
          onPress={logout}
          activeOpacity={0.75}
        >
          <MaterialIcons name="logout" size={18} color="#FF3B30" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48 },

  header: {
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '800' },

  // Avatar card
  avatarCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 16, marginBottom: 28,
  },
  avatar:     { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800' },
  avatarInfo: { flex: 1, gap: 3 },
  avatarName: { fontSize: 17, fontWeight: '800' },
  avatarEmail:{ fontSize: 13, fontWeight: '500' },
  roleBadge:  { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  roleBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  // Section
  section:      { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, color: '#6D6D72', marginBottom: 8, marginLeft: 2 },
  sectionCard:  { borderRadius: 14, overflow: 'hidden', backgroundColor: '#F2F2F7' },

  // Row
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  rowText: { flex: 1 },
  rowLabel:{ fontSize: 15, fontWeight: '600' },
  rowSub:  { fontSize: 12, color: '#6D6D72', marginTop: 2 },

  // Indigo Configurations row
  indigoRow: {
    borderRadius: 14, borderWidth: 1.5,
    borderColor: INDIGO, backgroundColor: '#EEF2FF',
    marginHorizontal: 0,
  },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16, marginTop: 8,
  },
  logoutText: { fontSize: 16, fontWeight: '700', color: '#FF3B30' },
});
