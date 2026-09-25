#!/usr/bin/env node
/**
 * Announce newly published job postings on social media (Mastodon + Bluesky).
 *
 * Called by .github/workflows/job-announce.yml with the job files that were
 * added by the push that triggered the run:
 *
 *   node .github/scripts/announce-jobs.mjs content/jobs/2026-07-05-title.md ...
 *
 * Environment:
 *   MASTODON_URL           Instance base URL (e.g. https://mastodon.social).
 *   MASTODON_ACCESS_TOKEN  App token with the write:statuses scope.
 *   BLUESKY_IDENTIFIER     Account handle (e.g. opensourcedesign.net).
 *   BLUESKY_APP_PASSWORD   App password (Settings -> App passwords).
 *   BLUESKY_SERVICE        PDS base URL (default https://bsky.social).
 *   SITE_BASE_URL          Default https://opensourcedesign.net
 *   MAX_POSTS              Flood guard per run (default 3).
 *   WAIT_FOR_URL           "1": poll the job page until it's live before
 *                          posting (the Hugo deploy runs in parallel).
 *   DRY_RUN                "1": compose and print, don't post.
 *
 * A platform whose secrets are missing is skipped with a log line, so either
 * network can be enabled independently. Guards against announcing the wrong
 * thing: only `status: searching` postings dated within the last 14 days are
 * announced (protects against bulk imports and file renames). Skips postings
 * with `announce_social: false` (poster opted out on the job form).
 */

import fs from 'node:fs';
import { jobPath } from './job-url.mjs';
import { readYamlScalar } from './yaml-front-matter.mjs';

const SITE = (process.env.SITE_BASE_URL || 'https://opensourcedesign.net').replace(/\/+$/, '');
const MAX_POSTS = parseInt(process.env.MAX_POSTS || '3', 10) || 3;
const FRESH_DAYS = 14;
const BSKY_LIMIT = 300;
const DRY_RUN = process.env.DRY_RUN === '1';
const HASHTAGS = ['OpenSourceDesign', 'jobs'];

// ── Front matter helpers (tolerant of the quoting styles in content/jobs) ──

function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

function jobFromFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = frontMatter(text);
  if (!fm) return null;
  const title = readYamlScalar(fm, 'title');
  if (!title) return null;

  const url = SITE + jobPath(text);

  const comp = readYamlScalar(fm, 'compensation').toLowerCase();
  return {
    file,
    title,
    url,
    status: readYamlScalar(fm, 'status').toLowerCase(),
    datePosted: (readYamlScalar(fm, 'date_posted').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
    organization: readYamlScalar(fm, 'organization'),
    paid: comp === 'paid' ? true : comp && comp !== 'paid' ? false : null,
    deadline: (readYamlScalar(fm, 'deadline').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
    announceSocial: readYamlScalar(fm, 'announce_social').toLowerCase() !== 'false',
  };
}

function eligible(job) {
  if (!job) return 'no front matter/title';
  if (job.status !== 'searching') return `status "${job.status}" (only searching postings are announced)`;
  if (job.announceSocial === false) return 'announce_social: false (poster opted out)';
  if (!job.datePosted) return 'missing date_posted';
  const age = (Date.now() - Date.parse(job.datePosted)) / 86400000;
  if (!(age < FRESH_DAYS)) return `posted ${job.datePosted}, older than ${FRESH_DAYS} days (bulk import guard)`;
  return null;
}

// ── Message composition ─────────────────────────────────────────────────────

function graphemes(s) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;
}

function headline(job, maxTitle) {
  let title = job.title;
  if (graphemes(title) > maxTitle) title = [...title].slice(0, maxTitle - 1).join('').trimEnd() + '…';
  let head = 'New on the Open Source Design job board: ' + title;
  if (job.organization) head += ' - ' + job.organization;
  const extras = [];
  if (job.paid === true) extras.push('paid');
  if (job.paid === false) extras.push('volunteer');
  if (job.deadline) extras.push('apply by ' + job.deadline);
  if (extras.length) head += ' (' + extras.join(', ') + ')';
  return head;
}

function tagsLine() {
  return HASHTAGS.map((t) => '#' + t).join(' ');
}

// Mastodon counts every URL as 23 characters and allows 500, so the full URL
// goes straight into the text.
function composeMastodon(job) {
  return headline(job, 120) + '\n\n' + job.url + '\n\n' + tagsLine();
}

// Bluesky needs rich-text facets (byte ranges) for links and hashtags, and
// counts real graphemes against its 300 limit - so the link gets a short
// display text with the full URL in the facet.
function composeBluesky(job) {
  const display = job.url.replace(/^https?:\/\//, '');
  const shortDisplay = graphemes(display) > 40 ? [...display].slice(0, 39).join('') + '…' : display;

  let maxTitle = 120;
  let text, head;
  do {
    head = headline(job, maxTitle);
    text = head + '\n\n' + shortDisplay + '\n\n' + tagsLine();
    maxTitle -= 10;
  } while (graphemes(text) > BSKY_LIMIT && maxTitle > 20);

  const facets = [];
  const byteLen = (s) => Buffer.byteLength(s, 'utf8');
  const linkStart = byteLen(head + '\n\n');
  facets.push({
    index: { byteStart: linkStart, byteEnd: linkStart + byteLen(shortDisplay) },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: job.url }],
  });
  let cursor = byteLen(head + '\n\n' + shortDisplay + '\n\n');
  for (const tag of HASHTAGS) {
    facets.push({
      index: { byteStart: cursor, byteEnd: cursor + byteLen('#' + tag) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
    cursor += byteLen('#' + tag + ' ');
  }
  return { text, facets };
}

// Bluesky link-preview cards are not inferred from URLs in API posts; attach
// app.bsky.embed.external with OG metadata (and upload og:image as a blob).
function resolveUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function parseOgMeta(html) {
  const pick = (prop) => {
    const re = new RegExp(
      '<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)["\']|' +
        '<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + prop + '["\']',
      'i',
    );
    const m = html.match(re);
    return m ? (m[1] || m[2] || '').trim() : '';
  };
  return {
    title: pick('og:title'),
    description: pick('og:description'),
    image: pick('og:image') || pick('twitter:image'),
  };
}

async function fetchLinkCard(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OpenSourceDesignJobAnnounce/1.0 (+https://opensourcedesign.net)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const og = parseOgMeta(await res.text());
  return {
    uri: url,
    title: og.title,
    description: og.description.slice(0, 300),
    imageUrl: og.image ? resolveUrl(url, og.image) : '',
  };
}

async function uploadImageBlob(service, token, imageUrl) {
  const res = await fetch(imageUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 1_000_000) return null;
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
  if (!mime.startsWith('image/')) return null;
  const out = await expectOk(
    await fetch(service + '/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': mime },
      body: buf,
    }),
    'Bluesky blob upload',
  );
  return out.blob;
}

async function buildBlueskyEmbed(job, service, token) {
  let card;
  try {
    card = await fetchLinkCard(job.url);
  } catch {
    card = { uri: job.url, title: '', description: '', imageUrl: '' };
  }
  const external = {
    uri: job.url,
    title: (card.title || job.title).slice(0, 300),
    description: card.description || '',
  };
  if (token && card.imageUrl) {
    try {
      const thumb = await uploadImageBlob(service, token, card.imageUrl);
      if (thumb) external.thumb = thumb;
    } catch {
      // Card still posts without a thumbnail.
    }
  }
  return { $type: 'app.bsky.embed.external', external };
}

// ── Posting ─────────────────────────────────────────────────────────────────

async function expectOk(res, what) {
  if (!res.ok) throw new Error(what + ' failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function postMastodon(job) {
  const base = (process.env.MASTODON_URL || '').replace(/\/+$/, '');
  const token = process.env.MASTODON_ACCESS_TOKEN || '';
  const status = composeMastodon(job);
  if (DRY_RUN) return 'DRY RUN, would post:\n' + status;
  if (!base || !token) return 'skipped (MASTODON_URL / MASTODON_ACCESS_TOKEN not configured)';
  const out = await expectOk(
    await fetch(base + '/api/v1/statuses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        // Retried runs won't double-post the same job.
        'Idempotency-Key': 'osd-job-' + job.file.replace(/[^a-z0-9.-]/gi, '_'),
      },
      body: JSON.stringify({ status, visibility: 'public', language: 'en' }),
    }),
    'Mastodon post',
  );
  return 'posted ' + (out.url || out.id);
}

async function postBluesky(job) {
  const service = (process.env.BLUESKY_SERVICE || 'https://bsky.social').replace(/\/+$/, '');
  const identifier = process.env.BLUESKY_IDENTIFIER || '';
  const password = process.env.BLUESKY_APP_PASSWORD || '';
  const { text, facets } = composeBluesky(job);
  if (!DRY_RUN && (!identifier || !password)) {
    return 'skipped (BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured)';
  }

  let embed = null;
  let session = null;
  if (!DRY_RUN) {
    session = await expectOk(
      await fetch(service + '/xrpc/com.atproto.server.createSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      }),
      'Bluesky login',
    );
    embed = await buildBlueskyEmbed(job, service, session.accessJwt);
  } else {
    try {
      const preview = await fetchLinkCard(job.url);
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: job.url,
          title: preview.title || job.title,
          description: preview.description,
          thumb: preview.imageUrl || undefined,
        },
      };
    } catch {
      embed = { $type: 'app.bsky.embed.external', external: { uri: job.url, title: job.title, description: '' } };
    }
  }

  if (DRY_RUN) {
    return 'DRY RUN, would post:\n' + text + '\nfacets: ' + JSON.stringify(facets) + '\nembed: ' + JSON.stringify(embed);
  }

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    facets,
    embed,
    langs: ['en'],
    createdAt: new Date().toISOString(),
  };
  const out = await expectOk(
    await fetch(service + '/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.accessJwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    }),
    'Bluesky post',
  );
  return 'posted ' + out.uri + ' (card: ' + (embed.external.title || job.title) + ')';
}

// The Hugo deploy triggered by the same push takes a few minutes; wait for the
// job page to be live so we never announce a dead link (also catches a wrong
// slug computation).
async function waitForUrl(url, minutes = 12) {
  const until = Date.now() + minutes * 60000;
  for (;;) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.ok) return true;
    } catch {
      // network hiccup: fall through to retry
    }
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 30000));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const JOB_FILE_RE = /^content\/jobs\/\d{4}-\d{2}-\d{2}-[a-z0-9._-]+\.md$/;

const files = (process.argv.length > 2
  ? process.argv.slice(2)
  : String(process.env.ANNOUNCE_FILES || '').trim().split(/\s+/)
).filter(Boolean);

if (!files.length) {
  console.log('No job files to announce.');
  process.exit(0);
}

for (const file of files) {
  if (!JOB_FILE_RE.test(file)) {
    console.error('Invalid job file path: ' + file);
    process.exit(1);
  }
}

let failures = 0;
let posted = 0;
for (const file of files) {
  console.log('\n=== ' + file + ' ===');
  if (!fs.existsSync(file)) {
    console.log('skip: file does not exist');
    continue;
  }
  const job = jobFromFile(file);
  const reason = eligible(job);
  if (reason) {
    console.log('skip: ' + reason);
    continue;
  }
  if (posted >= MAX_POSTS) {
    console.log('skip: MAX_POSTS=' + MAX_POSTS + ' reached (flood guard) - announce manually via workflow_dispatch');
    continue;
  }
  if (process.env.WAIT_FOR_URL === '1' && !DRY_RUN) {
    console.log('waiting for ' + job.url + ' to come online…');
    if (!(await waitForUrl(job.url))) {
      console.error('ERROR: ' + job.url + ' never came online; not announcing.');
      failures++;
      continue;
    }
  }
  posted++;
  console.log('announcing: ' + job.title + ' → ' + job.url);
  for (const [name, fn] of [['Mastodon', postMastodon], ['Bluesky', postBluesky]]) {
    try {
      console.log(name + ': ' + (await fn(job)));
    } catch (err) {
      console.error(name + ': ERROR: ' + err.message);
      failures++;
    }
  }
}

process.exit(failures ? 1 : 0);
