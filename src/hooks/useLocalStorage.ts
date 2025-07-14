import { useState } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setStoredValue = (val: T) => {
    setValue(val);
    window.localStorage.setItem(key, JSON.stringify(val));
  };

  return [value, setStoredValue] as const;
}
