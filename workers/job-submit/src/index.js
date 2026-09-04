/**
 * Open Source Design - submission Worker (jobs + events).
 *
 * Free replacement for the old Staticman backend. The "Post a Job" form
 * (layouts/jobs/job-form.html) and the "Submit an Event" form
 * (layouts/events/event-form.html) POST a JSON submission here; events are
 * marked with kind: "event". We verify it (Cloudflare Turnstile + honeypot),
 * rebuild the Markdown server-side, and open a moderated pull request against
 * the site repo's content/jobs/ or content/events/ directory via the GitHub
 * REST API.
 *
 * The submitter's private email is NOT placed in the (public) PR. It is stored
 * in KV keyed by the created PR number so the merge workflow can email them on
 * publish via an authenticated lookup.
 *
 * Edits: when a submission carries edit_file (set by a form's edit mode,
 * /jobs/job-form/?edit=<file> or /events/event-form/?edit=<file>), the worker
 * updates that existing file on a job-edit/* or event-edit/* branch instead of
 * adding a new one, preserving identity fields (date_posted, date, _id, slug,
 * url, permalink, aliases, categories, author) so URLs and ordering don't
 * change.
 *
 * Routes:
 *   POST /submit         -> { ok, pr_url }
 *   GET  /lookup?pr=<n>  -> { ok, found, email, title, kind }  (Bearer LOOKUP_SECRET)
 *   DELETE /lookup?pr=<n> -> { ok, deleted }  (Bearer LOOKUP_SECRET; legacy - prefer /rejection-sent)
 *   GET  /rejection-sent?pr=<n> -> { ok, sent }  (Bearer LOOKUP_SECRET)
 *   POST /rejection-sent?pr=<n> -> { ok, marked }  (Bearer LOOKUP_SECRET; idempotent)
 */

import { parseFrontMatter } from './yaml-front-matter.js';

const GH_API = 'https://api.github.com';

// Defensive input caps (the form validates too, but never trust the client).
const MAX_FIELD = 8000;        // generous cap for most fields + Turnstile token
const MAX_DESCRIPTION = 30000; // description / deliverables may be longer

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(env, request, new Response(null, { status: 204 }));
    }

    if ((url.pathname === '/' || url.pathname === '/health') && request.method === 'GET') {
      return withCors(env, request, json({ ok: true, service: 'osd-job-submit' }));
    }

    if (url.pathname === '/submit' && request.method === 'POST') {
      return withCors(env, request, await handleSubmit(request, env));
    }

    // Server-to-server only (no CORS headers needed).
    if (url.pathname === '/lookup' && request.method === 'GET') {
      return handleLookup(request, env, url);
    }
    if (url.pathname === '/lookup' && request.method === 'DELETE') {
      return handleForget(request, env, url);
    }
    if (url.pathname === '/rejection-sent' && request.method === 'GET') {
      return handleRejectionSentGet(request, env, url);
    }
    if (url.pathname === '/rejection-sent' && request.method === 'POST') {
      return handleRejectionSentMark(request, env, url);
    }

    // CORS proxy for the Discourse "latest topics" list (the forum sends no
    // Access-Control-Allow-Origin, so browsers can't fetch it directly).
    // Cached at the Cloudflare edge and in the browser for 10 minutes.
    if (url.pathname === '/forum' && request.method === 'GET') {
      return withCors(env, request, await handleForum(env));
    }

    return withCors(env, request, json({ ok: false, error: 'Not found' }, 404));
  }
};

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

async function handleSubmit(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  // Honeypot: silently accept so bots get no signal, but do nothing.
  if (data.company) {
    return json({ ok: true, pr_url: '' });
  }

  // Cloudflare Turnstile. Fails closed: a missing secret rejects submissions
  // instead of silently waving everything through. Local dev can opt out
  // explicitly with DISABLE_TURNSTILE = "true" in wrangler.toml / dashboard.
  if (String(env.DISABLE_TURNSTILE || '').toLowerCase() !== 'true') {
    if (!env.TURNSTILE_SECRET) {
      return json({ ok: false, error: 'Submissions are temporarily unavailable (captcha is not configured).' }, 503);
    }
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, data.turnstile_token, request);
    if (!ok) {
      return json({ ok: false, error: 'Captcha verification failed. Please try again.' }, 400);
    }
  }

  const kind = data.kind === 'event' ? 'event' : data.kind === 'resource' ? 'resource' : 'job';

  // Optional edit mode: update an existing posting instead of adding a new
  // file. The target must be a plain filename inside the kind's content dir;
  // identity fields are preserved from the current file.
  let edit = null;
  if (data.edit_file && kind !== 'resource') {
    const file = String(data.edit_file).trim();
    if (!isSafeFilename(file)) {
      return json({ ok: false, error: 'Invalid edit target.' }, 400);
    }
    const dir = (kind === 'event'
      ? (env.CONTENT_DIR_EVENTS || 'content/events')
      : (env.CONTENT_DIR || 'content/jobs')).replace(/\/+$/, '');
    edit = { path: dir + '/' + file };
  }

  // Required fields (mirror each form's client-side validation).
  const required = kind === 'event'
    ? ['title', 'location', 'start_date', 'description']
    : kind === 'resource'
      ? ['name', 'url', 'category']
      : ['title', 'organization', 'org_url', 'license', 'role', 'description', 'how_to_apply'];
  for (const f of required) {
    if (!data[f] || !String(data[f]).trim()) {
      return json({ ok: false, error: 'Missing required field: ' + f }, 400);
    }
  }

  // Defense-in-depth format/length validation (the forms validate too).
  const lengthError = checkLengths(data);
  if (lengthError) return json({ ok: false, error: lengthError }, 400);
  if (kind === 'event') {
    if (!isIsoDate(data.start_date)) {
      return json({ ok: false, error: 'Start date must be a valid YYYY-MM-DD date.' }, 400);
    }
    if (data.end_date && !isIsoDate(data.end_date)) {
      return json({ ok: false, error: 'End date must be a valid YYYY-MM-DD date.' }, 400);
    }
    if (data.end_date && String(data.end_date) < String(data.start_date)) {
      return json({ ok: false, error: 'The end date cannot be before the start date.' }, 400);
    }
    if (data.website && !isHttpUrl(data.website)) {
      return json({ ok: false, error: 'Event website must be a valid http(s) URL.' }, 400);
    }
  } else if (kind === 'resource') {
    if (!isHttpUrl(data.url)) {
      return json({ ok: false, error: 'The resource URL must be a valid http(s) URL.' }, 400);
    }
    if (hasControlChars(data.name) || hasControlChars(data.url) || (data.description && hasControlChars(data.description))) {
      return json({ ok: false, error: 'Fields cannot contain line breaks or control characters.' }, 400);
    }
    if (!/^[a-z0-9-]{1,50}$/.test(String(data.category))) {
      return json({ ok: false, error: 'Invalid category.' }, 400);
    }
  } else {
    if (!isHttpUrl(data.org_url)) {
      return json({ ok: false, error: 'Project website must be a valid http(s) URL.' }, 400);
    }
    if (!isHttpUrl(data.license)) {
      return json({ ok: false, error: 'Project license must be a valid http(s) URL.' }, 400);
    }
    if (data.deadline) {
      if (!isIsoDate(data.deadline)) {
        return json({ ok: false, error: 'Application deadline must be a valid YYYY-MM-DD date.' }, 400);
      }
      // New postings can't already be expired; edits may keep a past deadline.
      if (!edit && String(data.deadline) < new Date().toISOString().slice(0, 10)) {
        return json({ ok: false, error: 'The application deadline cannot be in the past.' }, 400);
      }
    }
    // Structured rate (optional): sane numbers plus whitelisted currency/period.
    if (data.rate_min) {
      const min = Number(data.rate_min);
      const max = data.rate_max ? Number(data.rate_max) : null;
      if (!isFinite(min) || min < 0 || (max !== null && (!isFinite(max) || max < min))) {
        return json({ ok: false, error: 'The rate must be a valid number range.' }, 400);
      }
      if (data.rate_currency && !/^[A-Z]{3}$/.test(String(data.rate_currency))) {
        return json({ ok: false, error: 'The rate currency must be a 3-letter code.' }, 400);
      }
      if (data.rate_period && !['hour', 'day', 'month', 'year', 'project'].includes(String(data.rate_period))) {
        return json({ ok: false, error: 'The rate period is not recognized.' }, 400);
      }
    }
  }
  if (data.email && !isEmail(data.email)) {
    return json({ ok: false, error: 'Please provide a valid email address (or leave it blank).' }, 400);
  }

  // Optional, best-effort per-IP daily cap (only if a RATE_LIMIT KV is bound).
  if (env.RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const day = new Date().toISOString().slice(0, 10);
    const key = 'rl:' + day + ':' + ip;
    const cur = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10) || 0;
    const max = parseInt(env.RATE_LIMIT_MAX || '5', 10) || 5;
    if (cur >= max) {
      return json({ ok: false, error: 'Too many submissions today. Please try again tomorrow.' }, 429);
    }
    await env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: 86400 });
  }

  // Resource suggestions edit data/resources.yaml instead of adding a
  // content file; they take their own PR path.
  if (kind === 'resource') {
    let pr;
    try {
      pr = await createResourcePullRequest(env, data);
    } catch (err) {
      return prFailResponse(err);
    }
    if (data.email && String(data.email).trim() && env.EMAILS) {
      const days = parseInt(env.EMAIL_TTL_DAYS || '90', 10) || 90;
      try {
        await env.EMAILS.put(
          'pr:' + pr.number,
          JSON.stringify({ email: String(data.email).trim(), title: data.name, kind }),
          { expirationTtl: days * 86400 }
        );
      } catch (e) {
        // Non-fatal: the PR still exists, only the auto-email would be skipped.
      }
    }
    return json({ ok: true, pr_url: pr.html_url });
  }

  // Duplicate detection for new jobs: compare against the live job index and
  // ask for confirmation (the form re-submits with force_duplicate).
  if (kind === 'job' && !edit && !data.force_duplicate) {
    const dup = await findDuplicateJob(env, data);
    if (dup) {
      return json({
        ok: false,
        duplicate: { title: dup.title, url: dup.url, organization: dup.organization || '' },
        error: 'A very similar posting is already open: "' + dup.title + '".',
      }, 409);
    }
  }

  // For edits, load the current file so we can keep its identity fields
  // (dates, ids, slugs, URL overrides) and its blob SHA for the update.
  if (edit) {
    let existing;
    try {
      existing = await gh(
        env,
        'GET',
        `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIPath(edit.path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`
      );
    } catch (err) {
      return json({ ok: false, error: 'The posting to edit could not be found.' }, 404);
    }
    edit.sha = existing.sha;
    const fm = parseFrontMatter(b64decode(existing.content));
    if (!fm) {
      return json({ ok: false, error: 'The posting to edit could not be parsed.' }, 422);
    }
    edit.date_posted = fm.scalar('date_posted');
    edit.date = fm.scalar('date');
    edit.id = fm.scalar('_id');
    edit.slug = fm.scalar('slug');
    edit.url = fm.scalar('url');
    edit.permalink = fm.scalar('permalink');
    edit.aliases = fm.list('aliases');
    edit.categories = fm.list('categories');
    if (!edit.categories.length) {
      // Legacy Jekyll files use a space-separated scalar: "design hack meeting".
      const rawCats = fm.scalar('categories');
      if (rawCats) edit.categories = rawCats.split(/[,\s]+/).filter(Boolean);
    }
    edit.author = fm.scalar('author');
    edit.layout = fm.scalar('layout');
    edit.recurrence = fm.scalar('recurrence'); // e.g. the monthly community call
    // The poster may change the status from the edit form (close a job,
    // cancel an event); anything not on the whitelist keeps the current value.
    const requested = String(data.status || '').trim();
    const allowed = kind === 'event'
      ? ['upcoming', 'started', 'past', 'cancelled']
      : ['searching', 'filled', 'closed', 'expired'];
    const normalized = requested === 'solved' || requested === 'resolved' || requested === 'completed'
      ? 'filled'
      : requested;
    edit.status = allowed.includes(normalized)
      ? normalized
      : (fm.scalar('status') || (kind === 'event' ? 'upcoming' : 'searching'));
  }

  const built = kind === 'event' ? buildEventMarkdown(data, env, edit) : buildMarkdown(data, env, edit);

  let pr;
  try {
    pr = await createPullRequest(env, built, data, kind, edit);
  } catch (err) {
    return prFailResponse(err);
  }

  // Store the submitter email privately for the merge-time notification.
  if (data.email && String(data.email).trim() && env.EMAILS) {
    const days = parseInt(env.EMAIL_TTL_DAYS || '90', 10) || 90;
    try {
      await env.EMAILS.put(
        'pr:' + pr.number,
        JSON.stringify({ email: String(data.email).trim(), title: data.title, kind }),
        { expirationTtl: days * 86400 }
      );
    } catch (e) {
      // Non-fatal: the PR still exists, only the auto-email would be skipped.
    }
  }

  return json({ ok: true, pr_url: pr.html_url });
}

async function handleLookup(request, env, url) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.LOOKUP_SECRET || !safeEqual(auth, 'Bearer ' + env.LOOKUP_SECRET)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const pr = url.searchParams.get('pr');
  if (!pr) return json({ ok: false, error: 'Missing pr parameter.' }, 400);
  if (!env.EMAILS) return json({ ok: true, found: false });

  const raw = await env.EMAILS.get('pr:' + pr);
  if (!raw) return json({ ok: true, found: false });

  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { rec = null; }
  if (!rec || !rec.email) return json({ ok: true, found: false });

  return json({ ok: true, found: true, email: rec.email, title: rec.title || '', kind: rec.kind || 'job' });
}

async function handleForget(request, env, url) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.LOOKUP_SECRET || !safeEqual(auth, 'Bearer ' + env.LOOKUP_SECRET)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const pr = url.searchParams.get('pr');
  if (!pr) return json({ ok: false, error: 'Missing pr parameter.' }, 400);
  if (!env.EMAILS) return json({ ok: true, deleted: false });

  await env.EMAILS.delete('pr:' + pr);
  return json({ ok: true, deleted: true });
}

function authLookup(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.LOOKUP_SECRET || !safeEqual(auth, 'Bearer ' + env.LOOKUP_SECRET)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return null;
}

async function handleRejectionSentGet(request, env, url) {
  const denied = authLookup(request, env);
  if (denied) return denied;
  const pr = url.searchParams.get('pr');
  if (!pr) return json({ ok: false, error: 'Missing pr parameter.' }, 400);
  if (!env.EMAILS) return json({ ok: true, sent: false });

  const sent = !!(await env.EMAILS.get('rejected:' + pr));
  return json({ ok: true, sent });
}

async function handleRejectionSentMark(request, env, url) {
  const denied = authLookup(request, env);
  if (denied) return denied;
  const pr = url.searchParams.get('pr');
  if (!pr) return json({ ok: false, error: 'Missing pr parameter.' }, 400);
  if (!env.EMAILS) return json({ ok: true, marked: false });

  const days = parseInt(env.EMAIL_TTL_DAYS || '90', 10) || 90;
  await env.EMAILS.put('rejected:' + pr, '1', { expirationTtl: days * 86400 });
  return json({ ok: true, marked: true });
}

/* -------------------------------------------------------------------------- */
/* Turnstile                                                                  */
/* -------------------------------------------------------------------------- */

async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  const body = new URLSearchParams();
  body.append('secret', secret);
  body.append('response', String(token));
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.append('remoteip', ip);
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body
    });
    const out = await resp.json();
    return !!(out && out.success);
  } catch (e) {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Markdown generation (mirrors generateMarkdown in job-form.html)            */
/* -------------------------------------------------------------------------- */

export function buildMarkdown(data, env, edit) {
  const now = new Date();
  const today =
    now.getUTCFullYear() +
    '-' + String(now.getUTCMonth() + 1).padStart(2, '0') +
    '-' + String(now.getUTCDate()).padStart(2, '0');
  // Edits keep the original identity so the URL and list ordering don't change.
  const datePosted = (edit && edit.date_posted) || today;
  const isoDate = (edit && edit.date) || now.toISOString();
  const status = (edit && edit.status) || 'searching';

  const slug = datePosted + '-' + slugify(data.title);
  const dir = (env.CONTENT_DIR || 'content/jobs').replace(/\/+$/, '');
  const path = edit ? edit.path : dir + '/' + slug + '.md';

  const applyList = linesToList(data.how_to_apply);
  const linkList = linesToList(data.links);
  const tagList = tagsToList(data.tags);

  const fm = [];
  fm.push('---');
  fm.push('title: ' + yq(data.title));
  fm.push('status: ' + status);
  fm.push('date_posted: ' + yq(datePosted));
  fm.push('date: ' + yq(isoDate));
  if (edit) {
    pushPreservedIdentity(fm, edit);
    fm.push('last_updated: ' + yq(today));
  }
  fm.push('organization: ' + yq(data.organization));
  fm.push('org_url: ' + yq(data.org_url));
  fm.push('license: ' + yq(data.license));
  fm.push('role: ' + yq(data.role));
  fm.push('compensation: ' + yq(data.compensation || 'gratis'));
  if (data.paid_details && data.compensation === 'paid') fm.push('paid_details: ' + yq(data.paid_details));
  if (data.rate_min && data.compensation === 'paid') {
    fm.push('rate_min: ' + Number(data.rate_min));
    if (data.rate_max) fm.push('rate_max: ' + Number(data.rate_max));
    fm.push('rate_currency: ' + yq(data.rate_currency || 'USD'));
    fm.push('rate_period: ' + yq(data.rate_period || 'hour'));
  }
  if (data.deadline) fm.push('deadline: ' + yq(String(data.deadline).trim()));
  if (data.github_handle) fm.push('github_handle: ' + yq(data.github_handle));
  if (data.announce_social === false || String(data.announce_social || '').toLowerCase() === 'false') {
    fm.push('announce_social: false');
  }

  if (tagList.length) {
    fm.push('tags:');
    tagList.forEach((t) => fm.push('  - ' + yq(t)));
  }
  if (applyList.length) {
    fm.push('how_to_apply:');
    applyList.forEach((t) => fm.push('  - ' + yq(t)));
  }
  if (linkList.length) {
    fm.push('links:');
    linkList.forEach((t) => fm.push('  - ' + yq(t)));
  }
  if (data.deliverables) {
    fm.push('deliverables: |-');
    linesToList(sanitizeMarkdown(data.deliverables)).forEach((t) => fm.push('  ' + t));
  }
  fm.push('---');
  fm.push('');
  fm.push(sanitizeMarkdown(String(data.description || '').trim()));
  fm.push('');

  return { path, slug, markdown: fm.join('\n') };
}

/* Fields that must survive an edit so the page keeps its URL, taxonomy and
   attribution (legacy files use url/permalink overrides and categories). */
function pushPreservedIdentity(fm, edit) {
  if (edit.id) fm.push('_id: ' + yq(edit.id));
  if (edit.slug) fm.push('slug: ' + yq(edit.slug));
  if (edit.url) fm.push('url: ' + yq(edit.url));
  if (edit.permalink) fm.push('permalink: ' + yq(edit.permalink));
  if (edit.aliases && edit.aliases.length) {
    fm.push('aliases:');
    edit.aliases.forEach((a) => fm.push('  - ' + yq(a)));
  }
  if (edit.categories && edit.categories.length) {
    fm.push('categories:');
    edit.categories.forEach((c) => fm.push('  - ' + yq(c)));
  }
  if (edit.author) fm.push('author: ' + yq(edit.author));
  if (edit.layout) fm.push('layout: ' + yq(edit.layout));
  if (edit.recurrence) fm.push('recurrence: ' + yq(edit.recurrence));
}

/* Mirrors generateMarkdown in event-form.html. */
function buildEventMarkdown(data, env, edit) {
  // Edits keep the original submission date and identity so URLs don't change.
  const isoDate = (edit && edit.date) || new Date().toISOString();
  const status = (edit && edit.status) || 'upcoming';
  const start = String(data.start_date).trim();
  const end = data.end_date ? String(data.end_date).trim() : '';

  const slug = start + '-' + slugify(data.title);
  const dir = (env.CONTENT_DIR_EVENTS || 'content/events').replace(/\/+$/, '');
  const path = edit ? edit.path : dir + '/' + slug + '.md';

  const fm = [];
  fm.push('---');
  fm.push('layout: event');
  fm.push('title: ' + yq(data.title));
  fm.push('status: ' + status);
  fm.push('date: ' + yq(isoDate));
  if (edit) pushPreservedIdentity(fm, edit);
  fm.push('eventDate: ' + yq(formatEventDate(start, end)));
  fm.push('eventStart: ' + yq(start));
  fm.push('endDate: ' + yq(end || start));
  if (data.time) fm.push('time: ' + yq(data.time));
  fm.push('location: ' + yq(data.location));
  fm.push('---');
  fm.push('');
  fm.push(sanitizeMarkdown(String(data.description || '').trim()));
  if (data.website) {
    fm.push('');
    // encodeURI keeps the URL working but percent-encodes <, >, " and
    // whitespace so the value can't break out of the Markdown autolink.
    fm.push('More information: <' + encodeURI(String(data.website).trim()) + '>');
  }
  fm.push('');

  return { path, slug, markdown: fm.join('\n') };
}

// Human-readable date range in the site's eventDate style, e.g.
// "1 February 2027", "1–2 February 2027", "28 February – 1 March 2027".
function formatEventDate(startISO, endISO) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const parts = (iso) => {
    const m = String(iso).split('-');
    return { y: +m[0], mo: +m[1], d: +m[2] };
  };
  const s = parts(startISO);
  const e = endISO ? parts(endISO) : s;
  if (s.y === e.y && s.mo === e.mo && s.d === e.d) return s.d + ' ' + months[s.mo - 1] + ' ' + s.y;
  if (s.y === e.y && s.mo === e.mo) return s.d + '\u2013' + e.d + ' ' + months[s.mo - 1] + ' ' + s.y;
  if (s.y === e.y) return s.d + ' ' + months[s.mo - 1] + ' \u2013 ' + e.d + ' ' + months[e.mo - 1] + ' ' + s.y;
  return s.d + ' ' + months[s.mo - 1] + ' ' + s.y + ' \u2013 ' + e.d + ' ' + months[e.mo - 1] + ' ' + e.y;
}

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Bigram Dice similarity of two slugs (0..1). */
function diceSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let hits = 0;
  for (const [g, n] of ma) hits += Math.min(n, mb.get(g) || 0);
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

/**
 * Best-effort duplicate check for new job submissions against the site's
 * machine-readable index (/jobs/index.json, built by Hugo). Only open
 * (`searching`) postings count - reposting a solved job is legitimate.
 * Fails open: a network hiccup must never block a real submission.
 */
async function findDuplicateJob(env, data) {
  try {
    const base = (env.SITE_BASE_URL || 'https://opensourcedesign.net').replace(/\/+$/, '');
    const res = await fetch(base + '/jobs/index.json', {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const index = await res.json();
    const newTitle = slugify(data.title);
    const newOrg = slugify(data.organization || '');
    for (const job of index.jobs || []) {
      if (String(job.status || '').toLowerCase() !== 'searching') continue;
      const title = slugify(job.title || '');
      if (!title || !newTitle) continue;
      if (title === newTitle) return job;
      const sameOrg = newOrg && slugify(job.organization || '') === newOrg;
      if (sameOrg && diceSimilarity(title, newTitle) >= 0.8) return job;
    }
  } catch (e) {
    // Fail open.
  }
  return null;
}

function yq(v) {
  const s = String(v == null ? '' : v)
    // Strip control characters (including \n / \r): every yq() value is a
    // single-line double-quoted YAML scalar, and an embedded newline would
    // break out of the quotes and inject front-matter keys.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '"' + s + '"';
}

function yqSingleQuoted(v) {
  const s = String(v == null ? '' : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/'/g, "''");
  return "'" + s + "'";
}

function hasControlChars(s) {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(String(s));
}

// The site renders Markdown with goldmark's `unsafe` renderer, so raw HTML in
// a submission would go live on merge. Escape tag-openers (<script, </div,
// <!--, <?) while keeping Markdown autolinks (<https://…>, <mailto:…>) intact.
function sanitizeMarkdown(v) {
  return String(v == null ? '' : v)
    .replace(/<(?=[a-zA-Z/!?])(?!(?:https?:\/\/|mailto:)[^\s<>]*>)/g, '&lt;');
}

function linesToList(s) {
  return String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function tagsToList(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* GitHub REST API                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Insert a suggested resource into data/resources.yaml (at the end of the
 * chosen category's items) and open a PR. The category must be an existing
 * `- id:` in the file; the YAML is edited textually to keep the file's
 * comments and formatting intact.
 */
async function createResourcePullRequest(env, data) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const base = env.GITHUB_BRANCH || 'main';
  const path = env.RESOURCES_FILE || 'data/resources.yaml';

  const existing = await gh(
    env,
    'GET',
    `/repos/${owner}/${repo}/contents/${encodeURIPath(path)}?ref=${encodeURIComponent(base)}`
  );
  const text = b64decode(existing.content);

  const catId = String(data.category).trim();
  const catRe = new RegExp('^- id: ' + catId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*$', 'm');
  const catMatch = text.match(catRe);
  if (!catMatch) throw new Error('Unknown category: ' + catId);

  // Insert just before the next category block (or at end of file).
  const nextRe = /^- id: /gm;
  nextRe.lastIndex = catMatch.index + catMatch[0].length;
  const next = nextRe.exec(text);
  const insertAt = next ? next.index : text.length;

  const entryLines = [
    '    - name: ' + yqSingleQuoted(String(data.name).trim()),
    '      url: ' + yqSingleQuoted(String(data.url).trim()),
  ];
  if (data.description && String(data.description).trim()) {
    entryLines.push('      description: ' + yqSingleQuoted(String(data.description).trim().replace(/\s+/g, ' ')));
  }

  const head = text.slice(0, insertAt).replace(/\n+$/, '\n');
  const tail = text.slice(insertAt);
  const updated = head + entryLines.join('\n') + '\n' + (tail ? '\n' + tail : '');

  const ref = await gh(env, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${base}`);
  const branch = 'resource/' + (slugify(data.name).slice(0, 40) || 'suggestion') + '-' + Math.random().toString(36).slice(2, 8);
  await gh(env, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: 'refs/heads/' + branch,
    sha: ref.object.sha,
  });

  await gh(env, 'PUT', `/repos/${owner}/${repo}/contents/${encodeURIPath(path)}`, {
    message: 'Suggest resource: ' + data.name,
    content: b64encode(updated),
    branch,
    sha: existing.sha,
  });

  const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const body = [
    'Automated resource suggestion from the [suggest form](https://opensourcedesign.net/resources/suggest/).',
    '',
    '| Field | Value |',
    '| ----- | ----- |',
    '| Name | ' + cell(data.name) + ' |',
    '| URL | ' + cell(data.url) + ' |',
    '| Category | ' + cell(catId) + ' |',
    ...(data.description ? ['| Description | ' + cell(data.description) + ' |'] : []),
    '',
    'Review the link before merging (relevance, licensing, no dead/spam URL).',
  ].join('\n');

  const pr = await gh(env, 'POST', `/repos/${owner}/${repo}/pulls`, {
    title: 'Resource suggestion: ' + data.name,
    head: branch,
    base,
    body,
  });

  const label = env.PR_LABEL_RESOURCE || 'resource-suggestion';
  if (label) {
    try {
      await gh(env, 'POST', `/repos/${owner}/${repo}/issues/${pr.number}/labels`, { labels: [label] });
    } catch (e) {
      // Label may not exist or token lacks Issues scope; non-fatal.
    }
  }

  return pr;
}

async function createPullRequest(env, built, data, kind, edit) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const base = env.GITHUB_BRANCH || 'main';
  const isEvent = kind === 'event';

  // 1. Resolve the base branch head SHA.
  const ref = await gh(env, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${base}`);
  const baseSha = ref.object.sha;

  // 2. Create a fresh branch off the base head. The prefix (job/, event/,
  //    job-edit/ or event-edit/) is what the merge-time email workflow keys off.
  const prefix = edit ? kind + '-edit' : kind;
  const branch = prefix + '/' + built.slug + '-' + Math.random().toString(36).slice(2, 8);
  await gh(env, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: 'refs/heads/' + branch,
    sha: baseSha
  });

  // 3. Commit the file. New submissions get a collision-free path; edits
  //    update the existing file in place (the contents API needs its SHA).
  const noun = isEvent ? 'event' : 'job';
  const filePath = edit ? built.path : await uniquePath(env, owner, repo, base, built.path);
  await gh(env, 'PUT', `/repos/${owner}/${repo}/contents/${encodeURIPath(filePath)}`, {
    message: (edit ? 'Update ' + noun + ': ' : 'Add ' + noun + ': ') + data.title,
    content: b64encode(built.markdown),
    branch,
    ...(edit ? { sha: edit.sha } : {})
  });

  // 4. Open the pull request.
  const prTitle = edit
    ? (isEvent ? 'Event edit: ' : 'Job edit: ')
    : (isEvent ? 'Event submission: ' : 'Job submission: ');
  const pr = await gh(env, 'POST', `/repos/${owner}/${repo}/pulls`, {
    title: prTitle + data.title,
    head: branch,
    base,
    body: isEvent ? eventPrBody(data, filePath, edit) : prBody(data, filePath, edit)
  });

  // 5. Label it (best-effort; the merge workflow keys off the branch name, not the label).
  const label = isEvent ? (env.PR_LABEL_EVENT || 'event-submission') : env.PR_LABEL;
  if (label) {
    try {
      await gh(env, 'POST', `/repos/${owner}/${repo}/issues/${pr.number}/labels`, {
        labels: [label]
      });
    } catch (e) {
      // Label may not exist or token lacks Issues scope; non-fatal.
    }
  }

  return pr;
}

function ghHeaders(env) {
  return {
    Authorization: 'Bearer ' + env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'osd-job-submit-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function gh(env, method, path, body) {
  const resp = await fetch(GH_API + path, {
    method,
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await resp.text();
  let out;
  try { out = text ? JSON.parse(text) : {}; } catch (e) { out = { raw: text }; }
  if (!resp.ok) {
    throw new Error((out && out.message) ? out.message : 'GitHub API ' + resp.status);
  }
  return out;
}

// Returns the first path variant (foo.md, foo-2.md, foo-3.md, ...) that does not
// already exist on the base branch, so the contents PUT never collides.
async function uniquePath(env, owner, repo, base, path) {
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? path : path.replace(/\.md$/, '-' + (i + 1) + '.md');
    const u = `/repos/${owner}/${repo}/contents/${encodeURIPath(candidate)}?ref=${encodeURIComponent(base)}`;
    const resp = await fetch(GH_API + u, { headers: ghHeaders(env) });
    if (resp.status === 404) return candidate;   // free
    if (resp.status !== 200) return candidate;   // can't tell; let PUT decide
  }
  return path;
}

function prBody(data, filePath, edit) {
  const lines = [];
  if (edit) {
    lines.push('Automated **edit** of an existing posting, submitted from the job edit form.');
    lines.push('');
    lines.push('Review the diff carefully: the whole file is regenerated from the form, so any hand-made tweaks to the original are replaced.');
  } else {
    lines.push('Automated submission from the **Post a Job** form.');
  }
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push('| Project | ' + cell(data.organization) + ' |');
  lines.push('| Website | ' + cell(data.org_url) + ' |');
  lines.push('| License | ' + cell(data.license) + ' |');
  lines.push('| Role | ' + cell(data.role) + ' |');
  lines.push('| Compensation | ' + cell(data.compensation) + (data.paid_details ? ' (' + cell(data.paid_details) + ')' : '') + ' |');
  if (data.rate_min) {
    const range = data.rate_max ? data.rate_min + '\u2013' + data.rate_max : data.rate_min;
    lines.push('| Rate | ' + cell(range + ' ' + (data.rate_currency || 'USD') + ' per ' + (data.rate_period || 'hour')) + ' |');
  }
  if (data.deadline) lines.push('| Apply by | ' + cell(data.deadline) + ' |');
  if (data.github_handle) lines.push('| Submitter GitHub | ' + cell(data.github_handle) + ' |');
  lines.push('| File | `' + filePath + '` |');
  lines.push('');
  lines.push('Review the file, then merge to publish. The submitter is emailed on merge or if the PR is closed without merging (their address is stored privately and is not shown here).');
  return lines.join('\n');
}

function eventPrBody(data, filePath, edit) {
  const lines = [];
  if (edit) {
    lines.push('Automated **edit** of an existing event, submitted from the event edit form.');
    lines.push('');
    lines.push('Review the diff carefully: the whole file is regenerated from the form, so any hand-made tweaks to the original are replaced.');
  } else {
    lines.push('Automated submission from the **Submit an Event** form.');
  }
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push('| Event | ' + cell(data.title) + ' |');
  lines.push('| Dates | ' + cell(formatEventDate(data.start_date, data.end_date)) + ' |');
  if (data.time) lines.push('| Time | ' + cell(data.time) + ' |');
  lines.push('| Location | ' + cell(data.location) + ' |');
  if (data.website) lines.push('| Website | ' + cell(data.website) + ' |');
  lines.push('| File | `' + filePath + '` |');
  lines.push('');
  lines.push('Review the file, then merge to publish. The submitter is emailed on merge or if the PR is closed without merging (their address is stored privately and is not shown here).');
  return lines.join('\n');
}

function cell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function b64encode(str) {
  // UTF-8 safe base64 (GitHub contents API expects base64-encoded content).
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// A single .md filename - no path separators or traversal. The character set
// covers the legacy filenames in content/jobs/ (spaces, parens, '&', '+', ',').
function isSafeFilename(s) {
  return /^[\w .,()&+'-]+\.md$/.test(s) && !s.includes('..');
}

function encodeURIPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function checkLengths(data) {
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') continue;
    const cap = (k === 'description' || k === 'deliverables') ? MAX_DESCRIPTION : MAX_FIELD;
    if (v.length > cap) return 'Field too long: ' + k;
  }
  return null;
}

function isHttpUrl(s) {
  try {
    const u = new URL(String(s).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s).trim());
}

function isIsoDate(s) {
  const str = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function errMsg(err) {
  return err && err.message ? err.message : 'unknown error';
}

function prFailResponse(err) {
  console.error('Pull request creation failed:', err);
  return json({
    ok: false,
    error: 'Could not create pull request. Please try again later or open one manually on GitHub.',
  }, 502);
}

/**
 * GET /forum - trimmed Discourse latest-topics list for the homepage forum
 * pulse. Proxied because Discourse doesn't send CORS headers; cached at the
 * edge (cf.cacheTtl) and in the browser (Cache-Control) for 10 minutes so a
 * traffic spike on the site never hammers the forum.
 */
async function handleForum(env) {
  const base = (env.FORUM_URL || 'https://discourse.opensourcedesign.net').replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/latest.json', {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!res.ok) return json({ ok: false, error: 'Forum unavailable.' }, 502);
    const data = await res.json();
    const topics = (data.topic_list && data.topic_list.topics ? data.topic_list.topics : [])
      .filter((t) => !t.pinned)
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        posts_count: t.posts_count,
        last_posted_at: t.last_posted_at,
      }));
    const resp = json({ ok: true, topics });
    resp.headers.set('Cache-Control', 'public, max-age=600');
    return resp;
  } catch (e) {
    return json({ ok: false, error: 'Forum unavailable.' }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withCors(env, request, resp) {
  const allowed = String(env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const reqOrigin = request.headers.get('Origin') || '';
  if (allowed[0] !== '*' && reqOrigin && !allowed.includes(reqOrigin)) {
    return new Response('Forbidden', { status: 403 });
  }
  let allow = allowed[0] || '*';
  if (allow !== '*' && allowed.includes(reqOrigin)) allow = reqOrigin;

  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', allow);
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Vary', 'Origin');
  return new Response(resp.body, { status: resp.status, headers: h });
}
