/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Fit Squad palette — sampled from the app screenshots
        ink: '#07110F',        // app background (near-black teal)
        panel: '#0C1A18',      // elevated background
        card: '#0F211E',       // card surface
        'card-2': '#122A26',   // hover / raised card
        line: '#1E3A34',       // hairline borders
        mint: '#2FE6A8',       // primary accent (spring green)
        'mint-dim': '#1FB985', // pressed / darker accent
        'mint-glow': '#34FFBC',
        cream: '#EAF3EF',      // primary text
        muted: '#7C938C',      // secondary text
        'muted-2': '#5A6E68',  // tertiary text
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl2: '20px',
        xl3: '26px',
      },
      boxShadow: {
        glow: '0 0 24px rgba(47,230,168,0.35)',
        'glow-lg': '0 0 40px rgba(47,230,168,0.45)',
        card: '0 1px 2px rgba(0,0,0,0.4), 0 12px 30px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
}
