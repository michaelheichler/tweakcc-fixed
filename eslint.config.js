import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'tools/node_modules/**', 'src/generated/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { js },
    extends: ['js/recommended'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    settings: {
      react: {
        version: '18.2',
        runtime: 'automatic',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    // tools/ are hand-maintained CommonJS/ESM build scripts (the canonical
    // prompt extractor + showtime harnesses), not part of the published bundle.
    // Relax the rules they legitimately break so they can join the lint gate
    // and still get the high-value checks (syntax, undefined refs, dupe keys).
    files: ['tools/**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off', // CJS scripts use require()
      'no-sparse-arrays': 'off', // intentional `(m || [, fallback])[1]` idiom
      '@typescript-eslint/no-unused-vars': 'off', // relaxed for build scripts
      'no-useless-escape': 'off',
    },
  },
]);
