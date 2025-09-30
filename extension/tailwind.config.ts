import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{html,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0a66c2"
      }
    }
  },
  plugins: []
};

export default config;
