import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Gauge, Fuel, Wrench, Map } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#00E5FF', // Speedometer Cyan
        tabBarInactiveTintColor: '#8F9CAE', // Muted Silver
        tabBarLabelStyle: {
          fontFamily: 'Inter-SemiBold',
          fontSize: 11,
          paddingBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: '#0B0D10', // Carbon Matte
          borderTopWidth: 1.5,
          borderTopColor: '#171B22', // Tarmac border
          height: Platform.OS === 'ios' ? 52 + insets.bottom : 60 + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.4,
          shadowRadius: 5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Panel',
          tabBarIcon: ({ color, size }) => <Gauge size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'Consumo',
          tabBarIcon: ({ color, size }) => <Fuel size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color, size }) => <Wrench size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Rutas',
          tabBarIcon: ({ color, size }) => <Map size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
