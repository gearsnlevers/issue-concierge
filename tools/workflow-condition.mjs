// A small evaluator for the GitHub Actions expressions the workflow conditions (`if:`) use, so a test can say what a
// condition DOES for an event instead of matching its text. Not part of a release: it is test support.
//
// Supported: string, number, true, false and null literals; property paths with `.*` (an object filter over an
// array, as in `github.event.issue.labels.*.name`); `!`, `==`, `!=`, `&&`, `||`, parentheses; and the functions
// contains(), startsWith(), endsWith() and fromJSON(), and cancelled() (false unless the context sets `cancelled`). Anything else throws, so a condition that grows a feature
// this file does not know fails loudly instead of being evaluated wrongly.
//
// The semantics follow GitHub's: a missing property is null, strings compare without regard to case, null equals
// an empty string and zero, `&&` and `||` return an operand, and a context that is absent (a `workflow_dispatch`
// has no `github.event.issue`) reads as null all the way down.
import fs from 'node:fs';

const TOKEN = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(&&|\|\||==|!=|!|\(|\)|,)|([A-Za-z_][\w-]*(?:\.(?:\*|[A-Za-z_][\w-]*))*))/y;

function tokenize(source) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(source);
    if (!m) throw new Error(`cannot read the expression at: ${source.slice(TOKEN.lastIndex, TOKEN.lastIndex + 40)}`);
    if (m[1] !== undefined) tokens.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2] !== undefined) tokens.push({ t: 'num', v: Number(m[2]) });
    else if (m[3] !== undefined) tokens.push({ t: 'op', v: m[3] });
    else tokens.push({ t: 'id', v: m[4] });
  }
  return tokens;
}

const truthy = (v) => !(v === null || v === undefined || v === '' || v === 0 || v === false || Number.isNaN(v));

function looseEquals(a, b) {
  const nullish = (v) => v === null || v === undefined;
  if (nullish(a) && nullish(b)) return true;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  const num = (v) => (nullish(v) ? 0 : typeof v === 'string' ? (v.trim() === '' ? 0 : Number(v)) : Number(v));
  if (['string', 'number', 'boolean'].includes(typeof a) || nullish(a)) {
    if (['string', 'number', 'boolean'].includes(typeof b) || nullish(b)) return num(a) === num(b);
  }
  return a === b;
}

function readPath(path, context) {
  const segments = path.split('.');
  let current = [context];
  let filtered = false;
  for (const segment of segments) {
    const next = [];
    for (const value of current) {
      if (value === null || value === undefined) continue;
      if (segment === '*') {
        filtered = true;
        for (const item of Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value) : []) next.push(item);
      } else if (typeof value === 'object' && segment in value) {
        next.push(value[segment]);
      }
    }
    current = next;
  }
  if (filtered) return current.filter((v) => v !== null && v !== undefined);
  return current.length ? current[0] : null;
}

const FUNCTIONS = {
  contains: (search, item) => {
    if (Array.isArray(search)) return search.some((e) => looseEquals(e, item));
    if (typeof search === 'string' || typeof search === 'number') return String(search).toLowerCase().includes(String(item ?? '').toLowerCase());
    return false;
  },
  startsWith: (s, prefix) => typeof s === 'string' && String(s).toLowerCase().startsWith(String(prefix ?? '').toLowerCase()),
  endsWith: (s, suffix) => typeof s === 'string' && String(s).toLowerCase().endsWith(String(suffix ?? '').toLowerCase()),
  fromJSON: (s) => JSON.parse(s),
};

/** Evaluate an expression (with or without its `${{ }}` wrapper) against a context such as `{ github: { event: {...} } }`. */
export function evaluate(expression, context) {
  const source = String(expression).trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const t = tokens[i];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected ${v ?? 'a token'} but found ${t ? t.v : 'the end'}`);
    i += 1;
    return t;
  };
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function or() {
    let left = and();
    while (isOp('||')) {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  function and() {
    let left = eq();
    while (isOp('&&')) {
      take();
      const right = eq();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function eq() {
    let left = unary();
    while (isOp('==') || isOp('!=')) {
      const op = take().v;
      const right = unary();
      left = op === '==' ? looseEquals(left, right) : !looseEquals(left, right);
    }
    return left;
  }
  function unary() {
    if (isOp('!')) {
      take();
      return !truthy(unary());
    }
    return primary();
  }
  function primary() {
    const t = take();
    if (t.t === 'str' || t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = or();
      take(')');
      return v;
    }
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (isOp('(')) {
        take('(');
        const args = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) {
            take();
            args.push(or());
          }
        }
        take(')');
        // cancelled() asks whether the workflow run was cancelled, which no event this evaluates has done: false unless the context says so.
        if (t.v === 'cancelled' && args.length === 0) return Boolean(context.cancelled);
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new Error(`unsupported function ${t.v}`);
        return fn(...args);
      }
      return readPath(t.v, context);
    }
    throw new Error(`unexpected ${t.v}`);
  }

  const value = or();
  if (i !== tokens.length) throw new Error(`unexpected ${tokens[i].v}`);
  return value;
}

/** True when the condition holds, the way GitHub casts the result of an `if:`. */
export function holds(expression, context) {
  return truthy(evaluate(expression, context));
}

/** Join the lines of a YAML scalar that is either on the `if:` line or a folded block (`>-`). */
function scalar(lines, index, indent) {
  const first = lines[index].replace(/^\s*if:\s*/, '');
  if (!/^[>|][-+]?$/.test(first.trim())) return first.trim();
  const parts = [];
  for (let j = index + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    if (line.trim() !== '' && !line.trim().startsWith('#')) parts.push(line.trim());
  }
  return parts.join(' ');
}

/** The top-level `if:` of a gh-aw workflow definition (frontmatter of a `.md` file). */
export function frontmatterIf(markdown) {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (!fm) throw new Error('no frontmatter');
  const lines = fm.split('\n');
  const index = lines.findIndex((l) => /^if:/.test(l));
  if (index < 0) throw new Error('no top-level if:');
  return scalar(lines, index, 0);
}

/** The `if:` of a job of a plain workflow (`.yml`). */
export function jobIf(yaml, job) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start < 0) throw new Error(`no job ${job}`);
  for (let j = start + 1; j < lines.length; j += 1) {
    if (/^ {2}\S/.test(lines[j])) break;
    if (/^ {4}if:/.test(lines[j])) return scalar(lines, j, 4);
  }
  throw new Error(`job ${job} has no if:`);
}

/** The `if:` of the step with this `id` (in the frontmatter of a gh-aw definition). */
export function stepIf(text, id) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `id: ${id}`);
  if (at < 0) throw new Error(`no step ${id}`);
  const indent = lines[at].search(/\S/);
  for (let j = at + 1; j < lines.length; j += 1) {
    if (lines[j].trim() !== '' && lines[j].search(/\S/) < indent) break;
    if (new RegExp(`^ {${indent}}if:`).test(lines[j])) return scalar(lines, j, indent - 1);
  }
  throw new Error(`step ${id} has no if:`);
}

export const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
