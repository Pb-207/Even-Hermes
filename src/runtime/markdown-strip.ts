// Strip a small, well-known subset of Markdown so plain text can be rendered
// on the glasses framebuffer (no rich text). Intentionally narrow: we only
// touch syntax the agent is likely to emit. Anything ambiguous (lone
// asterisks, math expressions) is left alone.
export function stripMarkdown(s: string): string {
  if (!s) return s;
  let out = s;

  // Fenced code blocks ```...``` — replace the fence lines with blanks, keep
  // the code inside. Handles optional language tag (```js, ```typescript).
  out = out.replace(/```[a-zA-Z0-9_-]*\n?/g, '\n');

  // ATX headers: lines starting with one or more '#' followed by space.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');

  // Markdown links [text](url) → text. URL part can contain anything except ')'.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  // **bold** and __bold__ — only when paired (no spaces between markers and text).
  out = out.replace(/\*\*([^*]+?)\*\*/g, '$1');
  out = out.replace(/__([^_]+?)__/g, '$1');

  // *italic* and _italic_ — only when paired and the inner text is not empty
  // and does not start/end with whitespace.
  out = out.replace(/(?<![*])\*([^\s*][^*]*?[^\s*]|[^\s*])\*(?![*])/g, '$1');
  out = out.replace(/(?<![_])_([^\s_][^_]*?[^\s_]|[^\s_])_(?![_])/g, '$1');

  // Inline backtick code `foo` → foo.
  out = out.replace(/`([^`]+)`/g, '$1');

  return out;
}
