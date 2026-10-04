/** Lint the maintained legacy baseline with TypeScript and ownership-specific globals. */
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    { ignores: ["node_modules/**", "dist/**", "coverage/**", "artifacts/**", ".agent-teams/**", "context/**", "Assets/**", "BackEnd/data/**", "BackEnd/Persistence Layer/data/**"] },
    ...tseslint.configs.recommended,
    {
        files: ["BackEnd/**/*.ts", "BackEndTest/**/*.ts", "*.mjs"],
        languageOptions: { globals: globals.node },
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
        },
    },
    { files: ["FrontEnd/**/*.js"], languageOptions: { globals: globals.browser } },
);
