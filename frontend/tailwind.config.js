/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bauhaus-inspired primary colors
        bauhaus: {
          red: '#BE3144',
          yellow: '#F5B700',
          blue: '#1B4965',
          black: '#0D0D0D',
          white: '#FAFAFA',
          gray: '#4A4A4A',
          lightgray: '#E8E8E8',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
