// StopResponseModal.js — Reusable modal for responding to an idle stop
// Extracted from ArchiveScreen.js; also used by SyncScreen.js.
//
// Data flows:
//   onSubmit(text)  → respondToStop() in ArchiveScreen / SyncScreen → localDatabase.js
//   onMute(hours)   → AsyncStorage muted_locations + respondToStop() in parent screen
//   onClose()       → parent clears selectedActivity state

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Animated, useRef,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const BG    = '#FFFFFF';
const CARD  = '#F2F2F7';
const BLACK = '#000000';
const GRAY  = '#6D6D72';
const GRAY2 = '#C7C7CC';
const GRAY3 = '#E5E5EA';
const WHITE = '#FFFFFF';

const QUICK_ACTIONS    = [
  { label: 'Traffic',      icon: '🚗' },
  { label: 'Refreshments', icon: '☕' },
  { label: 'Rest Stop',    icon: '🛏' },
];
const MUTE_HOURS_OPTIONS = [1, 2, 4, 8];

function ScalePress({ onPress, style, children, disabled }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      disabled={disabled}
      onPressIn={() => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 60 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 60 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

// activity: stop object with { id, triggered_at, dwell_duration, latitude, longitude }
// onSubmit(text): parent calls respondToStop and reloads
// onMute(hours):  parent writes AsyncStorage mute + calls respondToStop
// onClose():      parent clears selectedActivity
export default function StopResponseModal({ activity, onSubmit, onMute, onClose }) {
  const [responseText,    setResponseText]    = useState('');
  const [showMuteOptions, setShowMuteOptions] = useState(false);

  function formatTime(ts) {
    if (!ts) return '';
    const date = ts.includes('T') || ts.includes('Z') ? new Date(ts) : new Date(ts + 'Z');
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function handleSubmit(text) {
    if (!text.trim()) return;
    setResponseText('');
    onSubmit(text.trim());
  }

  return (
    <Modal visible={!!activity} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        <View style={styles.card}>
          <View style={styles.handle} />
          <Text style={styles.title}>What were you doing here?</Text>

          {activity && (
            <Text style={styles.time}>
              at {formatTime(activity.triggered_at)}
              {activity.dwell_duration > 0 && `  ·  ${activity.dwell_duration} min stop`}
            </Text>
          )}

          {/* Quick chips */}
          <View style={styles.quickRow}>
            {QUICK_ACTIONS.map((a) => (
              <ScalePress key={a.label} style={styles.quickChip} onPress={() => handleSubmit(a.label)}>
                <Text style={styles.quickChipIcon}>{a.icon}</Text>
                <Text style={styles.quickChipText}>{a.label}</Text>
              </ScalePress>
            ))}
          </View>

          {/* Text input */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Or type your activity…"
              placeholderTextColor={GRAY2}
              value={responseText}
              onChangeText={setResponseText}
            />
            <ScalePress
              style={[styles.sendBtn, !responseText.trim() && styles.sendBtnOff]}
              onPress={() => handleSubmit(responseText)}
              disabled={!responseText.trim()}
            >
              <Ionicons name="arrow-up" size={20} color={WHITE} />
            </ScalePress>
          </View>

          {/* Mute */}
          <View style={styles.muteSection}>
            {!showMuteOptions ? (
              <TouchableOpacity onPress={() => setShowMuteOptions(true)} style={styles.muteToggle}>
                <Text style={styles.muteToggleText}>🔕  Don't ask again at this location</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.muteLabel}>Mute for how long?</Text>
                <View style={styles.muteRow}>
                  {MUTE_HOURS_OPTIONS.map((h) => (
                    <ScalePress key={h} style={styles.muteChip} onPress={() => onMute(h)}>
                      <Text style={styles.muteChipText}>{h}h</Text>
                    </ScalePress>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  card: {
    backgroundColor: BG,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 26, paddingBottom: 44,
    borderTopWidth: 1, borderColor: GRAY3,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 12,
  },
  handle: {
    width: 36, height: 4, backgroundColor: GRAY2,
    borderRadius: 2, alignSelf: 'center', marginBottom: 22,
  },
  title: { color: BLACK, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  time:  { color: GRAY,  fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 22 },

  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: CARD, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: GRAY3,
  },
  quickChipIcon: { fontSize: 15 },
  quickChipText: { color: BLACK, fontSize: 14, fontWeight: '700' },

  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  chatInput: {
    flex: 1, backgroundColor: CARD,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
    color: BLACK, fontSize: 15, borderWidth: 1, borderColor: GRAY3,
  },
  sendBtn:    { width: 46, height: 46, borderRadius: 23, backgroundColor: BLACK, justifyContent: 'center', alignItems: 'center' },
  sendBtnOff: { opacity: 0.25 },

  muteSection:    { marginTop: 18 },
  muteToggle:     { alignSelf: 'center', paddingVertical: 10 },
  muteToggleText: { color: GRAY, fontSize: 14 },
  muteLabel:      { color: GRAY, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  muteRow:        { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  muteChip: {
    backgroundColor: CARD, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 11,
    borderWidth: 1, borderColor: GRAY3,
  },
  muteChipText: { color: BLACK, fontSize: 15, fontWeight: '800' },
});
