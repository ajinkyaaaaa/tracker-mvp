// api.js — Centralised HTTP client for the VISPL backend
// All screens talk to the backend exclusively through this module.
// BASE_URL must match the machine running the Flask server (app.py).
// Update the IP whenever your hotspot/network changes.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = 'http://172.20.10.3:3000/api';

// Attaches the stored JWT to every request (set by AuthContext after login)
async function getHeaders() {
  const token = await AsyncStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Core fetch wrapper — throws a readable Error on network failure or non-2xx response
async function request(endpoint, options = {}) {
  const headers = await getHeaders();
  let res;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  } catch {
    // Network unreachable — wrong IP, server down, or no Wi-Fi
    throw new Error('Cannot reach server. Check your network and the IP in api.js.');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    // Server returned non-JSON (e.g. HTML error page from a crashed server)
    throw new Error(`Server error (status ${res.status}). The backend may be down.`);
  }

  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // ── Auth — routes/auth.py ─────────────────────────────────────────────────
  // Consumed by AuthContext.js (login / register / logout / loadUser)
  login:    (email, password)              => request('/auth/login',    { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name, email, password, role) => request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role }) }),
  logout:   ()                             => request('/auth/logout',   { method: 'POST' }),
  getMe:    ()                             => request('/auth/me'),

  // ── Locations — routes/locations.py ──────────────────────────────────────
  // superseded by localDatabase.js — kept for admin/future use
  syncLocations: (locations) => request('/locations/sync',         { method: 'POST', body: JSON.stringify({ locations }) }),
  getTodayPath:  ()          => request('/locations/today'),
  getPathByDate: (date)      => request(`/locations/history/${date}`),

  // ── Activities — routes/activities.py ────────────────────────────────────
  // superseded by localDatabase.js — kept for admin/future use
  logActivity:        (data)                  => request('/activities',                       { method: 'POST', body: JSON.stringify(data) }),
  respondToActivity:  (activityId, response)  => request(`/activities/${activityId}/respond`, { method: 'PUT',  body: JSON.stringify({ response }) }),
  getPendingCount:    ()                       => request('/activities/pending/count'),
  getTodayActivities: ()                       => request('/activities/today'),
  getActivitiesByDate:(date)                   => request(`/activities/history/${date}`),

  // ── Sync — routes/sync.py ────────────────────────────────────────────────
  // Bulk upload endpoints consumed by SyncScreen.js → handleSync()
  // getSyncStatus: consumed by CalendarScreen.js on mount → server-confirmed dates
  syncBulkLocations:    (date, locations) => request('/sync/locations',     { method: 'POST', body: JSON.stringify({ date, locations }) }),
  syncBulkStops:        (date, stops)     => request('/sync/stops',         { method: 'POST', body: JSON.stringify({ date, stops }) }),
  syncBulkVisits:       (date, visits)    => request('/sync/visits',        { method: 'POST', body: JSON.stringify({ date, visits }) }),
  syncBulkLoginSessions:(sessions)        => request('/sync/login-sessions', { method: 'POST', body: JSON.stringify({ sessions }) }),
  getSyncStatus:        ()                => request('/sync/status'),
  getLoginHistory:      ()                => request('/sync/login-history'),

  // ── Admin — routes/admin.py ───────────────────────────────────────────────
  // All consumed by AdminDashboardScreen.js
  getEmployees:         ()              => request('/admin/employees'),
  getLiveEmployees:     ()              => request('/admin/live'),
  getEmployeeLocations: (userId, date) => request(`/admin/employee/${userId}/locations/${date}`),
  getEmployeeActivities:(userId, date) => request(`/admin/employee/${userId}/activities/${date}`),

  // ── Saved Locations — routes/saved_locations.py ───────────────────────────
  // Consumed by MapScreen.js (mark / load pins; idle suppression uses the list too)
  saveLocation:        (data) => request('/saved-locations',        { method: 'POST',   body: JSON.stringify(data) }),
  getSavedLocations:   ()     => request('/saved-locations'),
  deleteSavedLocation: (id)   => request(`/saved-locations/${id}`,  { method: 'DELETE' }),
};
