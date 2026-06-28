import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark';

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
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const lightColors: ThemeColors = {
  bg: 'bg-[#F4F5F7]',
  card: 'bg-[#FFFFFF]',
  subCard: 'bg-[#EBF0F5]',
  border: 'border-[#D8E0EB]',
  text: 'text-[#002C5B]', // BMW Motorsport Deep Blue
  textSec: 'text-[#4E5E72]', // Medium slate grey
  textMuted: 'text-[#8E9FBC]', // Light slate blue-grey
  textAccent: 'text-[#1C69D4]', // BMW Motorsport Royal Blue
  bgAccent: 'bg-[#1C69D4]',
  borderAccent: 'border-[#1C69D4]',
  bmwBlue: '#1C69D4',
  bmwRed: '#E30613',
  bmwLightBlue: '#00A3E0',
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
  textAccent: 'text-[#00A3E0]', // BMW Motorsport Light Blue
  bgAccent: 'bg-[#00A3E0]',
  borderAccent: 'border-[#00A3E0]',
  bmwBlue: '#0066B2',
  bmwRed: '#FF1E27',
  bmwLightBlue: '#00A3E0',
  statusGreen: '#34C759', // iOS Switch Green
  statusGreenBg: 'bg-[#34C759]',
  isDark: true,
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [theme, setTheme] = useState<Theme>(systemScheme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    // Load theme from storage preference
    AsyncStorage.getItem('theme_preference').then((savedTheme) => {
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme);
      } else {
        setTheme(systemScheme === 'dark' ? 'dark' : 'light');
      }
    });
  }, []);

  // Dynamically adapt to system theme changes
  useEffect(() => {
    setTheme(systemScheme === 'dark' ? 'dark' : 'light');
  }, [systemScheme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    AsyncStorage.setItem('theme_preference', nextTheme);
  };

  const colors = theme === 'light' ? lightColors : darkColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme }}>
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
