/**
 * ESLint 配置（ESLint 8 legacy 格式）。
 *
 * 原则：只拦"真错"，不做风格检查（风格交给 Prettier）。
 * - `@typescript-eslint/no-explicit-any` 暂时关闭：节点配置契约尚未建立（见 review A1），
 *   关闭它才能让 lint 先跑起来；T2 完成后必须改回 error。
 * - `react-hooks/exhaustive-deps` 保持 warn：现有代码有多处刻意收紧依赖，先不阻断。
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.ts', 'vite.config.ts'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
