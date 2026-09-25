#!/usr/bin/env node
/**
 * Auto-expire job postings past deadline or older than a year (job-expire.yml).
 *
 * Rewrites the matching files in place (the workflow commits them to a bot
 * branch and opens a pull request). Writes GITHUB_STEP_SUMMARY, GITHUB_OUTPUT
 * (count=N) and, when EXPIRE_REPORT is set, the Markdown list of expired
 * postings to that file for the pull request body.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readYamlScalar } from './yaml-front-matter.mjs';

const DIR = 'content/jobs';
const MAX_AGE_DAYS = 365;
const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');

const expired = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const full = path.join(DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;
  const fm = fmMatch[1];

  if (readYamlScalar(fm, 'status').toLowerCase() !== 'searching') continue;

  const deadline = isoDate(readYamlScalar(fm, 'deadline'));
  const posted = isoDate(readYamlScalar(fm, 'date_posted'));
  const updated = isoDate(readYamlScalar(fm, 'last_updated'));
  const freshest = updated > posted ? updated : posted;

  let reason = '';
  if (deadline && deadline < today) reason = 'deadline ' + deadline + ' passed';
  else if (freshest && freshest < cutoff) reason = 'no update since ' + freshest;
  if (!reason) continue;

  // Case-insensitive like the status check above ("Searching" passed it but
  // never matched here), and keep the line's own ending (a CRLF file must not
  // end up with one LF-only line).
  const next = text.replace(fmMatch[0], () => fmMatch[0].replace(
    /^(status:[ \t]*)(['"]?)searching\2[ \t]*(\r?)$/im, '$1expired$3'));
  if (next === text) {
    console.warn('::warning file=' + full + '::lapsed (' + reason + ') but its status line could not be rewritten');
    continue;
  }
  fs.writeFileSync(full, next);
  expired.push(file + ' (' + reason + ')');
}

const summary = expired.length
  ? '## Expired ' + expired.length + ' posting(s)\n\n' + expired.map((e) => '- ' + e).join('\n') + '\n'
  : 'No postings to expire today.\n';

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.EXPIRE_REPORT) fs.writeFileSync(process.env.EXPIRE_REPORT, summary);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'count=' + expired.length + '\n');
