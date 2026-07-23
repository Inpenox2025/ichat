import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext(null);

export const DARK = {
  bg: '#0c101a',
  bgSecondary: '#06080d',
  card: '#161c2d',
  cardAlt: '#1e293b',
  text: '#ffffff',
  textSub: '#e2e8f0',
  textMuted: '#a0aec0',
  textFaint: '#718096',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: '#2d3748',
  input: '#06080d',
  inputBorder: '#2d3748',
  accent: '#00f2fe',
  accentBg: 'rgba(0,242,254,0.08)',
  tabBar: '#161c2d',
  tabBarBorder: 'rgba(255,255,255,0.06)',
  chatItem: 'transparent',
  chatItemBorder: 'rgba(255,255,255,0.04)',
  selectedItem: 'rgba(56, 189, 248, 0.12)',
  badge: '#38bdf8',
  badgeText: '#0c101a',
  unreadBadge: '#ef4444',
  dropdown: '#161c2d',
  modalBg: '#0f172a',
  sectionHeader: '#161c2d',
  isDark: true,
};

export const LIGHT = {
  bg: '#f5f7fa',
  bgSecondary: '#ffffff',
  card: '#ffffff',
  cardAlt: '#f0f4f8',
  text: '#0f172a',
  textSub: '#1e293b',
  textMuted: '#475569',
  textFaint: '#94a3b8',
  border: 'rgba(0,0,0,0.07)',
  borderStrong: '#cbd5e0',
  input: '#f0f4f8',
  inputBorder: '#cbd5e0',
  accent: '#0284c7',
  accentBg: 'rgba(2,132,199,0.08)',
  tabBar: '#ffffff',
  tabBarBorder: 'rgba(0,0,0,0.08)',
  chatItem: '#ffffff',
  chatItemBorder: 'rgba(0,0,0,0.05)',
  selectedItem: 'rgba(2,132,199,0.1)',
  badge: '#0284c7',
  badgeText: '#ffffff',
  unreadBadge: '#ef4444',
  dropdown: '#ffffff',
  modalBg: '#ffffff',
  sectionHeader: '#f8fafc',
  isDark: false,
};

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [selectedTheme, setSelectedTheme] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem('ichat_theme').then(saved => {
      if (saved) setSelectedTheme(saved);
    });
  }, []);

  const effective = selectedTheme === 'system' ? (systemScheme || 'dark') : selectedTheme;
  const colors = effective === 'light' ? LIGHT : DARK;

  function changeTheme(mode) {
    setSelectedTheme(mode);
    AsyncStorage.setItem('ichat_theme', mode);
  }

  return (
    <ThemeContext.Provider value={{ colors, selectedTheme, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
