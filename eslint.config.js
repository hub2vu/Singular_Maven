import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "data/**", "docs/goal_agent_runs/**", ".codex/**", "test-results/**", "playwright-report/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        chrome: "readonly",
        console: "readonly",
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        location: "readonly",
        process: "readonly",
        Blob: "readonly",
        Buffer: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
        observeActiveTab: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLButtonElement: "readonly",
        NodeFilter: "readonly",
        Event: "readonly",
        localStorage: "readonly",
        crypto: "readonly"
      }
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
