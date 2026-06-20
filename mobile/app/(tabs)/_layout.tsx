import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Gauge, Fuel, Wrench, Map } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../utils/ThemeContext';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme, colors } = useTheme();

  const activeColor = theme === 'light' ? colors.bmwBlue : colors.bmwLightBlue;
  const inactiveColor = theme === 'light' ? '#718096' : '#8F9CAE';
  const bgColor = theme === 'light' ? '#FFFFFF' : '#0A0D12';
  const borderColor = theme === 'light' ? '#D8E0EB' : '#1A202C';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarLabelStyle: {
          fontFamily: 'Inter-SemiBold',
          fontSize: 11,
          paddingBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: bgColor,
          borderTopWidth: 1.5,
          borderTopColor: borderColor,
          height: Platform.OS === 'ios' ? 52 + insets.bottom : 60 + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: theme === 'light' ? 0.08 : 0.4,
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
