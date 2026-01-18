/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#1e1e1e",
        sidebar: "#252526",
        border: "#333333",
        accent: "#007acc",
        text: {
          primary: "#cccccc",
          secondary: "#999999",
          muted: "#666666",
        },
      },
    },
  },
  plugins: [],
}
