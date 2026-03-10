// App.js — Root component and navigation setup
// Wraps everything in AuthProvider (AuthContext.js) so auth state is globally available.
// Calls initLocalDB() before rendering navigation to ensure the local SQLite DB is ready.
// AppNavigator reads the user's role to decide which screen stack to show:
//   No user  → LoginScreen
//   Employee → EmployeeRoot (EmployeeTabs + CalendarScreen pushed on top)
//   Admin    → AdminDashboardScreen

import { useState, useEffect }             from 'react';
import { StatusBar }                        from 'expo-status-bar';
import { NavigationContainer }              from '@react-navigation/native';
import { createNativeStackNavigator }       from '@react-navigation/native-stack';
import { createBottomTabNavigator }         from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View }          from 'react-native';
import { AuthProvider, useAuth }            from './src/contexts/AuthContext';
import { initLocalDB }                      from './src/services/localDatabase';
import LoginScreen          from './src/screens/LoginScreen';
import MapScreen            from './src/screens/MapScreen';
import ArchiveScreen        from './src/screens/ArchiveScreen';
import SyncScreen           from './src/screens/SyncScreen';
import CalendarScreen       from './src/screens/CalendarScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';

const Stack         = createNativeStackNavigator();
const EmployeeStack = createNativeStackNavigator();
const Tab           = createBottomTabNavigator();

// Employee tab navigator — tab bar hidden; navigation via custom floating pill.
// Third tab "Sync" is accessible from the pill in MapScreen / ArchiveScreen / SyncScreen.
function EmployeeTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tab.Screen name="Home"    component={MapScreen} />
      <Tab.Screen name="Archive" component={ArchiveScreen} />
      <Tab.Screen name="Sync"    component={SyncScreen} />
    </Tab.Navigator>
  );
}

// EmployeeRoot wraps EmployeeTabs in a nested stack so CalendarScreen can be pushed
// from SyncScreen without leaving the employee context.
function EmployeeRoot() {
  return (
    <EmployeeStack.Navigator screenOptions={{ headerShown: false }}>
      <EmployeeStack.Screen name="EmployeeTabs" component={EmployeeTabs} />
      <EmployeeStack.Screen name="Calendar"     component={CalendarScreen} />
    </EmployeeStack.Navigator>
  );
}

// Reads auth state from AuthContext.js to gate which stack is rendered.
// Shows a white loading screen while the stored token is being validated (loadUser)
// or while the local SQLite database is initialising (dbReady).
function AppNavigator() {
  const { user, loading } = useAuth();
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login"          component={LoginScreen} />
      ) : user.role === 'admin' ? (
        <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      ) : (
        <Stack.Screen name="Employee"       component={EmployeeRoot} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
