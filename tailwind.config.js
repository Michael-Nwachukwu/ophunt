/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0a0a0a',
        accent: '#ff4d8b',
        background: '#fffaf0',
        'card-pink': '#ff4d8b',
        'card-teal': '#1a3a3a',
        'card-lavender': '#b8a4ed',
        'card-peach': '#ffb084',
        'card-ochre': '#e8b94a',
        'card-cream': '#f5f0e0',
      },
      fontFamily: {
        heading: ['Fraunces', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};