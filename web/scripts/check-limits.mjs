// ARCHITECTURE.md section 2.2 rule 1: 400 lines hard cap per source file, and
// rule 4: src/ui imports zero three.js. Both are structural, so they are checked
// mechanically rather than by review. Exit 1 on any violation.
//
// THE CAP'S MEASURE IS CODE LINES, NOT RAW LINES (BT-305, Reid's delegation off
// CE-145's `Loop.ts` finding: 518 raw lines of which 334 are load-bearing clock-
// derivation comments and 155 are code). A line counts toward the 400 cap only
// if it has non-comment, non-blank content once line comments (`//...`) and
// block comments (`/* ... */`) are stripped. Every other line -- blank,
// whitespace-only, or entirely comment -- does not count. THIS IS NOT `wc -l`:
// a reader diffing this gate's number against `wc -l` on the same file will see
// a SMALLER number here, and that is the point, not a bug -- stated here so a
// future reader is not confused by the mismatch.
//
// THE HAZARD THE CLASSIFIER HAS TO GET RIGHT. A string or a template literal can
// CONTAIN the text `//` without it being a comment -- a URL in a string, or the
// GLSL/JSX source text a template literal ships verbatim (`TerrainArt.glsl.ts`
// carries shader source this way). A classifier that regexes for `//` with no
// idea it is inside a string or a template literal misclassifies the rest of
// that line as a comment and UNDERCOUNTS. So this is a real scanner, not a
// regex: it tracks line comments, block comments, single/double-quoted strings
// and backtick template literals (including `${...}` holes, which can nest a
// string, a further template literal, or a comment of their own) as distinct
// spans, and strips ONLY the comment spans. A string's or a template literal's
// content -- including any `//` inside it, and including the GLSL/JSX text a
// template literal ships -- counts as CODE, because it executes or ships.
// `--selftest` proves this against the tricky fixtures below, including the
// exact "GLSL comment inside a template literal" and "brace inside a string
// inside a `${}` hole" shapes a naive regex gets wrong.
//
// NO PER-FILE EXEMPTIONS. The classifier is uniform across every .ts/.tsx/.glsl
// file. A file that resists the cap for a structural reason (BT-275's class-
// shaped resisters, CE-145's clock-derivation resister) is measured the same
// way as everything else; it may still be red under this measure, and that is
// an honest reading rather than a loophole.
//
//   node scripts/check-limits.mjs            check the repo (and self-test)
//   node scripts/check-limits.mjs --selftest only the self-test

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const CAP = 400;

// ---------------------------------------------------------------------------
// The classifier. One pure function per concern, so the self-test exercises
// the SAME code the real check runs and not a paraphrase of it.
// ---------------------------------------------------------------------------

/**
 * Scan a `${...}` hole (the caller has already consumed the opening `${`),
 * returning the index just past its matching `}`. A hole is code, so its own
 * nested comments/strings/templates only matter for finding where it ENDS --
 * a `{`/`}` inside a string or a nested template must not move `depth`, and a
 * `//`/`/*` inside a hole is a real JS comment that must not be mistaken for
 * the end of anything either. This is the recursive part: a hole can contain
 * another template literal, which can contain another hole.
 */
function skipHole(src, i) {
  let depth = 1;
  let j = i;
  const n = src.length;
  while (j < n && depth > 0) {
    const c = src[j];
    if (c === '{') { depth += 1; j += 1; }
    else if (c === '}') { depth -= 1; j += 1; }
    else if (c === '"' || c === "'") { j = skipStringLiteral(src, j, c); }
    else if (c === '`') { j = skipTemplateLiteral(src, j); }
    else if (c === '/' && src[j + 1] === '/') {
      while (j < n && src[j] !== '\n') j += 1;
    } else if (c === '/' && src[j + 1] === '*') {
      const close = src.indexOf('*/', j + 2);
      j = close < 0 ? n : close + 2;
    } else {
      j += 1;
    }
  }
  return j;
}

/** Index just past the closing quote of a '...' or "..." literal at `i`. */
function skipStringLiteral(src, i, quote) {
  const n = src.length;
  let j = i + 1;
  while (j < n && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, n);
}

/**
 * Index just past the closing backtick of a template literal at `i`, walking
 * through any `${...}` holes via `skipHole` rather than a plain backtick scan,
 * so a hole containing a string/nested-template with its own backtick or brace
 * cannot be mistaken for the literal's own close.
 */
function skipTemplateLiteral(src, i) {
  const n = src.length;
  let j = i + 1;
  while (j < n) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && src[j + 1] === '{') { j = skipHole(src, j + 2); continue; }
    j += 1;
  }
  return n;
}

/**
 * Strip line comments and block comments from `src`, leaving strings and
 * template literals (including everything inside their `${...}` holes)
 * untouched, and every non-comment newline in place so line numbers survive.
 * The stripped text is never re-parsed as JavaScript -- it is only counted,
 * per line, for whether anything non-whitespace is left.
 */
function stripComments(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;               // drop to end of line
    } else if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? n : close + 2;
      for (let k = i; k < stop; k += 1) out += src[k] === '\n' ? '\n' : '';
      i = stop;
    } else if (c === '"' || c === "'") {
      const stop = skipStringLiteral(src, i, c);
      out += src.slice(i, stop);                              // code, unmodified
      i = stop;
    } else if (c === '`') {
      const stop = skipTemplateLiteral(src, i);
      out += src.slice(i, stop);                               // code, unmodified
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * @param {string} src
 * @returns {{codeLines: number, total: number}} `total` is the raw `\n`-split
 * line count (what `wc -l`-style tooling reports), for the side-by-side proof.
 */
export function countLines(src) {
  const stripped = stripComments(src);
  const lines = stripped.split('\n');
  let codeLines = 0;
  for (const l of lines) if (l.trim() !== '') codeLines += 1;
  return { codeLines, total: src.split('\n').length };
}

// ---------------------------------------------------------------------------
// The refusing case, proven in the same invocation that proves the passing one.
// ---------------------------------------------------------------------------

const FIXTURES = [
  ['plain code, no comments', 'const a = 1;\nconst b = 2;\n', 2],
  ['line-comment-only lines do not count', '// a comment\nconst a = 1;\n// another\n', 1],
  ['a block comment spanning several lines does not count',
    '/*\n * multi\n * line\n */\nconst a = 1;\n', 1],
  ['code plus a trailing line comment still counts as code',
    'const a = 1; // inline note\n', 1],
  ['blank and whitespace-only lines do not count',
    'const a = 1;\n\n   \nconst b = 2;\n', 2],
  // The named hazard: a URL string containing `//` must not be read as the
  // start of a comment eating the rest of the line.
  ['a string containing // is code, not a comment',
    'const u = "http://example.com/a//b";\nconst v = 2;\n', 2],
  // The named hazard, the multi-line form: a template literal shipping GLSL
  // source whose OWN `//` is GLSL comment text, not JS comment text. The whole
  // literal is code because it ships/executes; a naive regex would strip the
  // "real GLSL comment" line to blank and undercount by one.
  ['GLSL comment text inside a template literal counts as code, not as a JS comment',
    'const shader = `\n'
      + '  // real GLSL comment, part of the shipped string\n'
      + '  void main() {\n'
      + '    gl_FragColor = vec4(1.0);\n'
      + '  }\n'
      + '`;\n'
      + 'const after = 5;\n', 7],
  // A `${}` hole containing a string that itself contains an unbalanced brace.
  // A depth counter that does not skip strings inside a hole would count the
  // string's `{` as raising hole depth, then run past the literal's real close
  // looking for one more `}`, swallowing the real comment after it.
  ['a brace inside a string inside a hole does not desync the template scan',
    'const x = `total: ${"{"} widgets`;\n'
      + '// a real comment that must be stripped\n'
      + 'const y = 2;\n', 2],
  // A hole nesting a further template literal, to prove the recursion this
  // classifier needs even though the content either way is code.
  ['a hole nesting another template literal does not desync the scan',
    'const x = `outer ${`inner ${1}`} end`;\n'
      + 'const y = 2;\n', 2],
];

function selftest() {
  const lines = [];
  let bad = 0;
  for (const [name, src, want] of FIXTURES) {
    let got;
    let err = null;
    try {
      got = countLines(src).codeLines;
    } catch (e) {
      err = e.message;
    }
    const ok = err === null && got === want;
    if (!ok) bad += 1;
    lines.push(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ` + (err !== null
      ? `threw ${err}`
      : `${got} code line(s), wanted ${want}`));
  }
  return { bad, lines, count: FIXTURES.length };
}

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|glsl)$/.test(e)) out.push(p);
  }
  return out;
}

const argv = new Set(process.argv.slice(2));

const st = selftest();
console.log(`check-limits: self-test, ${st.count} fixtures (the tricky ones: a `
  + `URL string and a GLSL comment inside a template literal, both containing `
  + `//; a brace inside a string inside a \${} hole; a nested template literal)`);
for (const l of st.lines) console.log(l);
if (st.bad > 0) {
  console.error(`check-limits: SELF-TEST FAILED on ${st.bad} fixture(s). The `
    + `classifier cannot be trusted, so its verdict on the repo is meaningless.`);
  process.exit(2);
}
if (argv.has('--selftest')) {
  console.log('check-limits: self-test only, PASS');
  process.exit(0);
}

const violations = [];
const files = walk(srcRoot);
for (const file of files) {
  const rel = relative(root, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const { codeLines } = countLines(text);
  if (codeLines > CAP) violations.push(`${rel}: ${codeLines} code lines > ${CAP} cap`);
  if (rel.startsWith('src/ui/') && /from\s+['"]three/.test(text)) {
    violations.push(`${rel}: src/ui must import zero three.js`);
  }
}

if (violations.length) {
  console.error(`check-limits FAIL (the cap is measured in CODE LINES -- `
    + `non-blank, non-comment -- not raw \`wc -l\` lines):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`check-limits OK (${files.length} files, all <= ${CAP} code lines)`);
