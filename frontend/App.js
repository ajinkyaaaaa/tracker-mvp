// App.js — Root component and navigation setup
// Wraps everything in AuthProvider (AuthContext.js) so auth state is globally available.
// Calls initLocalDB() before rendering navigation to ensure the local SQLite DB is ready.
// AppNavigator reads the user's role to decide which screen stack to show:
//   No user  → LoginScreen
//   Employee → EmployeeRoot (EmployeeTabs[Home/Archive/Sync/Settings] + Calendar/DayLog/sub-settings pushed on top)
//   Admin    → AdminRoot (AdminTabs[Live/Employees/Reports/Settings] + detail screens pushed on top)

import { useState, useEffect }             from 'react';
import { StatusBar }                        from 'expo-status-bar';
import { NavigationContainer }              from '@react-navigation/native';
import { createNativeStackNavigator }       from '@react-navigation/native-stack';
import { createBottomTabNavigator }         from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View }          from 'react-native';
import { MaterialIcons }                    from '@expo/vector-icons';
import { AuthProvider, useAuth }            from './src/contexts/AuthContext';
import { ThemeProvider, useTheme }          from './src/contexts/ThemeContext';
import { initLocalDB }                      from './src/services/localDatabase';
import LoginScreen               from './src/screens/LoginScreen';
import MapScreen                 from './src/screens/MapScreen';
import ArchiveScreen             from './src/screens/ArchiveScreen';
import SyncScreen                from './src/screens/SyncScreen';
import CalendarScreen            from './src/screens/CalendarScreen';
import DayLogScreen              from './src/screens/DayLogScreen';
import AdminBugReportsScreen     from './src/screens/AdminBugReportsScreen';
import AdminLiveScreen           from './src/screens/AdminLiveScreen';
import AdminEmployeesScreen      from './src/screens/AdminEmployeesScreen';
import AdminDayLogScreen         from './src/screens/AdminDayLogScreen';
import AdminTravelMapScreen      from './src/screens/AdminTravelMapScreen';
import AdminReportsScreen        from './src/screens/AdminReportsScreen';
import AdminSettingsScreen       from './src/screens/AdminSettingsScreen';
import AdminConfigurationsScreen from './src/screens/AdminConfigurationsScreen';
import SettingsScreen            from './src/screens/SettingsScreen';
import ManageProfileScreen       from './src/screens/settings/ManageProfileScreen';
import BaseLocationPinScreen    from './src/screens/settings/BaseLocationPinScreen';
import PasswordSecurityScreen    from './src/screens/settings/PasswordSecurityScreen';
import NotificationsScreen       from './src/screens/settings/NotificationsScreen';
import ThemeScreen               from './src/screens/settings/ThemeScreen';
import ReportBugScreen           from './src/screens/settings/ReportBugScreen';
import ScheduleScreen            from './src/screens/ScheduleScreen';
import ExploreLocationsScreen   from './src/screens/ExploreLocationsScreen';
import RegisterLocationScreen  from './src/screens/RegisterLocationScreen';
import TravelMapScreen         from './src/screens/TravelMapScreen';
import FAQScreen               from './src/screens/FAQScreen';

const Stack         = createNativeStackNavigator();
const EmployeeStack = createNativeStackNavigator();
const AdminStack    = createNativeStackNavigator();
const AdminTab      = createBottomTabNavigator();
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
      <EmployeeStack.Screen name="ExploreLocations"    component={ExploreLocationsScreen} />
      <EmployeeStack.Screen name="RegisterLocation"   component={RegisterLocationScreen} />
      <EmployeeStack.Screen name="TravelMap"          component={TravelMapScreen} />
      <EmployeeStack.Screen name="FAQ"               component={FAQScreen} />
    </EmployeeStack.Navigator>
  );
}

// AdminTabs — bottom tab navigator for the 4 main admin tabs.
// Hosted inside AdminRoot so detail screens can be pushed above it.
function AdminTabs() {
  return (
    <AdminTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E5EA',
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarActiveTintColor:   '#000000',
        tabBarInactiveTintColor: '#C7C7CC',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
      }}
    >
      <AdminTab.Screen
        name="AdminLive"
        component={AdminLiveScreen}
        options={{
          tabBarLabel: 'Live',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="sensors" size={size} color={color} />,
        }}
      />
      <AdminTab.Screen
        name="AdminEmployees"
        component={AdminEmployeesScreen}
        options={{
          tabBarLabel: 'Employees',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="people" size={size} color={color} />,
        }}
      />
      <AdminTab.Screen
        name="AdminReports"
        component={AdminReportsScreen}
        options={{
          tabBarLabel: 'Reports',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="insert-chart" size={size} color={color} />,
        }}
      />
      <AdminTab.Screen
        name="AdminSettings"
        component={AdminSettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="settings" size={size} color={color} />,
        }}
      />
    </AdminTab.Navigator>
  );
}

// AdminRoot — stack navigator hosting AdminTabs + all pushed detail screens.
function AdminRoot() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminTabs"           component={AdminTabs} />
      <AdminStack.Screen name="AdminDayLog"         component={AdminDayLogScreen} />
      <AdminStack.Screen name="AdminTravelMap"      component={AdminTravelMapScreen} />
      <AdminStack.Screen name="AdminConfigurations" component={AdminConfigurationsScreen} />
      <AdminStack.Screen name="AdminBugReports"     component={AdminBugReportsScreen} />
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
