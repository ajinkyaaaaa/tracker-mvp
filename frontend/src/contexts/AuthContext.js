// AuthContext.js — Global authentication state
// Wraps the app in AuthProvider (App.js) so every screen can call useAuth().
// Persists the JWT + tokenExpiresAt in AsyncStorage; validates on every app launch via api.getMe().
// Schedules an auto-logout timer so the session ends at the admin-configured logout_time.
// Polls GET /api/settings/logout-time every 60 s so mid-day changes by admin take effect immediately.
// On login/restore: fetches user profile from server → writes to AsyncStorage for cross-device sync.
// Schedules a daily local notification 30 min before logout_time (employees only).
// All auth network calls flow through api.js → routes/auth.py.

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage    from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api }          from '../services/api';             // → api.js
import { stopTracking } from '../services/locationService'; // → locationService.js

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [loginTime, setLoginTime] = useState(null);
  const [loading,   setLoading]   = useState(true);  // hides navigator until session is resolved
  const logoutTimer         = useRef(null);
  const logoutTimePollRef   = useRef(null);

  useEffect(() => { loadUser(); }, []);

  // Clears any existing auto-logout timer and schedules a new one.
  // expiresAt: ISO string from backend tokenExpiresAt or logout_time poll.
  function scheduleAutoLogout(expiresAt) {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) { logout(); return; }
    logoutTimer.current = setTimeout(() => logout(), ms);
  }

  // Fetches the current logout_time from the server and reschedules the timer.
  // Converts HH:MM (local device time) to a Date for scheduleAutoLogout.
  // Called immediately on login/restore and then every 60 s → handles admin mid-day changes.
  // If logout_time has already passed today (e.g. user logged in after hours), skip —
  // the 1-hour token expiry timer set at login handles that session instead.
  // Also reschedules the daily sync reminder notification (employees only).
  async function syncLogoutTime(currentUser) {
    try {
      const { logout_time } = await api.getLogoutTime();   // GET /api/settings/logout-time
      if (!logout_time) return;
      const [hh, mm] = logout_time.split(':').map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() > Date.now()) scheduleAutoLogout(d.toISOString());
      if ((currentUser ?? user)?.role === 'employee') scheduleSyncReminder(hh, mm);
    } catch {}
  }

  // Schedules a daily repeating local notification 30 min before logout_time (employees only).
  // Consumed by syncLogoutTime → called every 60 s; cancel-and-reschedule is idempotent.
  async function scheduleSyncReminder(logoutHour, logoutMin) {
    try {
      const totalMins = logoutHour * 60 + logoutMin - 30;
      if (totalMins < 0) return;
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Sync your work',
          body:  "Time to sync today's work to the cloud!",
        },
        trigger: { hour: Math.floor(totalMins / 60), minute: totalMins % 60, repeats: true },
      });
    } catch {}
  }

  // Fetches user profile from server and writes to AsyncStorage for cross-device availability.
  // Called after login, register, and session restore (loadUser).
  // Best-effort — failure falls back silently to whatever is already in AsyncStorage.
  async function syncProfileToLocal() {
    try {
      const { personal_info, geo_profiles } = await api.getProfile();  // GET /api/profile
      if (personal_info) {
        await AsyncStorage.setItem('user_profile_info', JSON.stringify({
          firstName: personal_info.first_name ?? '',
          lastName:  personal_info.last_name  ?? '',
          phone:     personal_info.phone      ?? '',
          address:   personal_info.address    ?? '',
          state:     personal_info.state      ?? '',
          pincode:   personal_info.pincode    ?? '',
          country:   personal_info.country    ?? 'India',
        }));
      }
      if (geo_profiles?.base?.length) await AsyncStorage.setItem('base_locations_data', JSON.stringify(geo_profiles.base));
      if (geo_profiles?.home?.length) await AsyncStorage.setItem('home_locations_data', JSON.stringify(geo_profiles.home));
    } catch {}
  }

  // Starts the 60-second polling loop for logout_time.
  // Passes currentUser so the first call can check role before React state settles.
  function startLogoutTimePolling(currentUser) {
    syncLogoutTime(currentUser);
    if (logoutTimePollRef.current) clearInterval(logoutTimePollRef.current);
    logoutTimePollRef.current = setInterval(() => syncLogoutTime(), 60000);
  }

  // Called on app launch — restores session from the stored token.
  // Rejects locally if tokenExpiresAt has already passed (avoids a pointless network call).
  // On server failure (expired/invalid token), clears storage and shows LoginScreen.
  async function loadUser() {
    try {
      const [token, expiresAt] = await Promise.all([
        AsyncStorage.getItem('token'),
        AsyncStorage.getItem('tokenExpiresAt'),
      ]);
      if (token) {
        // Reject immediately if the stored expiry has already passed
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
          throw new Error('Token expired');
        }
        const data = await api.getMe();   // GET /api/auth/me → routes/auth.py
        setUser(data);
        setLoginTime(data.loginTime);
        startLogoutTimePolling(data);
        syncProfileToLocal();             // best-effort: writes server profile to AsyncStorage
      }
    } catch {
      await AsyncStorage.multiRemove(['token', 'tokenExpiresAt']);
    } finally {
      setLoading(false);
    }
  }

  // Called by LoginScreen.js → handleSubmit()
  // Stores token + expiry; starts logout-time polling; MapScreen.js reads loginTime for the clock.
  // Also fetches server profile → AsyncStorage and requests notification permission (employees).
  async function login(email, password) {
    const data = await api.login(email, password);   // POST /api/auth/login
    await AsyncStorage.multiSet([
      ['token',           data.token],
      ['tokenExpiresAt',  data.tokenExpiresAt],
    ]);
    setUser(data.user);
    setLoginTime(data.loginTime);
    startLogoutTimePolling(data.user);
    syncProfileToLocal();  // best-effort: writes server profile to AsyncStorage
    if (data.user?.role === 'employee') {
      try { await Notifications.requestPermissionsAsync(); } catch {}
    }
    return data.user;
  }

  // Called by LoginScreen.js → handleSubmit() when isRegister is true
  // Also requests notification permission for new employee accounts.
  async function register(name, email, password, role) {
    const data = await api.register(name, email, password, role);  // POST /api/auth/register
    await AsyncStorage.multiSet([
      ['token',           data.token],
      ['tokenExpiresAt',  data.tokenExpiresAt],
    ]);
    setUser(data.user);
    setLoginTime(new Date().toISOString());
    startLogoutTimePolling(data.user);
    syncProfileToLocal();  // best-effort: new account has no profile yet, silently no-ops
    if (data.user?.role === 'employee') {
      try { await Notifications.requestPermissionsAsync(); } catch {}
    }
    return data.user;
  }

  // Called by MapScreen.js → handleLogout(), auto-logout timer, and ArchiveScreen.js nav pill.
  // Stops location tracking here so auto-logout also clears background GPS access.
  // MapScreen.js calls stopTracking() too before calling this — safe to call twice (guarded).
  async function logout() {
    if (logoutTimer.current)       clearTimeout(logoutTimer.current);
    if (logoutTimePollRef.current) clearInterval(logoutTimePollRef.current);
    logoutTimePollRef.current = null;
    try { await stopTracking(); } catch {}                                // stop background GPS — best-effort
    try { await api.logout();   } catch {}                                // POST /api/auth/logout — best-effort
    try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}  // cancel daily sync reminder
    await AsyncStorage.multiRemove(['token', 'tokenExpiresAt']);
    setUser(null);
    setLoginTime(null);
  }

  return (
    <AuthContext.Provider value={{ user, loginTime, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook used by every screen that needs auth state or actions
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
