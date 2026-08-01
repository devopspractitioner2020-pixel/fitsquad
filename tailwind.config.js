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
      // The screens are written with numeric weights (font-700, font-800).
      // Tailwind's default scale is named (font-bold, font-extrabold), so
      // without these aliases every one of those 37 class usages silently
      // compiled to nothing and headings rendered at weight 400.
      fontWeight: {
        400: '400',
        500: '500',
        600: '600',
        700: '700',
        800: '800',
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
