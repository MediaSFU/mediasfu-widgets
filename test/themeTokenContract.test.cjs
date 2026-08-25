/**
 * theme.css is the token CONTRACT, not shipped CSS.
 *
 * WHY IT IS NOT SHIPPED
 * Every `--msfu-*` use in the blocks is written `var(--msfu-color-primary,
 * #14a394)` — the inline fallback is what actually renders, which is what lets
 * a widget look right in a host page that has set nothing at all. That is the
 * product promise and it must not change.
 *
 * Bundling theme.css would break it in a quiet way: `var()` resolves the token
 * before the fallback, so a shipped `:root { --msfu-color-primary: … }` would
 * silently override every fallback everywhere. Two competing sources of truth,
 * one of which always wins invisibly. It would also push `:root` custom
 * properties into somebody else's document, which a widget has no business
 * doing.
 *
 * So theme.css stays a declaration of intent — the thing integrators read when
 * they want to know what is overridable — and the fallbacks stay the shipped
 * defaults.
 *
 * WHY THIS TEST EXISTS
 * Two declarations of the same value drift. This is not hypothetical: the
 * shadow scale in theme.css was improved and the fallbacks kept Tailwind's old
 * flat values, so the improvement shipped to nobody. The same thing had already
 * happened with the brand colour. Separately the code contradicted itself —
 * `--msfu-color-text-muted` fell back to `#9ca3af` in one file (that is
 * text-LIGHT's value) and `#6b7280` everywhere else, and
 * `--msfu-border-radius-lg` fell back to `24px` in one place because `24px` was
 * copied off the `spacing-lg` on the line above.
 *
 * Every one of those is invisible until someone reads two files side by side.
 * This test reads them side by side on every run.
 */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', 'src');
const THEME = path.join(ROOT, 'blocks', 'styles', 'theme.css');

/** Declarations from the `:root` block only — the dark-mode block below it
 *  deliberately holds different values for the same tokens. */
function readDeclaredLightTokens() {
  const css = fs.readFileSync(THEME, 'utf8');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const light = darkAt > 0 ? css.slice(0, darkAt) : css;
  const out = {};
  const re = /^\s*(--msfu-[a-z0-9-]+):\s*([^;]+);/gm;
  let m;
  while ((m = re.exec(light))) out[m[1]] = normalize(m[2]);
  return out;
}

/** Every `var(--msfu-*, fallback)` across the shipped blocks and widgets. */
function readFallbacks() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) files.push(p);
    }
  };
  ['blocks', 'widgets'].forEach((d) => {
    const dir = path.join(ROOT, d);
    if (fs.existsSync(dir)) walk(dir);
  });

  const out = new Map();
  files.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    /* Only the token name is matched here. The FALLBACK is read by balancing
       parens, because shadow values embed `rgba(...)` — a lazy `[^)]+` stops
       at the first inner `)` and reports a truncated value as drift. */
    const re = /var\((--msfu-[a-z0-9-]+),\s*/g;
    let m;
    while ((m = re.exec(src))) {
      const token = m[1];
      let depth = 1;
      let i = re.lastIndex;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') depth -= 1;
        if (depth > 0) i += 1;
      }
      const value = normalize(src.slice(re.lastIndex, i));
      if (!out.has(token)) out.set(token, new Map());
      const seen = out.get(token);
      if (!seen.has(value)) seen.set(value, path.relative(ROOT, file));
    }
  });
  return out;
}

/* `white` and `#ffffff` are the same colour; whitespace and case are noise. */
function normalize(value) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    /* `rgba(16,24,40,0.06)` and `rgba(16, 24, 40, 0.06)` are the same colour;
       only the comma spacing differs between a CSS file and a TS string. */
    .replace(/,\s+/g, ',')
    .replace(/^white$/, '#ffffff');
}

const declared = readDeclaredLightTokens();
const fallbacks = readFallbacks();

test('every token used in code is declared in theme.css', () => {
  assert.ok(Object.keys(declared).length > 20, 'theme.css should declare tokens');
  assert.ok(fallbacks.size > 20, 'blocks should use tokens');
  const undeclared = [...fallbacks.keys()].filter((t) => !(t in declared));
  assert.deepEqual(undeclared, []);
});

test('the code never disagrees with itself about a token default', () => {
  const split = [];
  fallbacks.forEach((values, token) => {
    if (values.size > 1) {
      split.push(`${token}: ${[...values.entries()].map(([v, f]) => `${v} (${f})`).join(' vs ')}`);
    }
  });
  assert.deepEqual(split, []);
});

test('every shipped fallback matches what theme.css declares', () => {
  const drift = [];
  fallbacks.forEach((values, token) => {
    const used = [...values.keys()][0];
    const want = declared[token];
    if (want !== undefined && used !== want) {
      drift.push(`${token}: code=${used} theme.css=${want}`);
    }
  });
  assert.deepEqual(drift, []);
});
