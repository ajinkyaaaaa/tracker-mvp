// App.js — Root component and navigation setup
// Wraps everything in AuthProvider (AuthContext.js) so auth state is globally available.
// Calls initLocalDB() before rendering navigation to ensure the local SQLite DB is ready.
// AppNavigator reads the user's role to decide which screen stack to show:
//   No user  → LoginScreen
//   Employee → EmployeeRoot (EmployeeTabs[Home/Archive/Sync/Settings] + Calendar/DayLog/sub-settings pushed on top)
//   Admin    → AdminRoot (AdminDashboardScreen + AdminBugReportsScreen)

import { useState, useEffect }             from 'react';
import { StatusBar }                        from 'expo-status-bar';
import { NavigationContainer }              from '@react-navigation/native';
import { createNativeStackNavigator }       from '@react-navigation/native-stack';
import { createBottomTabNavigator }         from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View }          from 'react-native';
import { AuthProvider, useAuth }            from './src/contexts/AuthContext';
import { ThemeProvider, useTheme }          from './src/contexts/ThemeContext';
import { initLocalDB }                      from './src/services/localDatabase';
import LoginScreen               from './src/screens/LoginScreen';
import MapScreen                 from './src/screens/MapScreen';
import ArchiveScreen             from './src/screens/ArchiveScreen';
import SyncScreen                from './src/screens/SyncScreen';
import CalendarScreen            from './src/screens/CalendarScreen';
import DayLogScreen              from './src/screens/DayLogScreen';
import AdminDashboardScreen      from './src/screens/AdminDashboardScreen';
import AdminBugReportsScreen     from './src/screens/AdminBugReportsScreen';
import SettingsScreen            from './src/screens/SettingsScreen';
import ManageProfileScreen       from './src/screens/settings/ManageProfileScreen';
import BaseLocationPinScreen    from './src/screens/settings/BaseLocationPinScreen';
import PasswordSecurityScreen    from './src/screens/settings/PasswordSecurityScreen';
import NotificationsScreen       from './src/screens/settings/NotificationsScreen';
import ThemeScreen               from './src/screens/settings/ThemeScreen';
import ReportBugScreen           from './src/screens/settings/ReportBugScreen';
import ScheduleScreen            from './src/screens/ScheduleScreen';

const Stack         = createNativeStackNavigator();
const EmployeeStack = createNativeStackNavigator();
const AdminStack    = createNativeStackNavigator();
const Tab           = createBottomTabNavigator();

// Employee tab navigator — tab bar hidden; navigation via custom floating pill.
// All 4 pill tabs (Home, Archive, Sync, Settings) live here so navigation between them always works.
function EmployeeTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tab.Screen name="Home"     component={MapScreen} />
      <Tab.Screen name="Archive"  component={ArchiveScreen} />
      <Tab.Screen name="Sync"     component={SyncScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// EmployeeRoot wraps EmployeeTabs in a nested stack so sub-settings and other detail screens
// can be pushed without leaving the employee context.
function EmployeeRoot() {
  return (
    <EmployeeStack.Navigator screenOptions={{ headerShown: false }}>
      <EmployeeStack.Screen name="EmployeeTabs"         component={EmployeeTabs} />
      <EmployeeStack.Screen name="Calendar"             component={CalendarScreen} />
      <EmployeeStack.Screen name="DayLog"              component={DayLogScreen} />
      <EmployeeStack.Screen name="ManageProfile"        component={ManageProfileScreen} />
      <EmployeeStack.Screen name="BaseLocationPin"      component={BaseLocationPinScreen} />
      <EmployeeStack.Screen name="PasswordSecurity"     component={PasswordSecurityScreen} />
      <EmployeeStack.Screen name="NotificationsSettings"component={NotificationsScreen} />
      <EmployeeStack.Screen name="ThemeSettings"        component={ThemeScreen} />
      <EmployeeStack.Screen name="ReportBug"            component={ReportBugScreen} />
      <EmployeeStack.Screen name="Schedule"             component={ScheduleScreen} />
    </EmployeeStack.Navigator>
  );
}

// AdminRoot wraps AdminDashboardScreen so AdminBugReportsScreen can be pushed on top.
function AdminRoot() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminDashboard"  component={AdminDashboardScreen} />
      <AdminStack.Screen name="AdminBugReports" component={AdminBugReportsScreen} />
    </AdminStack.Navigator>
  );
}

// Reads auth state from AuthContext.js to gate which stack is rendered.
// Shows a white loading screen while the stored token is being validated (loadUser)
// or while the local SQLite database is initialising (dbReady).
function AppNavigator() {
  const { user, loading } = useAuth();
  const { isDark } = useTheme();
  const [dbReady, setDbReady] = useState(false);

  // Initialise local SQLite DB once on mount; unblock rendering when done.
  useEffect(() => {
    initLocalDB()
      .catch(() => {})
      .finally(() => setDbReady(true));
  }, []);

  if (loading || !dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login"    component={LoginScreen} />
      ) : user.role === 'admin' ? (
        <Stack.Screen name="Admin"    component={AdminRoot} />
      ) : (
        <Stack.Screen name="Employee" component={EmployeeRoot} />
      )}
    </Stack.Navigator>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </ThemeProvider>
  );
}
