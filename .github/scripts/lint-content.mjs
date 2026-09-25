#!/usr/bin/env node
/**
 * Content lint for job, event, and resource Markdown (run by content-lint.yml on PRs).
 *
 *   node .github/scripts/lint-content.mjs content/jobs/2026-07-05-title.md ...
 *
 * Validates front matter (required fields, status enums, ISO dates) and
 * catches Markdown pitfalls that break rendered pages. Errors fail the check;
 * warnings are advisory.
 */

import fs from 'node:fs';
import { isBadJobFilename } from './job-filename-rules.mjs';
import { hasYamlKey, readYamlScalar } from './yaml-front-matter.mjs';

const JOB_STATUSES = ['searching', 'filled', 'closed', 'expired'];
const JOB_STATUS_ALIASES = { solved: 'filled', resolved: 'filled', completed: 'filled', filled: 'filled' };
const EVENT_STATUSES = ['upcoming', 'started', 'past', 'cancelled'];

// Section/utility pages that live in content folders but aren't linted as postings.
const NOT_POSTINGS = new Set([
  '_index.md',
  'archive.md',
  'how-to-post.md',
  'writing-job-posts.md', // the posting guide (content/jobs/writing-job-posts.md)
  'job-form.md',
  'event-form.md',
  'suggest.md',
  'links.md',
  'bibliography.md',
  'tools-and-code.md',
]);

function contentKind(file) {
  const p = file.replace(/\\/g, '/');
  if (p.includes('content/jobs/')) return 'job';
  if (p.includes('content/events/')) return 'event';
  if (p.includes('content/resources/')) return 'resource';
  return 'other';
}

const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s.slice(0, 10)));

function lintBody(body, errors, warnings) {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let prevNonEmpty = '';
  const isListItem = (l) => /^\s*([-*+]|\d+[.)])\s/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      prevNonEmpty = line;
      continue;
    }
    if (inFence) continue;

    if (/^ {4,}\S/.test(line) && !isListItem(line)) {
      const prevOk = isListItem(prevNonEmpty) || /^ {2,}\S/.test(prevNonEmpty);
      if (!prevOk) {
        errors.push(`line ${n}: text indented ${line.match(/^ +/)[0].length} spaces renders as a code block - remove the indentation or use a \`- \` list`);
      }
    }
    if (/^#{1,6}[^#\s]/.test(line)) {
      errors.push(`line ${n}: \`${line.slice(0, 20)}…\` - headings need a space after the # marks`);
    }
    if (/^\s*[•·▪]\s/.test(line)) {
      errors.push(`line ${n}: \`•\` pseudo-bullet - use a Markdown \`- \` list marker instead`);
    }
    const rawTags = [...line.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g)].map((m) => m[1].toLowerCase());
    for (const tag of rawTags) {
      if (['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base'].includes(tag)) {
        errors.push(`line ${n}: raw \`<${tag}>\` HTML is not allowed in postings`);
      } else {
        warnings.push(`line ${n}: raw \`<${tag}>\` HTML - prefer plain Markdown`);
      }
    }
    if (/on[a-z]+\s*=|javascript:/i.test(line) && rawTags.length) {
      errors.push(`line ${n}: inline event handler or javascript: URL in raw HTML`);
    }
    if (line.trim()) prevNonEmpty = line;
  }
}

function lintFile(file) {
  const errors = [];
  const warnings = [];
  const text = fs.readFileSync(file, 'utf8');
  const kind = contentKind(file);
  const isJob = kind === 'job';
  const isEvent = kind === 'event';
  const isResource = kind === 'resource';

  // A lone \r (or U+2028/U+2029) is a line break to YAML but invisible in a
  // diff: inside a `|-` block it can end the block and inject front matter
  // keys (aliases, url, …). The submission Worker strips these; flag any that
  // slip through a manual edit.
  // eslint-disable-next-line no-control-regex
  const stray = text.match(/\r(?!\n)|[\u2028\u2029\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  if (stray) {
    const line = text.slice(0, stray.index).split('\n').length;
    errors.push(`line ${line}: stray control character U+${stray[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (a lone carriage return or similar) - remove it; it can break out of the front matter`);
  }

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    errors.push('missing or unterminated front matter block (`---` fences)');
    return { errors, warnings };
  }
  const fm = fmMatch[1];
  const body = text.slice(fmMatch[0].length);

  if (!readYamlScalar(fm, 'title')) errors.push('front matter: `title` is required');

  if (isJob) {
    const base = file.replace(/\\/g, '/').split('/').pop();
    if (isBadJobFilename(base)) {
      errors.push(`filename "${base}" is non-canonical (use lowercase date-slug.md — see normalize-jobs.mjs)`);
    }
  }

  if (isJob || isEvent) {
    const status = (readYamlScalar(fm, 'status') || '').toLowerCase();
    const statuses = isJob ? JOB_STATUSES : EVENT_STATUSES;
    if (!status) {
      errors.push('front matter: `status` is required');
    } else if (isJob && JOB_STATUS_ALIASES[status] && !statuses.includes(status)) {
      warnings.push(`front matter: status "${status}" is legacy - use "${JOB_STATUS_ALIASES[status]}"`);
    } else if (!statuses.includes(status) && !(isJob && JOB_STATUS_ALIASES[status])) {
      errors.push(`front matter: status "${status}" is not one of: ${statuses.join(', ')}`);
    }

    for (const key of isJob ? ['date_posted', 'last_updated', 'deadline'] : []) {
      const v = readYamlScalar(fm, key);
      if (v && !isIsoDate(v)) {
        errors.push(`front matter: \`${key}: ${v}\` is not a valid YYYY-MM-DD date`);
      }
    }
    if (isJob && !hasYamlKey(fm, 'date_posted')) {
      errors.push('front matter: `date_posted` is required for jobs');
    }
    // Pinning the URL keeps it stable across title edits and Hugo upgrades,
    // and lets CI scripts link to the page without re-deriving Hugo's slug.
    if (isJob && !hasYamlKey(fm, 'slug') && !hasYamlKey(fm, 'url')) {
      errors.push('front matter: `slug` is required for jobs (the URL segment, e.g. `slug: "ux-designer"` for /jobs/ux-designer/) - check the URL is not already taken');
    }
    if (isJob && !hasYamlKey(fm, 'compensation')) {
      warnings.push('front matter: no `compensation` (paid/gratis) - the posting will show "Unspecified"');
    }
    if (isJob && !/^how_to_apply:/m.test(fm)) {
      warnings.push('front matter: no `how_to_apply` - the page will fall back to "see the description"');
    }
  }

  const keys = [...fm.matchAll(/^([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
  for (const dup of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) {
    errors.push(`front matter: duplicate key \`${dup}\``);
  }

  lintBody(body, errors, warnings);

  // Hugo runs shortcodes in page content; postings come from public forms,
  // so a shortcode there would embed unreviewed content or break the build.
  if ((isJob || isEvent) && /\{\{\s*[<%]/.test(body)) {
    errors.push('Hugo shortcode syntax (`{{<` / `{{%`) is not allowed in postings - write `{&#123;<` to show it literally');
  }

  return { errors, warnings };
}

const files = process.argv.slice(2).filter((f) => {
  if (!fs.existsSync(f)) return false;
  const base = f.replace(/\\/g, '/').split('/').pop();
  return !NOT_POSTINGS.has(base);
});
if (!files.length) {
  console.log('No content files to lint.');
  process.exit(0);
}

let failed = false;
const summary = ['| File | Result |', '| ---- | ------ |'];
for (const file of files) {
  const { errors, warnings } = lintFile(file);
  console.log('\n=== ' + file + ' ===');
  errors.forEach((e) => console.log('  ERROR: ' + e));
  warnings.forEach((w) => console.log('  warn:  ' + w));
  if (!errors.length && !warnings.length) console.log('  ok');
  if (errors.length) failed = true;
  summary.push(
    '| `' + file + '` | ' +
    (errors.length ? '❌ ' + errors.length + ' error(s)' : warnings.length ? '⚠️ ' + warnings.length + ' warning(s)' : '✅ ok') +
    ' |',
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Content lint\n\n' + summary.join('\n') + '\n');
}
process.exit(failed ? 1 : 0);
