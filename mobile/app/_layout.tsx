import React, { useEffect, useState } from 'react';
import { ClerkProvider, ClerkLoaded, SignedIn, SignedOut, useAuth, useUser } from '@clerk/clerk-expo';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { 
  useFonts, 
  Orbitron_400Regular, 
  Orbitron_600SemiBold,
  Orbitron_700Bold 
} from '@expo-google-fonts/orbitron';
import {
  Barlow_400Regular,
  Barlow_600SemiBold,
  Barlow_700Bold
} from '@expo-google-fonts/barlow';
import {
  BarlowCondensed_400Regular,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold
} from '@expo-google-fonts/barlow-condensed';
import {
  Rajdhani_400Regular,
  Rajdhani_500Medium,
  Rajdhani_600SemiBold,
  Rajdhani_700Bold
} from '@expo-google-fonts/rajdhani';
import { 
  Inter_400Regular, 
  Inter_600SemiBold, 
  Inter_700Bold 
} from '@expo-google-fonts/inter';
import { View, ActivityIndicator, Text, TextInput, StyleSheet, Platform } from 'react-native';

const patchTextComponent = (Component: any, defaultFont: string) => {
  if (!Component) return;

  const patchStyle = (style: any) => {
    // Flatten style first to ensure we work with a single object and never return an array
    const flatStyle = StyleSheet.flatten(style) || {};
    
    // Remove any numeric/array properties that might have leaked from Object.assign or string mapping
    const cleanStyle = { ...flatStyle };
    Object.keys(cleanStyle).forEach(key => {
      if (/^\d+$/.test(key)) {
        delete cleanStyle[key];
      }
    });

    const font = cleanStyle?.fontFamily;
    const weight = cleanStyle?.fontWeight;
    const isBold = weight === 'bold' || weight === '700' || weight === '800' || weight === '900';
    const isSemi = weight === '500' || weight === '600';

    let targetFont = defaultFont;
    if (font) {
      const baseFonts = ['Orbitron', 'Barlow', 'BarlowCondensed', 'Rajdhani', 'Inter'];
      const isResolved = baseFonts.some(bf => font.startsWith(bf + '-'));
      if (isResolved) {
        targetFont = font;
      } else if (baseFonts.includes(font)) {
        let resolved = font;
        if (isBold) {
          resolved = `${font}-Bold`;
        } else if (isSemi) {
          resolved = `${font}-SemiBold`;
        } else if (font === 'Rajdhani') {
          resolved = 'Rajdhani-Medium';
        }
        targetFont = resolved;
      } else {
        targetFont = font;
      }
    } else {
      if (isBold) {
        targetFont = `${defaultFont}-Bold`;
      } else if (isSemi) {
        targetFont = `${defaultFont}-SemiBold`;
      }
    }

    return { ...cleanStyle, fontFamily: targetFont };
  };

  // If component has a direct render function (e.g. forwardRef)
  if (Component.render) {
    const oldRender = Component.render;
    Component.render = function (props: any, ref: any) {
      if (!props) return oldRender.call(this, props, ref);

      // Determine font family based on props.style
      const style = props.style;
      const flatStyle = StyleSheet.flatten(style) || {};
      const font = flatStyle?.fontFamily;
      const weight = flatStyle?.fontWeight;
      const isBold = weight === 'bold' || weight === '700' || weight === '800' || weight === '900';
      const isSemi = weight === '500' || weight === '600';

      let targetFont = defaultFont;
      if (font) {
        const baseFonts = ['Orbitron', 'Barlow', 'BarlowCondensed', 'Rajdhani', 'Inter'];
        const isResolved = baseFonts.some(bf => font.startsWith(bf + '-'));
        if (isResolved) {
          targetFont = font;
        } else if (baseFonts.includes(font)) {
          let resolved = font;
          if (isBold) {
            resolved = `${font}-Bold`;
          } else if (isSemi) {
            resolved = `${font}-SemiBold`;
          } else if (font === 'Rajdhani') {
            resolved = 'Rajdhani-Medium';
          }
          targetFont = resolved;
        } else {
          targetFont = font;
        }
      } else {
        if (isBold) {
          targetFont = `${defaultFont}-Bold`;
        } else if (isSemi) {
          targetFont = `${defaultFont}-SemiBold`;
        }
      }

      // Merge the font family safely by appending it to the style array
      let patchedStyle;
      if (Array.isArray(style)) {
        patchedStyle = [...style, { fontFamily: targetFont }];
      } else if (style) {
        patchedStyle = [style, { fontFamily: targetFont }];
      } else {
        patchedStyle = { fontFamily: targetFont };
      }

      // Call oldRender with patched props
      return oldRender.call(this, { ...props, style: patchedStyle }, ref);
    };
  } else if (Component.prototype && Component.prototype.render) {
    // If it is a class component, fallback to style patching on output
    const oldPrototypeRender = Component.prototype.render;
    Component.prototype.render = function (...args: any[]) {
      const origin = oldPrototypeRender.apply(this, args);
      if (!origin) return origin;
      return React.cloneElement(origin, {
        style: patchStyle(origin.props.style),
      });
    };
  }
};

patchTextComponent(Text, 'Barlow');
patchTextComponent(TextInput, 'Barlow');

import { tokenCache } from '../utils/tokenCache';
import { setAuthToken, setTokenResolver, api } from '../utils/api';
import { AlertProvider } from '../utils/AlertContext';
import { ThemeProvider } from '../utils/ThemeContext';
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

  useEffect(() => {
    if (isLoaded) {
      setTokenResolver(getToken);
    }
    return () => {
      setTokenResolver(null);
    };
  }, [isLoaded, getToken]);

  // Load custom fonts for dashboard
  const [fontsLoaded] = useFonts({
    'Orbitron': Orbitron_400Regular,
    'Orbitron-SemiBold': Orbitron_600SemiBold,
    'Orbitron-Bold': Orbitron_700Bold,
    'Barlow': Barlow_400Regular,
    'Barlow-SemiBold': Barlow_600SemiBold,
    'Barlow-Bold': Barlow_700Bold,
    'BarlowCondensed': BarlowCondensed_400Regular,
    'BarlowCondensed-SemiBold': BarlowCondensed_600SemiBold,
    'BarlowCondensed-Bold': BarlowCondensed_700Bold,
    'Rajdhani': Rajdhani_400Regular,
    'Rajdhani-Medium': Rajdhani_500Medium,
    'Rajdhani-SemiBold': Rajdhani_600SemiBold,
    'Rajdhani-Bold': Rajdhani_700Bold,
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
      <View style={{ flex: 1, backgroundColor: '#F4F5F7', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1C69D4" />
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
      <ClerkProvider publishableKey={EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY} tokenCache={Platform.OS === 'web' ? undefined : tokenCache}>
        <ClerkLoaded>
          <ThemeProvider>
            <AlertProvider>
              <InitialLayout />
            </AlertProvider>
          </ThemeProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
