#!/usr/bin/env node
/**
 * Wait until the live site serves a build made after a given time (and,
 * optionally, until a page is reachable), so "your posting is live" emails
 * go out only once the posting really is live.
 *
 * Every production build writes /jobs/index.json with a `generated`
 * timestamp; a value at or after SINCE (the PR's merge time) means GitHub
 * Pages is serving a build that includes the merge. Requests carry a cache-
 * busting query string because Pages' CDN caches for several minutes.
 *
 * Env:
 *   SINCE            ISO timestamp the build must be newer than (required).
 *   URL              Page that must answer 2xx as well (optional).
 *   SITE             Default https://opensourcedesign.net
 *   TIMEOUT_MINUTES  Default 20.
 *
 * Exits 1 when the deploy doesn't show up in time (e.g. the build failed), so
 * the email step is skipped and the run can be re-run once the site is fixed.
 */

const SITE = (process.env.SITE || 'https://opensourcedesign.net').replace(/\/+$/, '');

/** True when the index was generated at or after `since`. */
export function isDeployedAfter(index, since) {
  const generated = Date.parse(index && index.generated);
  const mergedAt = Date.parse(since);
  return Number.isFinite(generated) && Number.isFinite(mergedAt) && generated >= mergedAt;
}

function bust(url) {
  const u = new URL(url);
  u.hash = '';
  u.searchParams.set('deploy-check', String(Date.now()));
  return u.href;
}

async function check(since, url) {
  const res = await fetch(bust(SITE + '/jobs/index.json'), { headers: { accept: 'application/json' } });
  if (!res.ok) return 'job index HTTP ' + res.status;
  const index = await res.json();
  if (!isDeployedAfter(index, since)) return 'live build generated ' + index.generated + ', before ' + since;
  if (url) {
    const page = await fetch(bust(url), { redirect: 'follow' });
    if (!page.ok) return url + ' HTTP ' + page.status;
  }
  return '';
}

async function main() {
  const since = process.env.SINCE;
  if (!since || !Number.isFinite(Date.parse(since))) {
    console.error('SINCE must be an ISO timestamp');
    process.exit(1);
  }
  const url = process.env.URL || '';
  const until = Date.now() + (parseFloat(process.env.TIMEOUT_MINUTES || '20') || 20) * 60000;
  let last = '';
  for (;;) {
    try {
      last = await check(since, url);
    } catch (err) {
      last = err.message || String(err);
    }
    if (!last) {
      console.log('Site deployed after ' + since + (url ? ' and ' + url + ' is live' : '') + '.');
      return;
    }
    if (Date.now() > until) {
      console.error('Gave up waiting for the deploy: ' + last);
      process.exit(1);
    }
    console.log('Waiting: ' + last);
    await new Promise((r) => setTimeout(r, 30000));
  }
}

// Run only when executed directly (the test imports isDeployedAfter).
if (process.argv[1] && process.argv[1].endsWith('wait-for-deploy.mjs')) {
  await main();
}
