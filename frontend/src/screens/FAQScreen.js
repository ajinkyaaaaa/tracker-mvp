// FAQScreen.js — Frequently asked questions about the app
// Navigated to from SettingsScreen.js → Support section → "FAQ"
// Plain-language explanations of tracking, stops, syncing, and location features

import { useState }                          from 'react';
import { View, Text, StyleSheet, ScrollView,
         TouchableOpacity, SafeAreaView,
         LayoutAnimation, Platform, UIManager } from 'react-native';
import { MaterialIcons }                     from '@expo/vector-icons';
import { useTheme }                          from '../contexts/ThemeContext';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQS = [
  {
    section: 'LOCATION TRACKING',
    items: [
      {
        q: 'Does the app track my location all the time?',
        a: 'No. The app only records your location during work hours — from 9:00 AM to 6:00 PM. Outside those hours, nothing is recorded, even if the app is open.',
      },
      {
        q: 'How often does the app ping my location?',
        a: 'It depends on where you are:\n\n• On the road (outside any saved location): every 3 seconds. This gives a smooth, accurate map of your route.\n\n• Parked at a saved location (like a client site or base): every 30 seconds. No need for frequent updates when you\'re staying put.\n\nYour admin can adjust both of these numbers.',
      },
      {
        q: 'Will this drain my battery?',
        a: 'The app uses GPS actively while you\'re moving between locations. When you\'re parked at a known spot, it backs off to every 30 seconds and uses less power. The blue "VISPL Tracking" notification you see means the app is running in the background — this is normal.',
      },
      {
        q: 'Does it track me when I\'m off duty or on weekends?',
        a: 'No. Even if the app is installed and open, it only saves location data between 9:00 AM and 6:00 PM on any day. Nothing outside those hours is ever stored.',
      },
    ],
  },
  {
    section: 'SAVED LOCATIONS & GEOFENCES',
    items: [
      {
        q: 'What is a saved location?',
        a: 'A saved location is a named place you pin on the map — like a client\'s office, a warehouse, or a rest stop. Once saved, it shows up as an icon on your map and helps the app understand where you are.',
      },
      {
        q: 'What is a geofence?',
        a: 'A geofence is an invisible boundary drawn around a saved location — like a bubble. The default size is 100 metres. When you step inside that bubble, the app knows you\'ve arrived there. When you step out, it knows you\'ve left.',
      },
      {
        q: 'What happens when I\'m inside a geofence?',
        a: 'Two things:\n\n1. The app switches to a slower location ping (every 30 seconds) to save battery.\n2. Idle notifications are suppressed — the app won\'t ask you "what are you doing here?" because it already knows you\'re at a known location.',
      },
      {
        q: 'What\'s the difference between Base, Home, Client, Site, and Rest Stop?',
        a: '• Base — your office or starting point for the day.\n• Home — your home address.\n• Client — a customer\'s location you visit regularly.\n• Site — a work site or project location.\n• Rest Stop — a regular break spot (petrol station, dhaba, etc.).\n\nThe category affects which icon shows on the map. Base and Home are set in Settings; the others are pinned directly from the map.',
      },
    ],
  },
  {
    section: 'IDLE STOPS & NOTIFICATIONS',
    items: [
      {
        q: 'Why did I get a notification asking what I\'m doing?',
        a: 'If the app sees that you haven\'t moved more than 50 metres in 15 minutes — and you\'re not at a known saved location — it assumes you\'ve stopped somewhere new and sends a notification asking you to log the reason (client visit, rest break, etc.).',
      },
      {
        q: 'What if I ignore the notification?',
        a: 'The stop is saved as "pending" in your log. Your admin can see unresponded stops. It\'s best to respond so your day log is complete.',
      },
      {
        q: 'I was stuck in traffic — will I get a notification?',
        a: 'If you\'re moving (even slowly), the app detects movement and won\'t trigger a stop. The 15-minute timer only starts when you\'ve been genuinely stationary.',
      },
      {
        q: 'I had lunch — will it notify me?',
        a: 'No. The app automatically skips idle checks between 1:00 PM and 2:00 PM every day.',
      },
    ],
  },
  {
    section: 'TRAVEL LOG & DAY LOG',
    items: [
      {
        q: 'What is the travel log?',
        a: 'The travel log is a timeline of your day — it shows where you started, where you went, how long you spent at each place, and how long it took to get between stops. You can tap "View on Map" to see the full route drawn on a map.',
      },
      {
        q: 'Why does my travel route look like straight lines?',
        a: 'Straight lines mean the app only recorded a few GPS points along that segment. This usually happens when you\'re parked at a saved location (30-second interval) and then move — the first few seconds of travel may not be captured. Once you\'re on the road, 3-second tracking kicks in and the route becomes detailed.',
      },
      {
        q: 'How far back can I see my travel history?',
        a: 'You can go back week by week in the Day Log screen. Tap the left arrow to go to a previous week, then tap any day to see its full log.',
      },
    ],
  },
  {
    section: 'SYNCING',
    items: [
      {
        q: 'What does "Sync" mean?',
        a: 'All your location data, stops, and visits are first saved on your phone. Syncing uploads that data to the company server so your admin can see it. Until you sync, only you can see your data.',
      },
      {
        q: 'Do I have to sync manually?',
        a: 'No — syncing happens automatically. But if you see a "Pending Sync" badge on the Sync tab, you can tap "Sync Now" to push it immediately (useful when you know you\'re about to lose signal).',
      },
      {
        q: 'What happens if I have no internet?',
        a: 'Everything is saved locally on your phone first. As long as your phone has storage, nothing is lost. Once you\'re back online, sync will pick up where it left off.',
      },
    ],
  },
  {
    section: 'LOGIN & ATTENDANCE',
    items: [
      {
        q: 'What counts as "on time"?',
        a: 'Your admin sets a login deadline (e.g. 9:00 AM). If you open the app and log in at or before that time, your day box turns green. If you log in after it, it turns yellow. This is visible in both your Day Log and your admin\'s dashboard.',
      },
      {
        q: 'Does the app clock me in automatically?',
        a: 'No. You need to open the app and log in. The moment you log in is your official start time for the day.',
      },
    ],
  },
];

function FAQItem({ item }) {
  const [open, setOpen] = useState(false);
  const { BLACK, CARD, GRAY, GRAY3, WHITE } = useTheme();

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v => !v);
  }

  return (
    <View style={[faqStyles.item, { borderColor: GRAY3 }]}>
      <TouchableOpacity style={faqStyles.question} onPress={toggle} activeOpacity={0.7}>
        <Text style={[faqStyles.questionText, { color: BLACK }]}>{item.q}</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={22} color={GRAY} />
      </TouchableOpacity>
      {open && (
        <View style={[faqStyles.answer, { backgroundColor: CARD }]}>
          <Text style={[faqStyles.answerText, { color: GRAY }]}>{item.a}</Text>
        </View>
      )}
    </View>
  );
}

export default function FAQScreen({ navigation }) {
  const { BG, BLACK, GRAY, GRAY3 } = useTheme();

  return (
    <SafeAreaView style={[faqStyles.safe, { backgroundColor: BG }]}>

      {/* Header */}
      <View style={[faqStyles.header, { borderBottomColor: GRAY3 }]}>
        <TouchableOpacity style={faqStyles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={BLACK} />
        </TouchableOpacity>
        <View>
          <Text style={[faqStyles.headerTitle, { color: BLACK }]}>FAQ</Text>
          <Text style={[faqStyles.headerSub, { color: GRAY }]}>How the app works</Text>
        </View>
        <View style={faqStyles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={faqStyles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {FAQS.map(section => (
          <View key={section.section} style={faqStyles.section}>
            <Text style={[faqStyles.sectionHeader, { color: GRAY }]}>{section.section}</Text>
            <View style={[faqStyles.sectionCard, { borderColor: GRAY3 }]}>
              {section.items.map((item, i) => (
                <FAQItem key={i} item={item} />
              ))}
            </View>
          </View>
        ))}

        <Text style={[faqStyles.footer, { color: GRAY }]}>
          Still have questions? Use "Report a Bug" in Settings to reach your admin.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const faqStyles = StyleSheet.create({
  safe:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn:     { width: 36 },
  headerTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  headerSub:   { fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 2 },

  scroll:  { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48 },
  section: { marginBottom: 28 },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    marginBottom: 8, marginLeft: 2,
  },
  sectionCard: {
    borderRadius: 14, borderWidth: 1, overflow: 'hidden',
  },

  item: {
    borderBottomWidth: 1,
  },
  question: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 16, gap: 12,
  },
  questionText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  answer:       { paddingHorizontal: 16, paddingVertical: 14 },
  answerText:   { fontSize: 13, lineHeight: 21 },

  footer: { fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },
});
