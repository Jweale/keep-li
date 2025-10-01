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
      },
      fontFamily: {
        heading: ["Inter", "ui-sans-serif", "system-ui"],
        body: ["Open Sans", "ui-sans-serif", "system-ui"]
      },
      boxShadow: {
        brand: "0px 12px 30px -16px rgba(2, 115, 115, 0.35)"
      }
    }
  },
  plugins: []
};

export default config;
