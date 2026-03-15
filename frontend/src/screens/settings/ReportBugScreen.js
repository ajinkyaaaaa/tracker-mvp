// settings/ReportBugScreen.js — Bug report submission
// Navigated to from SettingsScreen.js → Report a Bug row
// Submits to api.reportBug() → POST /api/bugs/report (routes/bugs.py)
// Submitted reports appear in AdminBugReportsScreen.js for admins

import { useState }                                           from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet,
         SafeAreaView, Alert, KeyboardAvoidingView,
         Platform, ScrollView }                               from 'react-native';
import { MaterialIcons }                                      from '@expo/vector-icons';
import { api }                                                from '../../services/api';
import { useTheme }                                           from '../../contexts/ThemeContext';

const RED   = '#FF3B30';

// Navigated to from SettingsScreen.js → Report a Bug row
export default function ReportBugScreen({ navigation }) {
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });

  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  async function handleSubmit() {
    setError('');
    if (!description.trim()) { setError('Please describe the bug before submitting.'); return; }

    setSubmitting(true);
    try {
      await api.reportBug(description.trim());   // POST /api/bugs/report
      setDescription('');
      Alert.alert('Report Sent', 'Thank you — your report has been sent to the admin team.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setError(e.message || 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report a Bug</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <Text style={styles.sectionHeader}>DESCRIBE THE BUG</Text>
          <View style={styles.textAreaCard}>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              placeholder="What went wrong? Include steps to reproduce if possible…"
              placeholderTextColor={GRAY2}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              maxLength={1000}
            />
            <Text style={styles.charCount}>{description.length} / 1000</Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={submitting}
          >
            <MaterialIcons name="bug-report" size={18} color={WHITE} />
            <Text style={styles.submitBtnText}>{submitting ? 'Submitting…' : 'Submit Report'}</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>Reports are reviewed by the admin team and used to improve the app.</Text>

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
  textAreaCard: {
    backgroundColor: CARD, borderRadius: 14, padding: 16, marginBottom: 16,
  },
  textArea:   { color: BLACK, fontSize: 15, minHeight: 160, lineHeight: 22 },
  charCount:  { color: GRAY2, fontSize: 11, textAlign: 'right', marginTop: 8 },

  errorText: { color: RED, fontSize: 13, marginBottom: 12, marginLeft: 4 },

  submitBtn: {
    backgroundColor: BLACK, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },

  disclaimer: { color: GRAY2, fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
}); }
