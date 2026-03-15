// LoginScreen.js — Authentication entry point
// Handles both login and registration in a single form (toggled by isRegister).
// Requests location permissions before submitting — required for background tracking.
//
// Data flows:
//   POST /api/auth/login    → AuthContext.login()    → stores token in AsyncStorage
//   POST /api/auth/register → AuthContext.register() → stores token in AsyncStorage
//   On success, App.js AppNavigator reads user.role and routes to the correct screen.

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  Linking, ScrollView, Animated, Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

const { height } = Dimensions.get('window');

function ScalePress({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      disabled={disabled}
      onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 60 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 60 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const { login, register } = useAuth();
  const { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE } = useTheme();
  const styles = makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE });
  const [isRegister, setIsRegister] = useState(false);
  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [role,       setRole]       = useState('employee');
  const [loading,    setLoading]    = useState(false);

  const logoAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(logoAnim, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
        Animated.spring(cardAnim, { toValue: 0, tension: 55, friction: 11, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  async function ensureLocationPermission() {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Location Required', 'VISPL Tracker needs location access to work.', [
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return false;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert('Background Location Required', 'Please set location to "Always" in Settings.', [
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    if (!email || !password || (isRegister && !name)) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    setLoading(true);
    try {
      const ok = await ensureLocationPermission();
      if (!ok) { setLoading(false); return; }
      if (isRegister) await register(name, email, password, role);
      else            await login(email, password);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  const logoScale = logoAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const logoOp    = logoAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Logo block */}
      <Animated.View style={[styles.logoBlock, { opacity: logoOp, transform: [{ scale: logoScale }] }]}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>📍</Text>
        </View>
        <Text style={styles.appName}>VISPL Tracker</Text>
        <Text style={styles.tagline}>Employee Field Tracking</Text>
      </Animated.View>

      {/* Input card */}
      <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: cardAnim }] }]}>
        <Text style={styles.cardTitle}>
          {isRegister ? 'Create Account' : 'Welcome back'}
        </Text>
        <Text style={styles.cardSub}>
          {isRegister ? 'Fill in the details below' : 'Sign in to continue'}
        </Text>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {isRegister && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="Ajinkya Karnik"
                placeholderTextColor={GRAY2}
                value={name}
                onChangeText={setName}
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="you@company.com"
              placeholderTextColor={GRAY2}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={GRAY2}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {isRegister && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>ROLE</Text>
              <View style={styles.roleRow}>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'employee' && styles.roleBtnActive]}
                  onPress={() => setRole('employee')}
                >
                  <Text style={[styles.roleText, role === 'employee' && styles.roleTextActive]}>Employee</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'admin' && styles.roleBtnActive]}
                  onPress={() => setRole('admin')}
                >
                  <Text style={[styles.roleText, role === 'admin' && styles.roleTextActive]}>Admin</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <ScalePress style={styles.btn} onPress={handleSubmit} disabled={loading}>
            {loading
              ? <ActivityIndicator color={WHITE} />
              : <Text style={styles.btnText}>{isRegister ? 'Register' : 'Sign In'}</Text>
            }
          </ScalePress>

          <TouchableOpacity style={styles.switchRow} onPress={() => setIsRegister(!isRegister)}>
            <Text style={styles.switchText}>
              {isRegister ? 'Already have an account?  ' : "Don't have an account?  "}
              <Text style={styles.switchLink}>{isRegister ? 'Sign In' : 'Register'}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

function makeStyles({ BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG, justifyContent: 'flex-end' },

    // Logo
    logoBlock: {
      alignItems: 'center',
      paddingTop: 60,
      paddingBottom: 40,
      flex: 1,
      justifyContent: 'center',
    },
    logoCircle: {
      width: 72, height: 72, borderRadius: 22,
      backgroundColor: BLACK,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 20,
      shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18, shadowRadius: 16, elevation: 8,
    },
    logoEmoji: { fontSize: 32 },
    appName:   { color: BLACK, fontSize: 28, fontWeight: '900', letterSpacing: 0.3 },
    tagline:   { color: GRAY,  fontSize: 14, marginTop: 6 },

    // Card
    card: {
      backgroundColor: WHITE,
      borderTopLeftRadius: 32, borderTopRightRadius: 32,
      paddingHorizontal: 28, paddingTop: 32, paddingBottom: 40,
      maxHeight: height * 0.62,
      borderTopWidth: 1,
      borderColor: GRAY3,
      shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.06, shadowRadius: 16, elevation: 10,
    },
    cardTitle: { color: BLACK, fontSize: 24, fontWeight: '800', marginBottom: 4 },
    cardSub:   { color: GRAY,  fontSize: 14, marginBottom: 26 },

    field:      { marginBottom: 18 },
    fieldLabel: { color: BLACK, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
    input: {
      backgroundColor: CARD,
      borderRadius: 14, padding: 16,
      color: BLACK, fontSize: 15,
      borderWidth: 1, borderColor: GRAY3,
    },

    roleRow:        { flexDirection: 'row', gap: 10 },
    roleBtn:        { flex: 1, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: GRAY3, alignItems: 'center', backgroundColor: CARD },
    roleBtnActive:  { backgroundColor: BLACK, borderColor: BLACK },
    roleText:       { color: GRAY,  fontWeight: '700', fontSize: 14 },
    roleTextActive: { color: WHITE },

    btn: {
      backgroundColor: BLACK, borderRadius: 18, padding: 18,
      alignItems: 'center', marginTop: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15, shadowRadius: 10, elevation: 5,
    },
    btnText: { color: WHITE, fontSize: 17, fontWeight: '900', letterSpacing: 0.4 },

    switchRow:  { alignItems: 'center', marginTop: 20, paddingBottom: 10 },
    switchText: { color: GRAY, fontSize: 14 },
    switchLink: { color: BLACK, fontWeight: '800' },
  });
}
