import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{html,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#038C7F",
        "accent-teal": "#027373",
        "accent-aqua": "#A9D9D0",
        background: "#F2E7DC",
        text: "#0D0D0D"
      }
    }
  },
  plugins: []
};

export default config;
