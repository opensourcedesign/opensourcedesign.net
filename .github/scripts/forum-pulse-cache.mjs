#!/usr/bin/env node
/**
 * Refresh data/forum-pulse.json from Discourse (scheduled every 12 hours).
 * Hugo reads this at build time so production builds never call Discourse;
 * the homepage worker proxy still refreshes in the browser.
 */
import fs from 'node:fs';

const FORUM = (process.env.FORUM_URL || 'https://discourse.opensourcedesign.net').replace(/\/+$/, '');
const OUT = 'data/forum-pulse.json';

async function main() {
  const res = await fetch(FORUM + '/latest.json', {
    headers: { accept: 'application/json' },
    // Don't let a hanging forum stall the deploy that runs this.
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('Discourse HTTP ' + res.status);
  const data = await res.json();
  const topics = (data.topic_list?.topics || [])
    .filter((t) => !t.pinned)
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      posts_count: t.posts_count,
      last_posted_at: t.last_posted_at,
    }));

  const payload = {
    fetched_at: new Date().toISOString(),
    forum_url: FORUM,
    topics,
  };

  const next = JSON.stringify(payload, null, 2) + '\n';
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (prev === next) {
    console.log('Forum pulse unchanged; nothing to commit.');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=false\n');
    }
    return;
  }
  fs.writeFileSync(OUT, next);
  console.log('Updated ' + OUT + ' (' + topics.length + ' topics).');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
