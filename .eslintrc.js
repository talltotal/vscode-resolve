module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    env: {
        node: true,
        es6: true
    },
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
}
