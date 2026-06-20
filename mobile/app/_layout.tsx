import React, { useEffect, useState } from 'react';
import { ClerkProvider, ClerkLoaded, SignedIn, SignedOut, useAuth, useUser } from '@clerk/clerk-expo';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { 
  useFonts, 
  Orbitron_400Regular, 
  Orbitron_700Bold 
} from '@expo-google-fonts/orbitron';
import { 
  Inter_400Regular, 
  Inter_600SemiBold, 
  Inter_700Bold 
} from '@expo-google-fonts/inter';
import { View, ActivityIndicator } from 'react-native';
import { tokenCache } from '../utils/tokenCache';
import { setAuthToken, api } from '../utils/api';
import '../global.css';

// Retrieve the Clerk publishable key from environment variables
const EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || 'pk_test_placeholder';

// Internal navigation sync component
function InitialLayout() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const segments = useSegments();
  const router = useRouter();

  const [authSynced, setAuthSynced] = useState(false);

  // Load custom fonts for dashboard
  const [fontsLoaded] = useFonts({
    'Orbitron': Orbitron_400Regular,
    'Orbitron-Bold': Orbitron_700Bold,
    'Inter': Inter_400Regular,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  // Sync Clerk token with Axios API Client and Sync User profile in Express PostgreSQL database
  useEffect(() => {
    if (!isLoaded) return;

    const syncAuth = async () => {
      if (isSignedIn) {
        try {
          const token = await getToken();
          setAuthToken(token);

          // Get primary email
          const email = user?.primaryEmailAddress?.emailAddress;
          if (email) {
            // Call sync API to ensure user exists in backend PostgreSQL database
            await api.post('/users/sync', { email });
            console.log('🏁 Auth and user synced with PostgreSQL successfully!');
            setAuthSynced(true);
          }
        } catch (e) {
          console.error('Error syncing auth with backend database:', e);
          // Set to true even on error to prevent blocking navigation indefinitely
          setAuthSynced(true);
        }
      } else {
        setAuthToken(null);
        setAuthSynced(false);
      }
    };

    syncAuth();
  }, [isSignedIn, isLoaded, user]);

  // Handle routing redirect based on auth state
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && !authSynced) return; // Wait until synced

    const inAuthGroup = segments[0] === '(auth)';

    if (isSignedIn && inAuthGroup) {
      // User is signed in, redirect out of login/register to dashboard tabs
      router.replace('/(tabs)');
    } else if (!isSignedIn && !inAuthGroup) {
      // User is signed out, redirect to login screen
      router.replace('/(auth)/login');
    }
  }, [isSignedIn, isLoaded, authSynced, segments]);

  if (!isLoaded || !fontsLoaded || (isSignedIn && !authSynced)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0D10', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00E5FF" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ClerkProvider publishableKey={EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
        <ClerkLoaded>
          <InitialLayout />
        </ClerkLoaded>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
