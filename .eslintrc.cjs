module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: ["dist", "build", "node_modules"],
  overrides: [
    {
      files: ["extension/src/**/*.{ts,tsx}"],
      plugins: ["react"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:@typescript-eslint/recommended",
        "prettier"
      ],
      settings: {
        react: {
          version: "detect"
        }
      }
    }
  ]
};
