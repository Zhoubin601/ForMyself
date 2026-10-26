import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'android/**', 'output/**', 'raw/**', 'docs/**']
  },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-escape': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'vue/html-indent': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/require-default-prop': 'off'
    }
  },
  {
    files: ['src/shared/**/*.js', 'src/platform/ai/**/*.js', 'src/features/**/*Core.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [
      { group: ['pinia', '**/stores/**', '**/*Store.js'], message: 'Shared rules and transport must receive data explicitly, without global stores.' }
    ] }] }
  },
  {
    files: ['src/features/**/*Store.js'],
    rules: { 'no-restricted-imports': ['error', { paths: [
      { name: '@capacitor/preferences', message: 'Use the feature repository.' },
      { name: '@capacitor/filesystem', message: 'Use a storage adapter.' }
    ] }] }
  }

]
