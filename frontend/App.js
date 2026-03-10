// App.js — Root component and navigation setup
// Wraps everything in AuthProvider (AuthContext.js) so auth state is globally available.
// AppNavigator reads the user's role to decide which screen stack to show:
//   No user  → LoginScreen
//   Employee → EmployeeTabs (MapScreen + ArchiveScreen, tab bar hidden)
//   Admin    → AdminDashboardScreen

import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View }    from 'react-native';
import { AuthProvider, useAuth }      from './src/contexts/AuthContext';   // → AuthContext.js
import LoginScreen           from './src/screens/LoginScreen';
import MapScreen             from './src/screens/MapScreen';
import ArchiveScreen         from './src/screens/ArchiveScreen';
import AdminDashboardScreen  from './src/screens/AdminDashboardScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// Employee tab navigator — tab bar is hidden because navigation is handled
// by the custom floating pill inside each screen (MapScreen / ArchiveScreen).
function EmployeeTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tab.Screen name="Home"    component={MapScreen} />
      <Tab.Screen name="Archive" component={ArchiveScreen} />
    </Tab.Navigator>
  );
}

// Reads auth state from AuthContext.js to gate which stack is rendered.
// Shows a white loading screen while the stored token is being validated (loadUser).
function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
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
        <Stack.Screen name="Employee"       component={EmployeeTabs} />
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
