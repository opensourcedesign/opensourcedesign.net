/**
 * Live URLs of job and event pages, computed the way Hugo does.
 *
 * Every CI script that links to a published posting (announcements, approval
 * and reminder emails, submission preview comments) uses these helpers so
 * they agree with each other and with the site.
 *
 * Job permalinks are /jobs/:slug/ (hugo.toml). An explicit `url:` wins, then
 * `slug:`; otherwise Hugo urlizes the title. (`permalink:` is a Jekyll
 * leftover that Hugo ignores, so it is ignored here too.) The submission
 * Worker writes `slug:` into every new posting, so the title fallback only
 * matters for hand-written files - `hugoSlug` ports Hugo 0.166's urlize
 * closely enough to match every title in content/jobs (see job-url.test.mjs),
 * but an explicit slug is always exact.
 */

import { readYamlScalar } from './yaml-front-matter.mjs';

const BACKSLASH = String.fromCharCode(92);
const ALLOWED_PUNCTUATION = './_#+~-@' + BACKSLASH;

function isAllowedPathChar(s, i, c) {
  if (c === ' ') return false;
  if (/[\p{L}\p{Nd}\p{M}]/u.test(c)) return true;
  if (ALLOWED_PUNCTUATION.includes(c)) return true;
  return c === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3));
}

// Port of Hugo's common/paths.Sanitize: keep letters, digits, marks and a few
// punctuation characters, turn runs of whitespace into a single hyphen (never
// doubling an explicit one) and drop everything else.
function sanitize(s) {
  let out = '';
  let prependHyphen = false;
  let wasHyphen = false;
  let i = 0;
  for (const c of s) {
    if (isAllowedPathChar(s, i, c)) {
      wasHyphen = c === '-';
      if (prependHyphen) {
        if (!wasHyphen) out += '-';
        prependHyphen = false;
      }
      out += c;
    } else if (out.length > 0 && !wasHyphen && /\s/u.test(c)) {
      prependHyphen = true;
    }
    i += c.length;
  }
  return out;
}

/**
 * The path segment Hugo 0.166 derives from a title for :slug. Beyond plain
 * sanitizing, Hugo turns '/' into '-' and treats '+' as a separator, which is
 * why "Home page + web site" becomes "home-page--web-site".
 */
export function hugoSlug(title) {
  let s = String(title || '').replace(/\//g, '-');
  s = sanitize(s).toLowerCase();
  s = s.replace(/^\++-?(?=.)/, '-');
  return sanitize(s.replace(/\+/g, ' '));
}

function frontMatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

// readYamlScalar plus YAML's trailing comments on plain (unquoted) scalars,
// which a few imported Jekyll files use ("title: Foo # three words max").
function scalar(fm, key) {
  const m = String(fm).match(new RegExp('^' + key + ':[ \t]*(.*)$', 'm'));
  if (!m) return '';
  if (/^["'>|]/.test(m[1])) return readYamlScalar(fm, key);
  return m[1].replace(/\s+#.*$/, '').trim();
}

function explicitPath(fm) {
  const explicit = scalar(fm, 'url');
  return explicit ? '/' + explicit.replace(/^\/+/, '').replace(/\/*$/, '/') : '';
}

/** Site-relative path (e.g. /jobs/ux-designer/) of a job file's text. */
export function jobPath(text) {
  const fm = frontMatter(text);
  const explicit = explicitPath(fm);
  if (explicit) return explicit;
  const slug = hugoSlug(scalar(fm, 'slug') || scalar(fm, 'title'));
  return slug ? '/jobs/' + slug + '/' : '';
}

/** Site-relative path of an event file (Hugo uses the file name by default). */
export function eventPath(file, text) {
  const fm = frontMatter(text);
  const explicit = explicitPath(fm);
  if (explicit) return explicit;
  const slug = scalar(fm, 'slug') || String(file).split('/').pop().replace(/\.md$/, '');
  const segment = hugoSlug(slug);
  return segment ? '/events/' + segment + '/' : '';
}
