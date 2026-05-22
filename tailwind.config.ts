import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        espn: {
          red: '#F51825',
          offwhite: '#F5F5F5',
          slate: '#1A1A1A',
          border: '#D9D9D9',
          muted: '#6B6B6B',
        },
      },
      boxShadow: {
        panel: '0 18px 48px rgba(26, 26, 26, 0.08)',
      },
      fontFamily: {
        sans: ['Avenir Next', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;