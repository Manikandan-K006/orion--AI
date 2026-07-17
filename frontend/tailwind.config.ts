import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#d7dde5",
        surface: "#f7f9fb",
        ink: "#17202a",
        muted: "#607084",
        accent: "#0f766e"
      },
      borderRadius: {
        card: "20px",
      },
      boxShadow: {
        card: "0 6px 20px rgba(15,23,42,0.06)",
        "card-dark": "0 12px 30px rgba(0,0,0,0.45)",
      },
      animation: {
        "bounce-slow": "bounce 3s infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "shine": "shine 2s ease-in-out infinite",
        "ken-burns": "ken-burns 20s ease-in-out infinite alternate",
        "float": "float 6s ease-in-out infinite",
      },
      keyframes: {
        shine: {
          "0%, 100%": { filter: "brightness(1) drop-shadow(0 0 4px #f59e0b)" },
          "50%": { filter: "brightness(1.4) drop-shadow(0 0 16px #f59e0b)" },
        },
        "ken-burns": {
          "0%": { transform: "scale(1) translate(0, 0)" },
          "50%": { transform: "scale(1.08) translate(-1%, -1%)" },
          "100%": { transform: "scale(1.04) translate(1%, 1%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
    }
  },
  plugins: []
};

export default config;
