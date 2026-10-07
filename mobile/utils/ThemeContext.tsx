import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark';
type ThemePreference = Theme | 'system';

interface ThemeColors {
  bg: string;
  card: string;
  subCard: string;
  border: string;
  text: string;
  textSec: string;
  textMuted: string;
  textAccent: string;
  bgAccent: string;
  borderAccent: string;
  bmwBlue: string;
  bmwRed: string;
  bmwLightBlue: string;
  statusGreen: string;
  statusGreenBg: string;
  isDark: boolean;
}

interface ThemeContextType {
  theme: Theme;
  colors: ThemeColors;
  toggleTheme: () => void;
	preference: ThemePreference;
	setThemePreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const lightColors: ThemeColors = {
  bg: 'bg-[#F4F5F7]',
  card: 'bg-[#FFFFFF]',
  subCard: 'bg-[#EBF0F5]',
  border: 'border-[#D8E0EB]',
  text: 'text-[#002C5B]',
  textSec: 'text-[#4E5E72]', // Medium slate grey
  textMuted: 'text-[#8E9FBC]', // Light slate blue-grey
  textAccent: 'text-[#FF5A1F]', // MotoPulse orange
  bgAccent: 'bg-[#FF5A1F]',
  borderAccent: 'border-[#FF5A1F]',
  bmwBlue: '#FF5A1F',
  bmwRed: '#E30613',
  bmwLightBlue: '#FF5A1F',
  statusGreen: '#34C759', // iOS Switch Green
  statusGreenBg: 'bg-[#34C759]',
  isDark: false,
};

const darkColors: ThemeColors = {
  bg: 'bg-[#0A0D12]', // Deep midnight black
  card: 'bg-[#121620]', // BMW Motorsport dark navy card
  subCard: 'bg-[#1A202C]', // Charcoal grey/blue card
  border: 'border-[#242D3D]', // Dark metallic border
  text: 'text-white',
  textSec: 'text-[#E2E8F0]', // Bright light grey
  textMuted: 'text-[#A0AEC0]', // Medium-light grey for readable labels
  textAccent: 'text-[#FF5A1F]', // MotoPulse orange
  bgAccent: 'bg-[#FF5A1F]',
  borderAccent: 'border-[#FF5A1F]',
  bmwBlue: '#FF5A1F',
  bmwRed: '#FF1E27',
  bmwLightBlue: '#FF5A1F',
  statusGreen: '#34C759', // iOS Switch Green
  statusGreenBg: 'bg-[#34C759]',
  isDark: true,
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [theme, setTheme] = useState<Theme>(systemScheme === 'dark' ? 'dark' : 'light');
	const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    // Load theme from storage preference
    AsyncStorage.getItem('theme_preference').then((savedTheme) => {
	  const saved = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system';
	  setPreference(saved);
	  setTheme(saved === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : saved);
    });
  }, []);

  // Dynamically adapt to system theme changes
  useEffect(() => {
	if (preference === 'system') setTheme(systemScheme === 'dark' ? 'dark' : 'light');
  }, [systemScheme, preference]);

  const setThemePreference = (next: ThemePreference) => {
	setPreference(next);
	setTheme(next === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : next);
	AsyncStorage.setItem('theme_preference', next);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
	setThemePreference(nextTheme);
  };

  const colors = theme === 'light' ? lightColors : darkColors;

  return (
	<ThemeContext.Provider value={{ theme, colors, toggleTheme, preference, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
