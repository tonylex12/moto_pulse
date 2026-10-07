import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Gauge, Fuel, Wrench, Map } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../utils/ThemeContext';
import { MotoPulseDesign } from '../../constants/design';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme, colors } = useTheme();

	const activeColor = MotoPulseDesign.color.pulse;
  const inactiveColor = theme === 'light' ? '#718096' : '#8F9CAE';
	const bgColor = theme === 'light' ? '#FFFDF8' : MotoPulseDesign.color.asphalt;
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
		  position: 'absolute',
		  marginHorizontal: 12,
		  marginBottom: 8,
		  borderRadius: 22,
		  borderTopWidth: 1,
          borderTopColor: borderColor,
		  height: Platform.OS === 'ios' ? 58 + insets.bottom : 66 + insets.bottom,
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
		  title: 'Hoy',
          tabBarIcon: ({ color, size }) => <Gauge size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
		  title: 'Garaje',
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
		  title: 'Rodar',
          tabBarIcon: ({ color, size }) => <Map size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
