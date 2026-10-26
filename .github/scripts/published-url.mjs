/**
 * Resolve the live URL of the content published by a merged submission PR, so
 * the "your submission is live" email links to the actual job/event/resource
 * rather than the generic section list.
 *
 * Reads the PR's changed files via the GitHub API, fetches the merged content
 * file, and derives the permalink the same way Hugo does (job-url.mjs):
 *   - jobs:   /jobs/:slug/ (explicit url > slug > urlized title)
 *   - events: explicit url > slug > the filename
 *   - resources: /resources/links/#<category-id> (category found by locating
 *     the added line in data/resources.yaml)
 *
 * Env: GITHUB_TOKEN, REPO (owner/name), PR_NUMBER, HEAD_REF, MERGE_SHA.
 * Writes `url=<...>` to $GITHUB_OUTPUT; always succeeds - on any error it
 * falls back to the section list URL for the submission kind.
 */

import fs from 'node:fs';
import { gh, ghPaginated } from './github-api.mjs';
import { eventPath, jobPath } from './job-url.mjs';

const SITE = process.env.SITE || 'https://opensourcedesign.net';
const { REPO, PR_NUMBER, HEAD_REF, MERGE_SHA } = process.env;

function fallbackUrl(ref) {
  if (ref.startsWith('event')) return `${SITE}/events/`;
  if (ref.startsWith('resource')) return `${SITE}/resources/links/`;
  return `${SITE}/jobs/`;
}

async function fileAt(path, ref) {
  const data = await gh(`/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${ref}`);
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function jobUrl(file) {
  const path = jobPath(await fileAt(file, MERGE_SHA));
  if (!path) throw new Error(`no slug or title in ${file}`);
  return SITE + path;
}

async function eventUrl(file) {
  return SITE + eventPath(file, await fileAt(file, MERGE_SHA));
}

// The resource PR adds item lines under a category in data/resources.yaml.
// Use the patch hunk to find the new-file line of the added `name:` entry,
// then scan upward in the merged file for the owning category `- id:`.
async function resourceUrl(patch) {
  if (!patch) throw new Error('no patch for resources.yaml');
  let newLine = 0;
  let addedNameLine = 0;
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10) - 1;
      continue;
    }
    if (raw.startsWith('-')) continue;
    newLine++;
    if (raw.startsWith('+') && !addedNameLine && /^\+\s*-?\s*name:/.test(raw)) addedNameLine = newLine;
  }
  if (!addedNameLine) throw new Error('no added name: line found in patch');
  const lines = (await fileAt('data/resources.yaml', MERGE_SHA)).split(/\r?\n/);
  for (let i = Math.min(addedNameLine, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^-\s+id:\s*(\S+)/);
    if (m) return `${SITE}/resources/links/#${m[1].replace(/^["']|["']$/g, '')}`;
  }
  throw new Error('no category id found above the added entry');
}

async function resolve() {
  const files = await ghPaginated(`/repos/${REPO}/pulls/${PR_NUMBER}/files`);
  if (HEAD_REF.startsWith('resource/')) {
    const yaml = files.find((f) => f.filename === 'data/resources.yaml');
    return resourceUrl(yaml && yaml.patch);
  }
  const dir = HEAD_REF.startsWith('event') ? 'content/events/' : 'content/jobs/';
  const md = files.find((f) => f.filename.startsWith(dir) && f.filename.endsWith('.md'));
  if (!md) throw new Error(`no ${dir}*.md file in PR #${PR_NUMBER}`);
  return HEAD_REF.startsWith('event') ? eventUrl(md.filename) : jobUrl(md.filename);
}

let url;
try {
  url = await resolve();
  console.log(`Resolved published URL: ${url}`);
} catch (e) {
  url = fallbackUrl(HEAD_REF || '');
  console.log(`Could not resolve exact URL (${e.message}); falling back to ${url}`);
}
fs.appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
