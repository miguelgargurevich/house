/** @type {import('tailwindcss').Config} */
const c = (name) => `oklch(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        surface2: c('surface-2'),
        line: c('line'),
        ink: c('ink'),
        muted: c('muted'),
        brand: c('brand'),
        'brand-hover': c('brand-hover'),
        'brand-soft': c('brand-soft'),
        'on-brand': c('on-brand'),
        escena: c('escena'),
        'on-escena': c('on-escena'),
        'escena-tarjeta': c('escena-tarjeta'),
        ok: c('ok'),
        'ok-soft': c('ok-soft'),
        warn: c('warn'),
        'warn-soft': c('warn-soft'),
        bad: c('bad'),
        'bad-soft': c('bad-soft'),
        info: c('info'),
        'info-soft': c('info-soft'),
      },
      fontFamily: {
        sans: ['"Figtree Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', '1rem'],
        sm: ['0.875rem', '1.25rem'],
        base: ['1rem', '1.5rem'],
        lg: ['1.125rem', '1.5rem'],
        xl: ['1.25rem', '1.75rem'],
        '2xl': ['1.5rem', '2rem'],
        '3xl': ['1.875rem', '2.25rem'],
      },
      borderRadius: { DEFAULT: '0.5rem', lg: '0.75rem', xl: '1rem' },
      boxShadow: {
        card: '0 1px 2px oklch(0.2 0.02 170 / 0.06), 0 1px 1px oklch(0.2 0.02 170 / 0.04)',
        pop: '0 12px 32px -8px oklch(0.2 0.02 170 / 0.22), 0 2px 6px oklch(0.2 0.02 170 / 0.08)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
};
