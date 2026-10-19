'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const KEY = 'scout-theme';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeState>({ theme: 'light', setTheme: () => {}, toggle: () => {} });

function stored(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Private mode: fall through to the default.
  }
  return 'light';
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

/** Runs before hydration so the saved theme applies with no flash. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;

/** Site theme, persisted. Light is the brand default; dark remaps the same tokens. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === 'undefined' ? 'light' : stored(),
  );

  // The pre-hydration script sets the class first; this keeps it in sync.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  const persist = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      // Ignore.
    }
  }, []);

  const toggle = useCallback(() => {
    persist(theme === 'dark' ? 'light' : 'dark');
  }, [persist, theme]);

  return <Ctx.Provider value={{ theme, setTheme: persist, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(Ctx);
}

/** Header toggle: sun in dark mode, moon in light mode. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-stone transition-colors hover:border-linestrong hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-citron"
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
