import type * as monaco from 'monaco-editor'

/** QAI 深色主题 — 基于 index.css 中的 oklch 变量对应色值 */
export const qaiDarkTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'string.key.json', foreground: '7dd3fc' },
    { token: 'string.value.json', foreground: '6ee7b7' },
    { token: 'string', foreground: '6ee7b7' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'keyword', foreground: 'c084fc' },
    { token: 'comment', foreground: '666680' },
    { token: 'delimiter', foreground: '888899' },
  ],
  colors: {
    'editor.background': '#1e1f28',
    'editor.foreground': '#e8e8ed',
    'editor.lineHighlightBackground': '#ffffff06',
    'editorCursor.foreground': '#7c9cf5',
    'editor.selectionBackground': '#ffffff15',
    'editorWidget.background': '#252630',
    'editorWidget.border': '#ffffff10',
    'input.background': '#ffffff08',
    'input.border': '#ffffff10',
    'focusBorder': '#7c9cf550',
    'editorGutter.background': '#1e1f28',
    'editorLineNumber.foreground': '#ffffff20',
    'editorLineNumber.activeForeground': '#ffffff50',
    'editorIndentGuide.background': '#ffffff08',
    'scrollbarSlider.background': '#ffffff10',
    'scrollbarSlider.hoverBackground': '#ffffff20',
    'scrollbarSlider.activeBackground': '#ffffff30',
  },
}

/** QAI 浅色主题 */
export const qaiLightTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'string.key.json', foreground: '0284c7' },
    { token: 'string.value.json', foreground: '059669' },
    { token: 'string', foreground: '059669' },
    { token: 'number', foreground: 'd97706' },
    { token: 'keyword', foreground: '9333ea' },
    { token: 'comment', foreground: '999999' },
    { token: 'delimiter', foreground: '666666' },
  ],
  colors: {
    'editor.background': '#f9f9fb',
    'editor.foreground': '#1a1a22',
    'editor.lineHighlightBackground': '#00000006',
    'editorCursor.foreground': '#4a6ad8',
    'editor.selectionBackground': '#00000012',
    'editorWidget.background': '#f4f4f7',
    'editorWidget.border': '#00000012',
    'input.background': '#00000006',
    'input.border': '#00000012',
    'focusBorder': '#4a6ad850',
    'editorGutter.background': '#f9f9fb',
    'editorLineNumber.foreground': '#00000020',
    'editorLineNumber.activeForeground': '#00000050',
    'editorIndentGuide.background': '#00000008',
    'scrollbarSlider.background': '#00000010',
    'scrollbarSlider.hoverBackground': '#00000020',
    'scrollbarSlider.activeBackground': '#00000030',
  },
}
