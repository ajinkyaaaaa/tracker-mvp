// settings/ThemeScreen.js — App theme selection (Light / Dark)
// Navigated to from SettingsScreen.js → Theme row
// Calls useTheme().setTheme() → updates ThemeContext (ThemeContext.js) + writes AsyncStorage 'app_theme'

import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { MaterialIcons }                                           from '@expo/vector-icons';
import { useTheme }                                               from '../../contexts/ThemeContext';

const THEMES = [
  { key: 'light', label: 'Light', icon: 'light-mode' },
  { key: 'dark',  label: 'Dark',  icon: 'dark-mode'  },
];

// Navigated to from SettingsScreen.js → Theme row
export default function ThemeScreen({ navigation }) {
  const { isDark, setTheme, BG, CARD, BLACK, GRAY, GRAY3 } = useTheme();
  const selected = isDark ? 'dark' : 'light';
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY3 });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Theme</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.scroll}>
        <Text style={styles.sectionHeader}>APPEARANCE</Text>
        <View style={styles.sectionCard}>
          {THEMES.map((theme, i) => (
            <View key={theme.key}>
              <TouchableOpacity style={styles.row} onPress={() => setTheme(theme.key)} activeOpacity={0.7}>
                <View style={styles.rowLeft}>
                  <MaterialIcons name={theme.icon} size={20} color={BLACK} />
                  <Text style={styles.rowLabel}>{theme.label}</Text>
                </View>
                {selected === theme.key && (
                  <MaterialIcons name="check" size={20} color={BLACK} />
                )}
              </TouchableOpacity>
              {i < THEMES.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY3 }) {
  return StyleSheet.create({
    safe:   { flex: 1, backgroundColor: BG },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: GRAY3,
    },
    backBtn:     { width: 36, alignItems: 'flex-start' },
    headerTitle: { color: BLACK, fontSize: 17, fontWeight: '700' },

    scroll: { paddingHorizontal: 16, paddingTop: 28 },
    sectionHeader: {
      color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
      marginBottom: 8, marginLeft: 4,
    },
    sectionCard: { backgroundColor: CARD, borderRadius: 14, overflow: 'hidden' },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 15, paddingHorizontal: 16,
    },
    rowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowLabel: { color: BLACK, fontSize: 15, fontWeight: '500' },
    divider:  { height: 1, backgroundColor: GRAY3, marginLeft: 48 },
  });
}
