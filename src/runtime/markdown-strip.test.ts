import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './markdown-strip';

describe('stripMarkdown', () => {
  it('strips leading ATX headers but keeps the heading text', () => {
    expect(stripMarkdown('# Hello')).toBe('Hello');
    expect(stripMarkdown('### Sub heading')).toBe('Sub heading');
    expect(stripMarkdown('#####  Six hashes')).toBe('Six hashes');
  });

  it('strips ** and __ bold markers, keeps inner text', () => {
    expect(stripMarkdown('this is **bold** and __also bold__')).toBe('this is bold and also bold');
  });

  it('strips _ and * italic markers, keeps inner text', () => {
    expect(stripMarkdown('this is *italic* and _also italic_')).toBe('this is italic and also italic');
  });

  it('strips inline backtick code, keeps inner text', () => {
    expect(stripMarkdown('use `foo()` to call')).toBe('use foo() to call');
  });

  it('strips fenced code blocks (the fences only) and keeps code content', () => {
    expect(stripMarkdown('text\n```js\nconst x = 1;\n```\ntail')).toBe('text\n\nconst x = 1;\n\ntail');
  });

  it('strips markdown links and keeps the visible text', () => {
    expect(stripMarkdown('see [docs](https://example.com)')).toBe('see docs');
    expect(stripMarkdown('[a](u1) and [b](u2)')).toBe('a and b');
  });

  it('preserves newlines and plain prose', () => {
    expect(stripMarkdown('first line\nsecond line')).toBe('first line\nsecond line');
  });

  it('handles a realistic mixed paragraph', () => {
    const md = '## Quick note\nUse **`npm run dev`** to start. See [docs](https://x.io).';
    expect(stripMarkdown(md)).toBe('Quick note\nUse npm run dev to start. See docs.');
  });

  it('is a no-op on empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('does not eat asterisks that are not paired (defensive)', () => {
    expect(stripMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6');
  });
});
