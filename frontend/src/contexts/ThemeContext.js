// contexts/ThemeContext.js — Global theme provider (Light / Dark)
// ThemeScreen.js → setTheme() → updates palette + writes AsyncStorage 'app_theme'
// All themed screens call useTheme() → { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE, isDark, setTheme }

import { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LIGHT = {
  BG:    '#FFFFFF',
  CARD:  '#F2F2F7',
  BLACK: '#000000',
  GRAY:  '#6D6D72',
  GRAY2: '#C7C7CC',
  GRAY3: '#E5E5EA',
  WHITE: '#FFFFFF',
  isDark: false,
};

const DARK = {
  BG:    '#000000',
  CARD:  '#1C1C1E',
  BLACK: '#FFFFFF',
  GRAY:  '#8E8E93',
  GRAY2: '#48484A',
  GRAY3: '#2C2C2E',
  WHITE: '#000000',
  isDark: true,
};

const ThemeContext = createContext({ ...LIGHT, setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [palette, setPalette] = useState(LIGHT);

  // Load saved preference on mount — written by ThemeScreen.js → setTheme()
  useEffect(() => {
    AsyncStorage.getItem('app_theme').then(v => {
      if (v === 'dark') setPalette(DARK);
    });
  }, []);

  // Updates palette in-memory and persists to AsyncStorage
  // Called by ThemeScreen.js → handleSelect()
  function setTheme(key) {
    setPalette(key === 'dark' ? DARK : LIGHT);
    AsyncStorage.setItem('app_theme', key);
  }

  return (
    <ThemeContext.Provider value={{ ...palette, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Returns { BG, CARD, BLACK, GRAY, GRAY2, GRAY3, WHITE, isDark, setTheme }
export const useTheme = () => useContext(ThemeContext);
