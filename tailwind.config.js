/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        mocha: {
          base: '#1e1e2e',
          surface0: '#313244',
          surface1: '#45475a',
          text: '#cdd6f4',
          subtext0: '#a6adc8',
          blue: '#89b4fa',
          pink: '#f5c2e7',
          green: '#a6e3a1',
          red: '#f38ba8',
          yellow: '#f9e2af'
        }
      }
    }
  },
  plugins: []
};
