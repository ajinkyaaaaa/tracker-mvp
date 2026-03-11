// settings/NotificationsScreen.js — Notification preferences (placeholder)
// Navigated to from SettingsScreen.js → Notifications row

import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { MaterialIcons }                                           from '@expo/vector-icons';

const BG    = '#FFFFFF';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY3 = '#E5E5EA';

export default function NotificationsScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.placeholder}>
        <MaterialIcons name="notifications-none" size={48} color={GRAY} />
        <Text style={styles.placeholderTitle}>Coming Soon</Text>
        <Text style={styles.placeholderSub}>Notification preferences will be available in a future update.</Text>
      </View>
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

  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  placeholderTitle: { color: BLACK, fontSize: 18, fontWeight: '700' },
  placeholderSub:   { color: GRAY,  fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
