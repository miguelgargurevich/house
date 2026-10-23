import { useCallback, useEffect, useState } from 'react';

const KEY = 'house-theme';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  const toggle = useCallback(() => {
    setDark(d => {
      try { localStorage.setItem(KEY, d ? 'light' : 'dark'); } catch { /* sin almacenamiento */ }
      return !d;
    });
  }, []);
  return { dark, toggle };
}
