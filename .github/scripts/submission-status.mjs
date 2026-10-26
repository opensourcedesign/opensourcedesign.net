#!/usr/bin/env node
/**
 * Create or update the status comment on a form submission PR (branches
 * job/, job-edit/, event/, event-edit/, resource/ opened by the Worker).
 * Run by submission-status.yml whenever the PR changes or one of its checks
 * finishes; it replaces the separate "submission preview" and "PR site
 * preview" bot comments with one comment written for the submitter first.
 *
 * Stateless: every run rebuilds the comment from the PR and its current
 * check runs, so runs can safely cancel each other. It only reads the
 * submitted files as data (lints them with this checkout's lint script);
 * it never executes code from the pull request.
 *
 * Env: GITHUB_TOKEN, REPO (owner/name), PR_NUMBER,
 *      SITE (default https://opensourcedesign.net),
 *      PREVIEW_WAIT_SECONDS (default 240) - how long to wait for a freshly
 *      deployed preview to be served by GitHub Pages,
 *      DRY_RUN=1 - print the comment instead of posting it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gh, ghPaginated } from './github-api.mjs';
import { eventPath, jobPath } from './job-url.mjs';
import { submissionMeta } from './submission-meta.mjs';
import { LEGACY_MARKERS, MARKER, latestRuns, previewState, renderStatus } from './submission-status-render.mjs';
import { readYamlScalar } from './yaml-front-matter.mjs';

const SITE = (process.env.SITE || 'https://opensourcedesign.net').replace(/\/+$/, '');
const { REPO, PR_NUMBER } = process.env;
const PREVIEW_WAIT_SECONDS = parseInt(process.env.PREVIEW_WAIT_SECONDS || '240', 10);
const SUBMISSION_REF = /^(job|job-edit|event|event-edit|resource)\//;

const FORM_URLS = { job: '/jobs/job-form/', event: '/events/event-form/', resource: '/resources/suggest/' };

function formUrl(ref) {
  const kind = ref.startsWith('event') ? 'event' : ref.startsWith('resource') ? 'resource' : 'job';
  return SITE + FORM_URLS[kind];
}

async function fileAt(file, sha) {
  const data = await gh(`/repos/${REPO}/contents/${encodeURIComponent(file).replace(/%2F/g, '/')}?ref=${sha}`);
  return Buffer.from(data.content, 'base64').toString('utf8');
}

function frontMatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

// Moderator-facing summary of one submitted file.
function summarize(file, text) {
  if (file === 'data/resources.yaml') {
    return { title: 'Resource suggestion', rows: [], file, path: '/resources/links/' };
  }
  const fm = frontMatter(text);
  const rows = [];
  for (const [label, key] of [['Organization', 'organization'], ['Role', 'role'], ['Status', 'status'],
    ['Apply by', 'deadline'], ['Dates', 'eventDate'], ['Location', 'location']]) {
    const v = readYamlScalar(fm, key);
    if (v) rows.push([label, v]);
  }
  const p = file.startsWith('content/events/') ? eventPath(file, text) : jobPath(text);
  return { title: readYamlScalar(fm, 'title') || file.split('/').pop(), rows, file, path: p || '/' };
}

async function checkRuns(sha) {
  const runs = [];
  for (let page = 1; page < 10; page++) {
    const data = await gh(`/repos/${REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    runs.push(...(data.check_runs || []));
    if (!data.check_runs || data.check_runs.length < 100) break;
  }
  return runs;
}

// Run this checkout's content lint on the submitted files and return its
// ERROR lines (the check's pass/fail comes from the check run itself).
function lintErrors(texts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'submission-lint-'));
  const files = [];
  for (const [file, text] of texts) {
    if (!file.endsWith('.md')) continue;
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    files.push(dest);
  }
  if (!files.length) return [];
  let out = '';
  try {
    out = execFileSync(process.execPath, ['.github/scripts/lint-content.mjs', ...files], { encoding: 'utf8' });
  } catch (err) {
    out = String(err.stdout || '');
  }
  const errors = [];
  let current = '';
  for (const line of out.split('\n')) {
    const head = line.match(/^=== (.+) ===$/);
    if (head) current = head[1].split(/[\\/]/).pop();
    const e = line.match(/^\s*ERROR: (.+)$/);
    if (e) errors.push((files.length > 1 ? `\`${current}\`: ` : '') + e[1]);
  }
  return errors;
}

async function waitForPreview(url) {
  const until = Date.now() + PREVIEW_WAIT_SECONDS * 1000;
  for (;;) {
    try {
      const res = await fetch(url + '?status-check=' + Date.now(), { method: 'HEAD', redirect: 'follow' });
      if (res.ok) return true;
    } catch {
      // not reachable yet
    }
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 15000));
  }
}

async function upsert(body) {
  const comments = await ghPaginated(`/repos/${REPO}/issues/${PR_NUMBER}/comments`);
  const mine = comments.filter((c) => c.user?.type === 'Bot' && [MARKER, ...LEGACY_MARKERS].some((m) => c.body?.includes(m)));
  const existing = mine.find((c) => c.body.includes(MARKER)) || mine[0];
  if (existing) {
    if (existing.body === body) {
      console.log('Status comment already up to date.');
      return;
    }
    await gh(`/repos/${REPO}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    console.log('Updated status comment ' + existing.id);
  } else {
    await gh(`/repos/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    console.log('Posted status comment.');
  }
}

async function main() {
  if (!REPO || !PR_NUMBER) {
    console.log('REPO / PR_NUMBER not set; nothing to do.');
    return;
  }
  const pr = await gh(`/repos/${REPO}/pulls/${PR_NUMBER}`);
  const ref = pr.head?.ref || '';
  if (!SUBMISSION_REF.test(ref) || pr.head?.repo?.full_name !== REPO) {
    console.log(`PR #${PR_NUMBER} (${ref}) is not a form submission; skipping.`);
    return;
  }
  const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
  const sha = pr.head.sha;

  const prFiles = await ghPaginated(`/repos/${REPO}/pulls/${PR_NUMBER}/files`);
  const targets = prFiles.map((f) => f.filename).filter((f) =>
    (/^content\/(jobs|events)\/[^/]+\.md$/.test(f)) || f === 'data/resources.yaml');
  const texts = [];
  for (const f of targets) texts.push([f, await fileAt(f, sha)]);
  const items = texts.map(([f, t]) => {
    const s = summarize(f, t);
    return { ...s, liveUrl: SITE + s.path, previewUrl: `${SITE}/pr-preview/pr-${PR_NUMBER}${s.path}` };
  });

  const runs = latestRuns(await checkRuns(sha));
  const preview = { state: previewState(runs, state) };
  if (preview.state === 'deployed') {
    const url = items[0]?.previewUrl || `${SITE}/pr-preview/pr-${PR_NUMBER}/`;
    preview.state = (await waitForPreview(url)) ? 'ready' : 'publishing';
    preview.url = url;
  }

  const lint = runs.lint;
  const errors = state === 'open' && lint?.status === 'completed' && lint.conclusion === 'failure' ? lintErrors(texts) : [];

  const body = renderStatus({
    meta: submissionMeta(ref),
    state,
    preview,
    checks: runs,
    lintErrors: errors,
    items,
    formUrl: formUrl(ref),
  });
  if (process.env.DRY_RUN === '1') {
    console.log(body);
    return;
  }
  await upsert(body);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
