import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#d7dde5",
        surface: "#f7f9fb",
        ink: "#17202a",
        muted: "#607084",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
