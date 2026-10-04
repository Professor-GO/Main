/** Lint maintained client, server and tooling sources with ownership-specific globals. */
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "artifacts/**",
      ".agent-teams/**",
      "context/**",
      "Assets/**",
      "BackEnd/data/**",
      "BackEnd/Persistence Layer/data/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/server/**/*.ts", "*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/server/**", "node:*"] },
      ],
    },
  },
  {
    files: ["src/client/**/tests/**"],
    rules: { "no-restricted-imports": "off" },
  },
  { files: ["*.config.ts"], languageOptions: { globals: globals.node } },
);
