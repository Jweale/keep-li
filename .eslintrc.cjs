module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  env: {
    es2021: true
  },
  ignorePatterns: ["dist", "build", "node_modules"],
  overrides: [
    {
      files: ["shared/src/**/*.ts"],
      parserOptions: {
        project: ["./shared/tsconfig.json"],
        tsconfigRootDir: __dirname
      },
      env: {
        node: true
      }
    },
    {
      files: ["api/src/**/*.ts"],
      parserOptions: {
        project: ["./api/tsconfig.json"],
        tsconfigRootDir: __dirname
      },
      env: {
        worker: true
      }
    },
    {
      files: ["extension/src/**/*.{ts,tsx}"],
      parserOptions: {
        project: ["./extension/tsconfig.json"],
        tsconfigRootDir: __dirname,
        ecmaFeatures: {
          jsx: true
        }
      },
      env: {
        browser: true
      },
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
    },
    {
      files: ["**/*.test.{ts,tsx}"],
      env: {
        node: true
      },
      globals: {
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly"
      }
    }
  ]
};
