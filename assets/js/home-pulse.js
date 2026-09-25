/** Homepage jobs + forum pulse (lazy-loaded after first paint). */
export function init(cfg) {
  cfg = cfg || {};
  var jobsUrl = cfg.jobsUrl || '/jobs/index.json';
  var forumEndpoint = cfg.forumEndpoint || '';
  var forumBase = cfg.forumBase || '';
  var jobsList = document.getElementById('osd-home-jobs');
  var jobsStats = document.getElementById('osd-home-jobs-stats');
  var heroStats = document.getElementById('osd-home-hero-stats');
  var forumList = document.getElementById('osd-forum-pulse');
  var forumFallback = document.getElementById('osd-forum-fallback');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isOpen(job) {
    if (String(job.status || '').toLowerCase() !== 'searching') return false;
    if (job.deadline) {
      var today = new Date().toISOString().slice(0, 10);
      if (String(job.deadline).slice(0, 10) < today) return false;
    }
    return true;
  }

  function renderJobs(data) {
    // A failed or non-JSON response: keep the build-time list and counts.
    if (!data || !Array.isArray(data.jobs)) return;
    var jobs = data.jobs;
    var open = jobs.filter(isOpen);
    var total = data.total_count != null ? data.total_count : jobs.length;
    var openCount = data.open_count != null ? data.open_count : open.length;

    if (heroStats) {
      heroStats.textContent = openCount + ' design jobs open right now, ' + total + '+ posted by open source projects over the years.';
    }
    if (jobsStats) {
      jobsStats.textContent = 'Browse ' + total + '+ archived jobs →';
    }
    if (!jobsList) return;

    var sorted = open.slice().sort(function (a, b) {
      return String(b.date_posted || '').localeCompare(String(a.date_posted || ''));
    }).slice(0, 5);

    if (!sorted.length) {
      jobsList.innerHTML = '<li class="py-3 text-sm text-slate-500 dark:text-slate-400">No open jobs yet.</li>';
      return;
    }

    jobsList.innerHTML = sorted.map(function (job) {
      var paid = String(job.compensation || '').toLowerCase() === 'paid';
      var dot = paid ? 'bg-emerald-500' : 'bg-violet-500';
      var label = paid ? 'Paid' : 'Volunteer';
      var href = job.url || '#';
      try {
        var u = new URL(href, window.location.origin);
        href = u.pathname + u.search;
      } catch (e) { /* keep href */ }
      return '<li class="border-b border-slate-200 dark:border-slate-700 last:border-0">'
        + '<a class="group flex items-baseline gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20" href="' + esc(href) + '">'
        + '<span class="h-2 w-2 shrink-0 self-center rounded-full ' + dot + '" title="' + esc(label) + '" aria-hidden="true"></span>'
        + '<span class="line-clamp-2 text-sm leading-snug text-slate-700 dark:text-slate-300 transition group-hover:text-slate-950 dark:group-hover:text-slate-100">' + esc(job.title || 'Untitled') + '</span>'
        + '</a></li>';
    }).join('');
  }

  function renderForum(topics) {
    if (!forumList || !topics || !topics.length) return;
    forumList.innerHTML = topics.slice(0, 4).map(function (t) {
      var replies = Math.max(0, (t.posts_count || 1) - 1);
      var when = t.last_posted_at
        ? ' · ' + new Date(t.last_posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      return '<li><a class="group block" href="' + esc(forumBase) + '/t/' + encodeURIComponent(t.slug) + '/' + t.id + '" target="_blank" rel="noopener noreferrer">'
        + '<span class="block text-sm font-medium leading-snug text-slate-900 dark:text-slate-100 transition group-hover:text-emerald-700">' + esc(t.title) + '</span>'
        + '<span class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">' + replies + (replies === 1 ? ' reply' : ' replies') + when + '</span>'
        + '</a></li>';
    }).join('');
    forumList.hidden = false;
    if (forumFallback) forumFallback.hidden = true;
  }

  function loadJobs() {
    fetch(jobsUrl, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(renderJobs)
      .catch(function () { /* keep server placeholders */ });
  }

  function loadForum() {
    if (!forumEndpoint) return;
    var TTL = 10 * 60 * 1000;
    try {
      var cached = JSON.parse(sessionStorage.getItem('osd-forum-pulse') || 'null');
      if (cached && Date.now() - cached.t < TTL) {
        renderForum(cached.topics);
        return;
      }
    } catch (e) { /* ignore */ }

    fetch(forumEndpoint, { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json || !json.ok || !json.topics) return;
        renderForum(json.topics);
        try { sessionStorage.setItem('osd-forum-pulse', JSON.stringify({ t: Date.now(), topics: json.topics })); } catch (e) { /* quota */ }
      })
      .catch(function () { /* keep build-time list */ });
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(function () { loadJobs(); loadForum(); }, { timeout: 2000 });
  } else {
    setTimeout(function () { loadJobs(); loadForum(); }, 0);
  }
}
