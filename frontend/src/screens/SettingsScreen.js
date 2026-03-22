// SettingsScreen.js — User settings root screen
// Navigated to from NavPill → Settings tab across all employee screens
// Sections: Account (Manage Profile, Password & Security, Notifications)
//           Preferences (Theme)
//           Support (Report a Bug)

import { useState, useEffect, useRef }                        from 'react';
import { View, Text, ScrollView, TouchableOpacity,
         StyleSheet, Animated, Modal, TextInput, Alert }      from 'react-native';
import { MaterialIcons }                                      from '@expo/vector-icons';
import AsyncStorage                                           from '@react-native-async-storage/async-storage';
import { useAuth }                                            from '../contexts/AuthContext';
import { useTheme }                                           from '../contexts/ThemeContext';
import NavPill                                                from '../components/NavPill';
import { api }                                                from '../services/api';
import { clearLocalDB }                                       from '../services/localDatabase';

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

  const [clearModalVisible, setClearModalVisible] = useState(false);
  const [clearCode,         setClearCode]         = useState('');
  const [clearLoading,      setClearLoading]       = useState(false);

  const navAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(navAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  async function handleClearStorage() {
    setClearLoading(true);
    try {
      await api.verifyStorageClearCode(clearCode);
      await clearLocalDB();
      await AsyncStorage.removeItem('cached_locations');
      setClearModalVisible(false);
      setClearCode('');
      Alert.alert('Done', 'Local storage has been cleared.');
    } catch (e) {
      Alert.alert('Failed', e.message || 'Incorrect code or server error.');
    } finally {
      setClearLoading(false);
    }
  }

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
          <SettingsRow icon="help-outline" label="FAQ"           onPress={() => navigation.navigate('FAQ')} />
          <SettingsRow icon="bug-report"   label="Report a Bug"  onPress={() => navigation.navigate('ReportBug')} last />
        </View>

        {/* Data */}
        <Text style={styles.sectionHeader}>DATA</Text>
        <View style={styles.sectionCard}>
          <SettingsRow icon="delete-sweep" label="Clear Local Storage" onPress={() => { setClearCode(''); setClearModalVisible(true); }} last />
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

      {/* ── Clear Local Storage modal ── */}
      <Modal visible={clearModalVisible} transparent animationType="fade" onRequestClose={() => setClearModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Clear Local Storage</Text>
            <Text style={styles.modalSubtitle}>Enter the admin code to erase all local data from this device.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Admin code"
              placeholderTextColor={GRAY2}
              value={clearCode}
              onChangeText={setClearCode}
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setClearModalVisible(false)} activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, (!clearCode || clearLoading) && { opacity: 0.4 }]}
                onPress={handleClearStorage}
                disabled={!clearCode || clearLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.modalConfirmText}>{clearLoading ? 'Verifying…' : 'Clear'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

  // Clear storage modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: BG, borderRadius: 18,
    padding: 24, width: '100%', gap: 12,
  },
  modalTitle:    { color: BLACK, fontSize: 17, fontWeight: '800' },
  modalSubtitle: { color: GRAY,  fontSize: 13, lineHeight: 18 },
  modalInput: {
    backgroundColor: CARD, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: BLACK, fontSize: 15, borderWidth: 1, borderColor: GRAY3,
    marginTop: 4,
  },
  modalButtons:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancelBtn:  { flex: 1, backgroundColor: CARD, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: GRAY3 },
  modalCancelText: { color: BLACK, fontSize: 14, fontWeight: '600' },
  modalConfirmBtn: { flex: 1, backgroundColor: BLACK, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalConfirmText:{ color: WHITE, fontSize: 14, fontWeight: '700' },
  });
}
