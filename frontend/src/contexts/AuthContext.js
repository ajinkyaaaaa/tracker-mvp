// AuthContext.js — Global authentication state
// Wraps the app in AuthProvider (App.js) so every screen can call useAuth().
// Persists the JWT in AsyncStorage; validates it on every app launch via api.getMe().
// All auth network calls flow through api.js → routes/auth.py.

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';   // → api.js

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [loginTime, setLoginTime] = useState(null);
  const [loading,   setLoading]   = useState(true);  // hides navigator until session is resolved

  useEffect(() => { loadUser(); }, []);

  // Called on app launch — restores session from the stored token.
  // On success, navigates to MapScreen (employee) or AdminDashboard via App.js.
  // On failure (expired/invalid token), clears storage and shows LoginScreen.
  async function loadUser() {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const data = await api.getMe();   // GET /api/auth/me → routes/auth.py
        setUser(data);
        setLoginTime(data.loginTime);
      }
    } catch {
      await AsyncStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  }

  // Called by LoginScreen.js → handleSubmit()
  // Stores the returned token; MapScreen.js reads loginTime to display the login clock.
  async function login(email, password) {
    const data = await api.login(email, password);   // POST /api/auth/login
    await AsyncStorage.setItem('token', data.token);
    setUser(data.user);
    setLoginTime(data.loginTime);
    return data.user;
  }

  // Called by LoginScreen.js → handleSubmit() when isRegister is true
  async function register(name, email, password, role) {
    const data = await api.register(name, email, password, role);  // POST /api/auth/register
    await AsyncStorage.setItem('token', data.token);
    setUser(data.user);
    setLoginTime(new Date().toISOString());
    return data.user;
  }

  // Called by MapScreen.js → handleLogout() and ArchiveScreen.js nav pill
  // Stops location tracking (MapScreen handles that) before this is called.
  async function logout() {
    try { await api.logout(); } catch {}   // POST /api/auth/logout — best-effort
    await AsyncStorage.removeItem('token');
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
