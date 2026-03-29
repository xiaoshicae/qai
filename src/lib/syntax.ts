/** 共享的 JSON 语法分词器和主题感知 token 颜色 */

export interface Token {
  text: string
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'bracket' | 'plain'
}

/**
 * token 颜色：使用 dark: 变体适配双主题
 * 浅色用 -600 色阶（在白底上对比度充足），深色用 -400
 */
export const TOKEN_COLORS: Record<string, string> = {
  key: 'text-sky-600 dark:text-sky-400',
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-amber-600 dark:text-amber-400',
  boolean: 'text-purple-600 dark:text-purple-400',
  null: 'text-purple-600 dark:text-purple-400',
  bracket: 'text-muted-foreground/60',
}

export function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  const re = /("(?:\\.|[^"\\])*")[^\S\n]*(:)?|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index), type: 'plain' })
    }

    const [full, str, colon, bool, nul, num, bracket] = match
    if (str) {
      if (colon) {
        tokens.push({ text: str, type: 'key' })
        tokens.push({ text: colon, type: 'plain' })
      } else {
        tokens.push({ text: str, type: 'string' })
      }
    } else if (bool) {
      tokens.push({ text: full, type: 'boolean' })
    } else if (nul) {
      tokens.push({ text: full, type: 'null' })
    } else if (num) {
      tokens.push({ text: full, type: 'number' })
    } else if (bracket) {
      tokens.push({ text: full, type: 'bracket' })
    }

    lastIndex = re.lastIndex
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: 'plain' })
  }

  return tokens
}
