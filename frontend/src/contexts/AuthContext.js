// AuthContext.js — Global authentication state
// Wraps the app in AuthProvider (App.js) so every screen can call useAuth().
// Persists the JWT + tokenExpiresAt in AsyncStorage; validates on every app launch via api.getMe().
// Schedules an auto-logout timer so the session ends exactly when the backend token expires.
// All auth network calls flow through api.js → routes/auth.py.

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';   // → api.js

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [loginTime, setLoginTime] = useState(null);
  const [loading,   setLoading]   = useState(true);  // hides navigator until session is resolved
  const logoutTimer = useRef(null);

  useEffect(() => { loadUser(); }, []);

  // Clears any existing auto-logout timer and schedules a new one.
  // expiresAt: ISO string (local time) from backend login/me → tokenExpiresAt.
  function scheduleAutoLogout(expiresAt) {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) { logout(); return; }
    logoutTimer.current = setTimeout(() => logout(), ms);
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
        const exp = data.tokenExpiresAt || expiresAt;
        if (exp) scheduleAutoLogout(exp);
      }
    } catch {
      await AsyncStorage.multiRemove(['token', 'tokenExpiresAt']);
    } finally {
      setLoading(false);
    }
  }

  // Called by LoginScreen.js → handleSubmit()
  // Stores token + expiry; schedules auto-logout; MapScreen.js reads loginTime for the clock.
  async function login(email, password) {
    const data = await api.login(email, password);   // POST /api/auth/login
    await AsyncStorage.multiSet([
      ['token',           data.token],
      ['tokenExpiresAt',  data.tokenExpiresAt],
    ]);
    setUser(data.user);
    setLoginTime(data.loginTime);
    scheduleAutoLogout(data.tokenExpiresAt);
    return data.user;
  }

  // Called by LoginScreen.js → handleSubmit() when isRegister is true
  async function register(name, email, password, role) {
    const data = await api.register(name, email, password, role);  // POST /api/auth/register
    await AsyncStorage.multiSet([
      ['token',           data.token],
      ['tokenExpiresAt',  data.tokenExpiresAt],
    ]);
    setUser(data.user);
    setLoginTime(new Date().toISOString());
    scheduleAutoLogout(data.tokenExpiresAt);
    return data.user;
  }

  // Called by MapScreen.js → handleLogout() and ArchiveScreen.js nav pill
  // Stops location tracking (MapScreen handles that) before this is called.
  async function logout() {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    try { await api.logout(); } catch {}   // POST /api/auth/logout — best-effort
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
