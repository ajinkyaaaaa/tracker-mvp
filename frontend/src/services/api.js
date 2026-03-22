// api.js — Centralised HTTP client for the VISPL backend
// All screens talk to the backend exclusively through this module.
// BASE_URL is read from EXPO_PUBLIC_API_URL (.env) → falls back to local hotspot IP.
// To switch between Railway and local: set/unset EXPO_PUBLIC_API_URL in frontend/.env

import AsyncStorage from '@react-native-async-storage/async-storage';

const _base = process.env.EXPO_PUBLIC_API_URL ?? 'http://172.20.10.3:3000';
export const BASE_URL = _base.replace(/\/$/, '') + '/api';

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
  // getDayDetail: fallback fetch for DayLogScreen when local SQLite has no data for a synced day
  getDayDetail:         (date)            => request(`/sync/day-detail/${date}`),

  // ── Admin — routes/admin.py ───────────────────────────────────────────────
  // getEmployees/getLiveEmployees: consumed by AdminEmployeesScreen.js, AdminLiveScreen.js
  // getEmployeeLocations/Activities: consumed by AdminDayLogScreen.js, AdminTravelMapScreen.js
  // getEmployeeDayLog: consumed by AdminDayLogScreen.js → loadDayData()
  // generateReport: consumed by AdminReportsScreen.js → handleGenerateReport()
  getEmployees:         ()                         => request('/admin/employees'),
  getLiveEmployees:     ()                         => request('/admin/live'),
  getEmployeeLocations: (userId, date)             => request(`/admin/employee/${userId}/locations/${date}`),
  getEmployeeActivities:(userId, date)             => request(`/admin/employee/${userId}/activities/${date}`),
  getEmployeeDayLog:    (userId, date)             => request(`/admin/employee/${userId}/day-log/${date}`),
  generateReport:       (userIds, start, end)      => request(`/admin/report?user_ids=${userIds.join(',')}&start=${start}&end=${end}`),

  // ── Settings — routes/settings.py ────────────────────────────────────────
  // getLoginDeadline: consumed by MapScreen.js on mount → week box colour logic
  // updateLoginDeadline: consumed by AdminDashboardScreen.js → Settings tab
  // getLogoutTime: polled every 60 s by AuthContext.js → auto-logout enforcement
  // updateLogoutTime: consumed by AdminDashboardScreen.js → Settings tab
  // getTrackingIntervals: consumed by MapScreen.js → syncTrackingIntervals() for background task
  // updateTrackingIntervals: consumed by AdminDashboardScreen.js → Settings tab
  getLoginDeadline:          ()              => request('/settings/login-deadline'),
  updateLoginDeadline:       (deadline)      => request('/settings/admin/login-deadline',       { method: 'PUT', body: JSON.stringify({ login_deadline: deadline }) }),
  getLogoutTime:             ()              => request('/settings/logout-time'),
  updateLogoutTime:          (logoutTime)    => request('/settings/admin/logout-time',          { method: 'PUT', body: JSON.stringify({ logout_time: logoutTime }) }),
  getTrackingIntervals:      ()              => request('/settings/tracking-intervals'),
  updateTrackingIntervals:   (active, idle)  => request('/settings/admin/tracking-intervals',   { method: 'PUT', body: JSON.stringify({ interval_active: active, interval_idle: idle }) }),
  verifyStorageClearCode:    (code)          => request('/settings/verify-storage-clear-code',  { method: 'POST', body: JSON.stringify({ code }) }),

  // ── Bugs — routes/bugs.py ────────────────────────────────────────────────
  // reportBug: consumed by ReportBugScreen.js → submit handler
  // getBugReports: consumed by AdminBugReportsScreen.js on mount
  // resolveBug: consumed by AdminBugReportsScreen.js → resolve action
  reportBug:      (description) => request('/bugs/report',              { method: 'POST',  body: JSON.stringify({ description }) }),
  getBugReports:  ()            => request('/bugs/'),
  resolveBug:     (id)          => request(`/bugs/${id}/resolve`,        { method: 'PATCH' }),

  // ── Auth extras — routes/auth.py ─────────────────────────────────────────
  // changePassword: consumed by PasswordSecurityScreen.js → save handler
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // ── Profile — routes/profile.py ──────────────────────────────────────────
  // getProfile:     consumed by AuthContext.js (login/loadUser) + ManageProfileScreen.js (on mount)
  // upsertProfile:  consumed by ManageProfileScreen.js → debounced auto-save on text field change
  // setGeoProfiles: consumed by ManageProfileScreen.js → immediate save on any geo profile mutation
  getProfile:     ()           => request('/profile'),
  upsertProfile:  (data)       => request('/profile',     { method: 'PUT', body: JSON.stringify(data) }),
  setGeoProfiles: (base, home) => request('/profile/geo', { method: 'PUT', body: JSON.stringify({ base, home }) }),

  // ── Saved Locations — routes/saved_locations.py ───────────────────────────
  // Consumed by MapScreen.js (mark / load pins; idle suppression uses the list too)
  saveLocation:        (data) => request('/saved-locations',        { method: 'POST',   body: JSON.stringify(data) }),
  getSavedLocations:   ()     => request('/saved-locations'),
  deleteSavedLocation: (id)   => request(`/saved-locations/${id}`,  { method: 'DELETE' }),
};
