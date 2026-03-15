// settings/PasswordSecurityScreen.js — Change account password
// Navigated to from SettingsScreen.js → Password & Security row
// Calls api.changePassword() → POST /api/auth/change-password (routes/auth.py)

import { useState }                                           from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet,
         SafeAreaView, Alert, KeyboardAvoidingView,
         Platform, ScrollView }                               from 'react-native';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { api }                                                from '../../services/api';
import { useTheme }                                           from '../../contexts/ThemeContext';

const RED   = '#FF3B30';

// Password input with show/hide toggle
function PasswordField({ label, value, onChangeText }) {
  const { GRAY, GRAY2 } = useTheme();
  const styles = makeStyles(useTheme());
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChangeText}
          placeholder="••••••••"
          placeholderTextColor={GRAY2}
          secureTextEntry={!visible}
          autoCapitalize="none"
        />
        <TouchableOpacity onPress={() => setVisible(v => !v)}>
          <MaterialIcons name={visible ? 'visibility-off' : 'visibility'} size={20} color={GRAY} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Navigated to from SettingsScreen.js → Password & Security row
export default function PasswordSecurityScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const [current,  setCurrent]  = useState('');
  const [newPw,    setNewPw]    = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function handleSave() {
    setError('');
    if (!current || !newPw || !confirm) { setError('All fields are required.'); return; }
    if (newPw.length < 6)               { setError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirm)              { setError('New passwords do not match.'); return; }

    setSaving(true);
    try {
      await api.changePassword(current, newPw);   // POST /api/auth/change-password
      setCurrent(''); setNewPw(''); setConfirm('');
      Alert.alert('Success', 'Your password has been updated.');
    } catch (e) {
      setError(e.message || 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Password & Security</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <Text style={styles.sectionHeader}>CHANGE PASSWORD</Text>
          <View style={styles.sectionCard}>
            <PasswordField label="Current Password" value={current} onChangeText={setCurrent} />
            <View style={styles.divider} />
            <PasswordField label="New Password"     value={newPw}   onChangeText={setNewPw} />
            <View style={styles.divider} />
            <PasswordField label="Confirm Password" value={confirm} onChangeText={setConfirm} />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Update Password'}</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) { return StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: GRAY3,
  },
  backBtn:     { width: 36, alignItems: 'flex-start' },
  headerTitle: { color: BLACK, fontSize: 17, fontWeight: '700' },
  scroll:      { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 48 },

  sectionHeader: {
    color: GRAY, fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: CARD, borderRadius: 14, marginBottom: 20, overflow: 'hidden',
  },
  field:     { paddingVertical: 12, paddingHorizontal: 16 },
  fieldLabel:{ color: GRAY, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  fieldRow:  { flexDirection: 'row', alignItems: 'center' },
  fieldInput:{ flex: 1, color: BLACK, fontSize: 15, fontWeight: '500', paddingVertical: 2 },
  divider:   { height: 1, backgroundColor: GRAY3, marginLeft: 16 },

  errorText: { color: RED, fontSize: 13, marginBottom: 16, marginLeft: 4 },

  saveBtn:     { backgroundColor: BLACK, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },
}); }
