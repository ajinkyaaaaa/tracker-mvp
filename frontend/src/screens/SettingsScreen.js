// SettingsScreen.js — User settings root screen
// Navigated to from NavPill → Settings tab across all employee screens
// Sections: Account (Manage Profile, Password & Security, Notifications)
//           Preferences (Theme)
//           Support (Report a Bug)

import { useState, useEffect, useRef }                        from 'react';
import { View, Text, ScrollView, TouchableOpacity,
         StyleSheet, Animated }                               from 'react-native';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { useAuth }                                            from '../contexts/AuthContext';
import { useTheme }                                           from '../contexts/ThemeContext';
import NavPill                                                from '../components/NavPill';

const RED = '#FF3B30';

// Single settings row — icon + label + optional right-side value + chevron
function SettingsRow({ icon, label, value, onPress, last }) {
  const { BLACK, GRAY2 } = useTheme();
  const styles = makeStyles(useTheme());
  return (
    <>
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.rowLeft}>
          <MaterialIcons name={icon} size={20} color={BLACK} style={styles.rowIcon} />
          <Text style={styles.rowLabel}>{label}</Text>
        </View>
        <View style={styles.rowRight}>
          {value ? <Text style={styles.rowValue}>{value}</Text> : null}
          <MaterialIcons name="chevron-right" size={22} color={GRAY2} />
        </View>
      </TouchableOpacity>
      {!last && <View style={styles.rowDivider} />}
    </>
  );
}

// user from AuthContext; theme from ThemeContext.js
// NavPill at top (activeTab="settings") provides navigation to other tabs
export default function SettingsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const { isDark, BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const navAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const empCode  = `EMP-${String(user?.id || 0).padStart(3, '0')}`;

  return (
    <View style={styles.container}>

      {/* ── Nav Pill ── */}
      <NavPill
        activeTab="settings"
        navigation={navigation}
        animValue={navAnim}
        pillBg={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.92)'}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* User card */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.name || 'User'}</Text>
            <Text style={styles.userCode}>{empCode}</Text>
            <Text style={styles.userEmail}>{user?.email || ''}</Text>
          </View>
        </View>

        {/* Account */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.sectionCard}>
          <SettingsRow icon="person-outline"     label="Manage Profile"      onPress={() => navigation.navigate('ManageProfile')} />
          <SettingsRow icon="lock-outline"       label="Password & Security" onPress={() => navigation.navigate('PasswordSecurity')} />
          <SettingsRow icon="notifications-none" label="Notifications"       onPress={() => navigation.navigate('NotificationsSettings')} last />
        </View>

        {/* Preferences */}
        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <View style={styles.sectionCard}>
          <SettingsRow icon="brightness-6" label="Theme" value={isDark ? 'Dark' : 'Light'} onPress={() => navigation.navigate('ThemeSettings')} last />
        </View>

        {/* Support */}
        <Text style={styles.sectionHeader}>SUPPORT</Text>
        <View style={styles.sectionCard}>
          <SettingsRow icon="bug-report" label="Report a Bug" onPress={() => navigation.navigate('ReportBug')} last />
        </View>

        {/* Logout */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.row} onPress={logout} activeOpacity={0.7}>
            <View style={styles.rowLeft}>
              <MaterialIcons name="logout" size={20} color={RED} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: RED }]}>Log Out</Text>
            </View>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // paddingTop clears the nav pill (top 56 + ~52px pill height + 18px gap)
  scroll: { paddingHorizontal: 16, paddingTop: 126, paddingBottom: 48 },

  // User card
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: CARD, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 18,
    marginBottom: 32,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: WHITE, fontSize: 20, fontWeight: '800' },
  userInfo:   { gap: 2 },
  userName:   { color: BLACK, fontSize: 17, fontWeight: '700' },
  userCode:   { color: GRAY,  fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  userEmail:  { color: GRAY,  fontSize: 13, marginTop: 1 },

  // Sections
  sectionHeader: {
    color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: CARD, borderRadius: 14, marginBottom: 28, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 16,
  },
  rowLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon:    {},
  rowLabel:   { color: BLACK, fontSize: 15, fontWeight: '500' },
  rowRight:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue:   { color: GRAY, fontSize: 14 },
  rowDivider: { height: 1, backgroundColor: GRAY3, marginLeft: 48 },
  });
}
