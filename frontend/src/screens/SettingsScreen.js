// SettingsScreen.js — User settings root screen
// Navigated to from MapScreen.js → ribbon settings icon → navigation.navigate('Settings')
// Sections: Account (Manage Profile, Password & Security, Notifications)
//           Preferences (Theme)
//           Support (Report a Bug)

import { useEffect, useState }                             from 'react';
import { View, Text, ScrollView, TouchableOpacity,
         StyleSheet, SafeAreaView }                        from 'react-native';
import AsyncStorage                                        from '@react-native-async-storage/async-storage';
import { MaterialIcons }                                   from '@expo/vector-icons';
import { useAuth }                                         from '../contexts/AuthContext';

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';
const RED   = '#FF3B30';

// Single settings row — icon + label + optional right-side value + chevron
function SettingsRow({ icon, label, value, onPress, last }) {
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

// Navigated to from MapScreen ribbon → settings icon
// user from AuthContext; theme read from AsyncStorage
export default function SettingsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState('Light');

  // Load saved theme label on mount — set by ThemeScreen.js
  useEffect(() => {
    AsyncStorage.getItem('app_theme').then(v => { if (v) setTheme(v === 'dark' ? 'Dark' : 'Light'); });
  }, []);

  // Refresh theme value when returning from ThemeScreen
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      AsyncStorage.getItem('app_theme').then(v => { if (v) setTheme(v === 'dark' ? 'Dark' : 'Light'); });
    });
    return unsub;
  }, [navigation]);

  const initials   = (user?.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const empCode    = `EMP-${String(user?.id || 0).padStart(3, '0')}`;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

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
          <SettingsRow icon="person-outline"   label="Manage Profile"       onPress={() => navigation.navigate('ManageProfile')} />
          <SettingsRow icon="lock-outline"     label="Password & Security"  onPress={() => navigation.navigate('PasswordSecurity')} />
          <SettingsRow icon="notifications-none" label="Notifications"      onPress={() => navigation.navigate('NotificationsSettings')} last />
        </View>

        {/* Preferences */}
        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <View style={styles.sectionCard}>
          <SettingsRow icon="brightness-6" label="Theme" value={theme} onPress={() => navigation.navigate('ThemeSettings')} last />
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

  scroll: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 48 },

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
