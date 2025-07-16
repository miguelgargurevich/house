import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      document.documentElement.classList.add('dark');
      return true;
    }
    if (stored === 'light') {
      document.documentElement.classList.remove('dark');
      return false;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    return prefersDark;
  });

  // Actualiza el DOM y localStorage cuando cambia el estado
  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  // Sincroniza con cambios del sistema o de otras pestañas
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMedia = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) setDark(e.matches);
    };
    media.addEventListener('change', handleMedia);
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'theme') {
        if (e.newValue === 'dark') setDark(true);
        else if (e.newValue === 'light') setDark(false);
        else setDark(media.matches);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      media.removeEventListener('change', handleMedia);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <button
      aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'}
      className="ml-2 p-1 rounded hover:bg-accent/20 transition"
      onClick={() => setDark(d => !d)}
      type="button"
    >
      {dark ? (
        <SunIcon className="h-5 w-5 text-yellow-400" />
      ) : (
        <MoonIcon className="h-5 w-5 text-gray-400 dark:text-white" />
      )}
    </button>
  );
}
