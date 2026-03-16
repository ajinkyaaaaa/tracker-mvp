// NavPill.js — Shared top navigation pill for employee screens
// Used by: MapScreen (Home), ArchiveScreen, SyncScreen, SettingsScreen
// Props:
//   activeTab    — 'home' | 'archive' | 'sync' | 'settings'
//   navigation   — React Navigation prop
//   pendingCount — Archive pending badge count (default 0)
//   animValue    — Animated.Value for fade-in opacity from parent
//   pillBg       — pill background colour (adapts to map/satellite)
//   activeBg     — active capsule background
//   activeColor  — active capsule text + icon colour
//   inactiveColor— inactive tab icon colour

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Animated }          from 'react-native';
import { MaterialIcons }     from '@expo/vector-icons';

const RED   = '#FF3B30';
const WHITE = '#FFFFFF';

const TABS = [
  { key: 'home',     icon: 'near-me',      label: 'Home',     screen: 'Home' },
  { key: 'archive',  icon: 'view-list',    label: 'Archive',  screen: 'Archive' },
  { key: 'sync',     icon: 'cloud-upload', label: 'Sync',     screen: 'Sync' },
  { key: 'settings', icon: 'settings',     label: 'Settings', screen: 'Settings' },
];

export default function NavPill({
  activeTab,
  navigation,
  pendingCount  = 0,
  animValue,
  pillBg        = 'rgba(0,0,0,0.92)',
  activeBg      = WHITE,
  activeColor   = '#000000',
  inactiveColor = 'rgba(255,255,255,0.65)',
}) {
  return (
    <Animated.View style={[styles.pill, { backgroundColor: pillBg, opacity: animValue }]}>
      {TABS.map(({ key, icon, label, screen }) => {
        const isActive = key === activeTab;
        const hasBadge = key === 'archive' && pendingCount > 0;

        if (isActive) {
          return (
            <View key={key} style={styles.tab}>
              <View style={[styles.capsule, { backgroundColor: activeBg }]}>
                <MaterialIcons name={icon} size={15} color={activeColor} />
                <Text style={[styles.activeLabel, { color: activeColor }]}>{label}</Text>
                {hasBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingCount}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={key}
            style={styles.tab}
            onPress={() => navigation.navigate(screen)}
            activeOpacity={0.75}
          >
            <View style={styles.capsule}>
              <View style={styles.iconWrap}>
                <MaterialIcons name={icon} size={20} color={inactiveColor} />
                {hasBadge && <View style={styles.dot} />}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute', top: 56, left: 16, right: 16, zIndex: 10,
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 100, paddingVertical: 6, paddingHorizontal: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 12, elevation: 8,
  },
  tab:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  capsule:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, minWidth: 64,
  },
  activeLabel: { fontSize: 14, fontWeight: '700' },
  iconWrap:    { position: 'relative' },
  badge: {
    backgroundColor: RED, borderRadius: 8,
    minWidth: 16, height: 16, paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  badgeText:   { color: WHITE, fontSize: 10, fontWeight: '900' },
  dot:         { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
});
