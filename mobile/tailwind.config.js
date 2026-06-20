/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan all files in root components/ and app/ directories (no src folder!)
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        carbon: {
          matte: '#0B0D10',
          dark: '#0F1216',
        },
        tarmac: {
          DEFAULT: '#171B22',
          light: '#202630',
        },
        ducati: {
          red: '#FF2A3B',
        },
        ktm: {
          orange: '#FF6B00',
        },
        kawasaki: {
          green: '#2CFF0A',
        },
        speedo: {
          cyan: '#00E5FF',
        },
      },
      fontFamily: {
        orbitron: ["Orbitron"],
        inter: ["Inter"],
      },
    },
  },
  plugins: [],
}
