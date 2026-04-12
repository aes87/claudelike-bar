/**
 * Wrap a string in POSIX shell single quotes, escaping any embedded single
 * quotes via the `'\''` pattern. The result is safe to concatenate into any
 * bash/zsh command line — single-quoted strings have no interpretation
 * except the closing quote itself.
 *
 * Do NOT use `JSON.stringify` for shell quoting: JSON escaping is not the
 * same as bash double-quoted-string escaping, and `$`, backticks, and `\`
 * remain active inside double quotes. Terminal keys in the config file
 * flow through this function into `terminal.sendText`, so getting this
 * wrong is a shell injection vector.
 */
export function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
