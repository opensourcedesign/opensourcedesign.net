/** Generated from layouts/jobs/job-form.html — edit the layout or re-run extract-form-js.mjs. */
import { parseFrontMatter } from './yaml-front-matter.js';
export function init(cfg) {
  cfg = cfg || {};
  var endpoint = cfg.endpoint || '';
  var repoURL = cfg.repoURL || '';
  var repoBranch = cfg.repoBranch || 'main';
var form = document.getElementById('osd-job-form');
        if (!form) return;

        // Edit mode: ?edit=<file>.md prefills the form from the existing
        // posting and submits an update to that file instead of a new one.
        var editFile = '';
        try {
          var editParam = new URLSearchParams(window.location.search).get('edit') || '';
          if (/^[\w .,()&+'-]+\.md$/.test(editParam) && editParam.indexOf('..') === -1) editFile = editParam;
        } catch (e) { /* no URLSearchParams: edit mode unavailable */ }
        var editMeta = null; // identity fields parsed from the original file
        var allowDuplicate = false; // set by "Post anyway" after a 409 duplicate warning

        var paidWrap = document.getElementById('paidDetailsWrap');
        var note = document.getElementById('osd-form-note');
        var out = document.getElementById('osd-result');
        var outTitle = document.getElementById('osd-result-title');
        var outBody = document.getElementById('osd-result-body');
        var outExtra = document.getElementById('osd-result-extra');
        var submitBtn = document.getElementById('osd-submit');

        // Turnstile tokens are single-use: the Worker spends one on every
        // request, whatever the outcome. Reset the widget after each attempt
        // and wait for a fresh token, so a retry - e.g. "Post anyway" after a
        // duplicate warning - doesn't fail with "Captcha verification failed".
        var turnstileBox = form.querySelector('.cf-turnstile');
        function turnstileValue() {
          var el = form.querySelector('[name="cf-turnstile-response"]');
          return el && el.value ? String(el.value) : '';
        }
        function resetTurnstile() {
          try {
            if (turnstileBox && window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset(turnstileBox);
          } catch (e) { /* widget not rendered yet */ }
        }
        function freshTurnstileToken(timeoutMs) {
          return new Promise(function (resolve) {
            var until = Date.now() + (timeoutMs || 10000);
            (function poll() {
              var token = turnstileValue();
              if (token || !turnstileBox || Date.now() > until) return resolve(token);
              setTimeout(poll, 250);
            })();
          });
        }

        function slugify(str) {
          str = (str || '').trim().toLowerCase();
          str = str.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
          str = str.replace(/[^a-z0-9\s-]/g, '');
          str = str.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
          return str;
        }

        // Title-quality nudges (issue #152): live, non-blocking hints that
        // steer posters toward titles which stand alone in lists and feeds.
        // One hint at a time, in priority order; never prevents submission.
        (function () {
          var titleEl = document.getElementById('title');
          var orgEl = document.getElementById('organization');
          var hintEl = document.getElementById('title-hint');
          if (!titleEl || !hintEl) return;

          var GENERIC = /^(designers?|developers?|logo|logos|design|ux|ui|ux\/ui|ui\/ux|help|help needed|job|volunteer|designer needed|designers wanted|design help|logo design|web design|graphic designer?|ux designer?|ui designer?)[.!?]*$/i;

          function titleHint() {
            var t = (titleEl.value || '').trim();
            if (!t) return '';
            var words = t.split(/\s+/).filter(Boolean);
            if (GENERIC.test(t) || words.length < 3) {
              return 'Vague titles get fewer responses - say what the task is, e.g. \u201cLogo design for ' + ((orgEl && orgEl.value.trim()) || 'YourProject') + '\u201d.';
            }
            var letters = t.replace(/[^a-zA-Z]/g, '');
            if (letters.length > 8 && letters === letters.toUpperCase()) {
              return 'All-caps titles are hard to read in lists - normal casing works better.';
            }
            var org = orgEl ? orgEl.value.trim() : '';
            if (org.length > 2 && t.toLowerCase().indexOf(org.toLowerCase()) === -1) {
              return 'Tip: mention \u201c' + org + '\u201d in the title so readers know the project at a glance.';
            }
            return '';
          }

          var timer = null;
          function refresh() {
            clearTimeout(timer);
            timer = setTimeout(function () {
              var msg = titleHint();
              hintEl.textContent = msg;
              hintEl.classList.toggle('hidden', !msg);
            }, 400);
          }
          titleEl.addEventListener('input', refresh);
          titleEl.addEventListener('blur', refresh);
          if (orgEl) orgEl.addEventListener('input', refresh);
        })();

        function yq(v) {
          var s = String(v == null ? '' : v);
          s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return '"' + s + '"';
        }

        function getRadio(name) {
          var el = form.querySelector('input[name="' + name + '"]:checked');
          return el ? el.value : '';
        }

        function syncPaid() {
          var comp = getRadio('compensation');
          if (!paidWrap) return;
          paidWrap.hidden = comp !== 'paid';
        }

        function linesToList(s) {
          return String(s || '')
            .split(/\r?\n/)
            .map(function (x) { return x.trim(); })
            .filter(Boolean);
        }

        function tagsToList(s) {
          return String(s || '')
            .split(',')
            .map(function (x) { return x.trim(); })
            .filter(Boolean);
        }

        function showResult(title, bodyHtml, extraHtml) {
          if (outTitle) outTitle.innerHTML = '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> ' + title;
          if (outBody) outBody.innerHTML = bodyHtml || '';
          if (outExtra) outExtra.innerHTML = extraHtml || '';
          if (out) {
            out.hidden = false;
            out.setAttribute('tabindex', '-1');
            out.focus();
          }
          out.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        }

        function showSubmissionSuccess(prUrl, heading, againLabel) {
          var safePr = esc(String(prUrl || ''));
          form.hidden = true;
          allowDuplicate = false;
          if (note) note.textContent = '';
          out.classList.remove('border-amber-300', 'bg-amber-50', 'border-slate-200', 'bg-white');
          out.classList.add('border-emerald-200', 'bg-emerald-50');
          showResult(
            heading,
            'Your submission is in the moderation queue. Track progress in <a class="font-medium underline underline-offset-4 hover:text-emerald-700" href="' + safePr + '" target="_blank" rel="noopener noreferrer">this pull request</a>. A volunteer moderator will review it; a comment there shows a preview and what happens next. The automated checks listed on the pull request are for our moderators - they are not a verdict on your submission, and you do not need to act on them.',
            '<div class="flex flex-wrap gap-3"><a class="osd-btn-primary text-sm" href="' + safePr + '" target="_blank" rel="noopener noreferrer">View pull request</a><button type="button" id="osd-submit-another" class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">' + esc(againLabel) + '</button></div>'
          );
          var againBtn = document.getElementById('osd-submit-another');
          if (!againBtn) return;
          againBtn.addEventListener('click', function () {
            form.hidden = false;
            form.reset();
            syncPaid();
            if (typeof renderPreview === 'function') renderPreview();
            if (out) out.hidden = true;
            var first = form.querySelector('#title');
            if (first) first.focus();
          });
        }

        // Minimal front-matter reader for prefilling the edit form. Handles the
        // scalar / list / block-scalar shapes used across content/jobs/.
        function parseJobFile(text) {
          return parseFrontMatter(text);
        }

        function setVal(name, v) {
          if (form[name] && v) form[name].value = v;
        }

        function setRadio(name, v) {
          var el = form.querySelector('input[name="' + name + '"][value="' + v + '"]');
          if (el) el.checked = true;
        }

        function setCheckbox(name, checked) {
          var el = form[name];
          if (el) el.checked = !!checked;
        }

        function applyPrefill(parsed) {
          setVal('title', parsed.scalar('title'));
          setVal('organization', parsed.scalar('organization'));
          setVal('org_url', parsed.scalar('org_url'));
          setVal('license', parsed.scalar('license'));
          setVal('role', parsed.scalar('role'));
          setRadio('compensation', parsed.scalar('compensation') === 'paid' ? 'paid' : 'gratis');
          setVal('paid_details', parsed.scalar('paid_details'));
          setVal('rate_min', parsed.scalar('rate_min'));
          setVal('rate_max', parsed.scalar('rate_max'));
          if (parsed.scalar('rate_currency')) setVal('rate_currency', parsed.scalar('rate_currency'));
          if (parsed.scalar('rate_period')) setVal('rate_period', parsed.scalar('rate_period'));
          var dl = parsed.scalar('deadline');
          if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) setVal('deadline', dl);
          setVal('github_handle', parsed.scalar('github_handle'));
          setVal('tags', parsed.list('tags').join(', '));
          var apply = parsed.list('how_to_apply');
          if (!apply.length) apply = parsed.list('contact'); // legacy field name
          setVal('how_to_apply', apply.join('\n'));
          setVal('links', parsed.list('links').join('\n'));
          setVal('deliverables', parsed.block('deliverables'));
          setVal('description', parsed.body);
          var st = parsed.scalar('status').toLowerCase();
          if (st === 'solved' || st === 'resolved' || st === 'completed') st = 'filled'; // legacy values
          setRadio('status', ['searching', 'filled', 'closed'].indexOf(st) >= 0 ? st : 'searching');
          setCheckbox('announce_social', parsed.scalar('announce_social').toLowerCase() !== 'false');
          syncPaid();
        }

        function enterEditMode() {
          var heading = document.getElementById('osd-heading');
          var intro = document.getElementById('osd-intro');
          var crumb = document.getElementById('osd-crumb');
          var submitLabel = document.getElementById('osd-submit-label');
          var banner = document.getElementById('osd-edit-banner');
          var bannerText = document.getElementById('osd-edit-banner-text');
          var statusWrap = document.getElementById('statusWrap');

          if (heading) heading.textContent = 'Edit Job Posting';
          if (intro) intro.textContent = 'Update the details of an existing posting, or mark it as filled or closed. Changes are reviewed by our community moderators before they go live.';
          if (crumb) crumb.textContent = 'Edit posting';
          if (submitLabel) submitLabel.textContent = 'Submit changes';
          if (statusWrap) statusWrap.hidden = false;
          if (banner && bannerText) {
            bannerText.textContent = 'You are editing ' + editFile + '. The live posting stays unchanged until the update is approved.';
            banner.hidden = false;
          }
          // The page title is "Submit a Job | …" (content/jobs/job-form.md).
          document.title = document.title.replace(/^(?:Submit|Post) a Job/, 'Edit Job Posting');

          if (note) note.textContent = 'Loading current posting\u2026';
          var rawURL = repoURL.replace('https://github.com/', 'https://raw.githubusercontent.com/') +
            '/' + repoBranch + '/content/jobs/' + encodeURIComponent(editFile);
          fetch(rawURL)
            .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (text) {
              var parsed = parseJobFile(text);
              if (!parsed) throw new Error('unparseable');
              editMeta = {
                date_posted: parsed.scalar('date_posted'),
                date: parsed.scalar('date'),
                id: parsed.scalar('_id'),
                slug: parsed.scalar('slug'),
                layout: parsed.scalar('layout'),
                aliases: parsed.list('aliases')
              };
              applyPrefill(parsed);
              if (note) note.textContent = '';
            })
            .catch(function () {
              if (note) note.textContent = 'Could not load the current posting; the form starts blank, but submitting will still update the existing file.';
            });
        }

        function generateMarkdown(data, datePosted, isoNow) {
          if (editFile && editMeta) {
            if (editMeta.date_posted) datePosted = editMeta.date_posted;
            if (editMeta.date) isoNow = editMeta.date;
          }
          var urlSlug = slugify(data.title) || 'posting';
          var slug = datePosted + '-' + urlSlug;
          var path = editFile ? 'content/jobs/' + editFile : 'content/jobs/' + slug + '.md';

          var applyList = linesToList(data.how_to_apply);
          var linkList = linesToList(data.links);
          var tagList = tagsToList(data.tags);

          var fm = [];
          fm.push('---');
          fm.push('title: ' + yq(data.title));
          fm.push('status: ' + (editFile ? (data.status || 'searching') : 'searching'));
          fm.push('date_posted: ' + yq(datePosted));
          fm.push('date: ' + yq(isoNow));
          // Same explicit URL slug the Worker writes (it also de-duplicates
          // against existing postings; check /jobs/<slug>/ is free by hand).
          if (!editFile) fm.push('slug: ' + yq(urlSlug));
          if (editFile && editMeta) {
            if (editMeta.id) fm.push('_id: ' + yq(editMeta.id));
            if (editMeta.slug) fm.push('slug: ' + yq(editMeta.slug));
            if (editMeta.layout) fm.push('layout: ' + yq(editMeta.layout));
            if (editMeta.aliases && editMeta.aliases.length) {
              fm.push('aliases:');
              editMeta.aliases.forEach(function (a) { fm.push('  - ' + yq(a)); });
            }
          }
          fm.push('organization: ' + yq(data.organization));
          fm.push('org_url: ' + yq(data.org_url));
          fm.push('license: ' + yq(data.license));
          fm.push('role: ' + yq(data.role));
          fm.push('compensation: ' + yq(data.compensation));
          if (data.paid_details && data.compensation === 'paid') fm.push('paid_details: ' + yq(data.paid_details));
          if (data.rate_min && data.compensation === 'paid') {
            fm.push('rate_min: ' + Number(data.rate_min));
            if (data.rate_max) fm.push('rate_max: ' + Number(data.rate_max));
            fm.push('rate_currency: ' + yq(data.rate_currency || 'USD'));
            fm.push('rate_period: ' + yq(data.rate_period || 'hour'));
          }
          if (data.deadline) fm.push('deadline: ' + yq(data.deadline));
          if (data.github_handle) fm.push('github_handle: ' + yq(data.github_handle));
          if (data.announce_social === false) fm.push('announce_social: false');

          if (tagList.length) {
            fm.push('tags:');
            tagList.forEach(function (t) { fm.push('  - ' + yq(t)); });
          }

          if (applyList.length) {
            fm.push('how_to_apply:');
            applyList.forEach(function (t) { fm.push('  - ' + yq(t)); });
          }

          if (linkList.length) {
            fm.push('links:');
            linkList.forEach(function (t) { fm.push('  - ' + yq(t)); });
          }

          if (data.deliverables) {
            fm.push('deliverables: |-');
            linesToList(data.deliverables).forEach(function (t) { fm.push('  ' + t); });
          }

          fm.push('---');
          fm.push('');
          fm.push(data.description);
          fm.push('');

          return { path: path, markdown: fm.join('\n') };
        }

        // GitHub's new-file editor accepts ?filename= and ?value= to pre-fill
        // the path and contents. For visitors without push access GitHub forks
        // automatically and "Propose new file" leads straight to the PR screen.
        // Returns '' when the encoded URL would exceed GitHub's ~8K URL limit,
        // in which case the copy-paste flow is the only option.
        function githubNewFileURL(gen) {
          var url = repoURL + '/new/' + repoBranch + '?filename=' + encodeURIComponent(gen.path) + '&value=' + encodeURIComponent(gen.markdown);
          return url.length <= 7500 ? url : '';
        }

        function fallbackBodyHTML(gen) {
          var html = '';
          if (editFile) {
            // GitHub's file editor can't be pre-filled via URL, so for edits the
            // fallback is: open the editor, paste the regenerated markdown over it.
            var editURL = repoURL + '/edit/' + repoBranch + '/content/jobs/' + encodeURIComponent(editFile);
            html += '<p><a class="osd-btn-primary text-sm" href="' + editURL + '" target="_blank" rel="noopener noreferrer">Edit the file on GitHub</a></p>';
            html += '<p class="mt-3 text-slate-700">GitHub will fork the repository if needed. Replace the file contents with the markdown below, then press <strong>Propose changes</strong> and <strong>Create pull request</strong>.</p>';
          } else {
            var gh = githubNewFileURL(gen);
            if (gh) {
              html += '<p><a class="osd-btn-primary text-sm" href="' + gh + '" target="_blank" rel="noopener noreferrer">Open a pre-filled pull request on GitHub</a></p>';
              html += '<p class="mt-3 text-slate-700">The file name and contents are already filled in. GitHub will fork the repository if needed; press <strong>Propose new file</strong>, then <strong>Create pull request</strong>. Prefer to do it by hand? The markdown is below.</p>';
            } else {
              html += '<p class="text-slate-700">Copy the markdown below and <a class="font-medium underline underline-offset-4" href="' + repoURL + '/new/' + repoBranch + '?filename=' + encodeURIComponent(gen.path) + '" target="_blank" rel="noopener noreferrer">create a new file on GitHub</a> (the posting is too long for a fully pre-filled link, so paste the contents into the editor).</p>';
            }
          }
          html += '<p class="mt-2 text-slate-700">Suggested path: <code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">' + gen.path + '</code></p>';
          return html;
        }

        form.addEventListener('change', function (e) {
          if (e && e.target && e.target.name === 'compensation') syncPaid();
        });

        form.addEventListener('reset', function () {
          if (out) out.hidden = true;
          if (note) note.textContent = '';
          setTimeout(syncPaid, 0);
        });

        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          if (note) note.textContent = '';

          var honeypot = (form.company || {}).value;
          if (honeypot) return;

          var now = new Date();
          var yyyy = String(now.getFullYear());
          var mm = String(now.getMonth() + 1).padStart(2, '0');
          var dd = String(now.getDate()).padStart(2, '0');
          var datePosted = yyyy + '-' + mm + '-' + dd;
          var isoNow = now.toISOString();

          var data = {
            title: form.title.value.trim(),
            organization: form.organization.value.trim(),
            org_url: form.org_url.value.trim(),
            license: form.license.value.trim(),
            role: form.role.value.trim(),
            compensation: getRadio('compensation'),
            paid_details: (form.paid_details || {}).value ? form.paid_details.value.trim() : '',
            rate_min: (form.rate_min || {}).value ? form.rate_min.value.trim() : '',
            rate_max: (form.rate_max || {}).value ? form.rate_max.value.trim() : '',
            rate_currency: (form.rate_currency || {}).value || 'USD',
            rate_period: (form.rate_period || {}).value || 'hour',
            deadline: (form.deadline || {}).value || '',
            description: form.description.value.trim(),
            deliverables: form.deliverables.value.trim(),
            how_to_apply: form.how_to_apply.value.trim(),
            links: form.links.value.trim(),
            github_handle: form.github_handle.value.trim(),
            email: (form.email || {}).value ? form.email.value.trim() : '',
            tags: form.tags.value.trim(),
            announce_social: !!(form.announce_social && form.announce_social.checked),
            date_posted: datePosted
          };
          if (editFile) {
            data.edit_file = editFile;
            // Only send a status when the original loaded; otherwise the worker
            // keeps the current one (prevents accidentally reopening a solved job).
            if (editMeta) data.status = getRadio('status') || 'searching';
          }
          if (allowDuplicate) data.force_duplicate = true;

          if (!data.organization || !data.org_url || !data.license || !data.title || !data.role || !data.description || !data.how_to_apply) {
            if (note) note.textContent = 'Please fill in all required fields.';
            return;
          }

          if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
            if (note) note.textContent = 'Please enter a valid email address, or leave it blank.';
            return;
          }

          // A posting that is (or stays) open can't have a past deadline -
          // it would expire again immediately.
          var willBeOpen = editFile ? getRadio('status') === 'searching' : true;
          if (willBeOpen && data.deadline && data.deadline < datePosted) {
            if (note) note.textContent = editFile
              ? 'This job is still marked as searching, but the application deadline is in the past. Update or clear the deadline first.'
              : 'The application deadline cannot be in the past.';
            return;
          }

          if (data.rate_min && data.rate_max && Number(data.rate_max) < Number(data.rate_min)) {
            if (note) note.textContent = 'The "To" rate cannot be lower than the "From" rate.';
            return;
          }

          if (endpoint) {
            try {
              if (submitBtn) submitBtn.disabled = true;
              if (note) note.textContent = 'Submitting…';

              var turnstileToken = await freshTurnstileToken();
              if (turnstileBox && !turnstileToken) {
                if (note) note.textContent = 'Please complete the captcha check, then submit again.';
                return;
              }

              var resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  company: honeypot,
                  turnstile_token: turnstileToken,
                  ...data
                }),
                mode: 'cors'
              });

              var json = await resp.json().catch(function () { return null; });

              // Possible duplicate: the worker found a very similar open
              // posting. Show it and let the submitter confirm.
              if (resp.status === 409 && json && json.duplicate) {
                if (note) note.textContent = 'Possible duplicate found - please check below.';
                out.classList.remove('border-emerald-200', 'bg-emerald-50', 'border-slate-200', 'bg-white');
                out.classList.add('border-amber-300', 'bg-amber-50');
                var dupTitle = esc(String(json.duplicate.title || ''));
                var dupOrg = esc(String(json.duplicate.organization || ''));
                showResult(
                  'Is this the same job?',
                  'A very similar posting is already open: <a class="font-medium underline underline-offset-4" href="' + encodeURI(String(json.duplicate.url || '')) + '" target="_blank" rel="noopener noreferrer">' + dupTitle + '</a>' + (dupOrg ? ' - ' + dupOrg : '') + '. If you want to update that posting instead, use its "Suggest an edit" link. If yours is genuinely a different job, post it anyway.',
                  '<button type="button" id="osd-dup-anyway" class="mt-3 inline-flex items-center rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100">Post anyway</button>'
                );
                var dupBtn = document.getElementById('osd-dup-anyway');
                if (dupBtn) dupBtn.addEventListener('click', function () {
                  allowDuplicate = true;
                  out.hidden = true;
                  out.classList.remove('border-amber-300', 'bg-amber-50');
                  form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
                });
                return;
              }

              if (resp.ok && json && json.ok && json.pr_url) {
                if (note) note.textContent = 'Submitted.';
                if (editFile) {
                  out.classList.remove('border-amber-300', 'bg-amber-50', 'border-slate-200', 'bg-white');
                  out.classList.add('border-emerald-200', 'bg-emerald-50');
                  showResult(
                    'Thanks - your changes were received',
                    'A pull request was created for moderation: <a class="font-medium underline underline-offset-4 hover:text-emerald-700" href="' + esc(json.pr_url) + '" target="_blank" rel="noopener noreferrer">' + esc(json.pr_url) + '</a>',
                    ''
                  );
                  return;
                }
                showSubmissionSuccess(json.pr_url, 'Thanks - submission received', 'Post another job');
                return;
              }

              var msg = (json && json.error) ? String(json.error) : 'Submission failed.';
              throw new Error(msg);
            } catch (err) {
              if (note) note.textContent = 'Could not submit automatically' + (err && err.message ? ' (' + err.message + ')' : '') + '. Try again, or use the fallback below.';
              out.classList.remove('border-emerald-200', 'bg-emerald-50');
              out.classList.add('border-slate-200', 'bg-white');

              var gen = generateMarkdown(data, datePosted, isoNow);
              showResult(
                'Fallback: open the pull request yourself',
                fallbackBodyHTML(gen),
                '<textarea class="mt-3 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-900/20" aria-label="Generated job posting markdown" readonly>' + gen.markdown.replace(/</g,'&lt;') + '</textarea>'
              );
              return;
            } finally {
              if (submitBtn) submitBtn.disabled = false;
              resetTurnstile();
            }
          }

          out.classList.remove('border-emerald-200', 'bg-emerald-50');
          out.classList.add('border-slate-200', 'bg-white');

          var gen2 = generateMarkdown(data, datePosted, isoNow);
          showResult(
            'Open the pull request on GitHub',
            fallbackBodyHTML(gen2),
            '<textarea class="mt-3 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-900/20" aria-label="Generated job posting markdown" readonly>' + gen2.markdown.replace(/</g,'&lt;') + '</textarea>'
          );
        });

        // ── Live preview ────────────────────────────────────────────────────
        var pv = document.getElementById('osd-preview');
        var pvBtn = document.getElementById('osd-preview-btn');
        var pvClose = document.getElementById('osd-preview-close');

        function esc(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Inline markdown: code, bold, italic, [text](url), bare URLs.
        function mdInline(s) {
          return s
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
        }

        // Block-level markdown subset matching what job descriptions use:
        // headings, unordered/ordered lists, paragraphs. Input is escaped
        // first, so only markup we generate reaches innerHTML.
        function mdToHtml(md) {
          var lines = esc(md).split(/\r?\n/);
          var html = [];
          var list = null; // 'ul' | 'ol'
          var para = [];
          function flushPara() {
            if (para.length) { html.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; }
          }
          function flushList() {
            if (list) { html.push('</' + list + '>'); list = null; }
          }
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var h = line.match(/^(#{1,6})\s+(.*)$/);
            var ul = line.match(/^\s*[-*+]\s+(.*)$/);
            var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (h) {
              flushPara(); flushList();
              var level = Math.min(h[1].length + 2, 6); // # -> h3 inside the card
              html.push('<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>');
            } else if (ul || ol) {
              flushPara();
              var want = ul ? 'ul' : 'ol';
              if (list !== want) { flushList(); html.push('<' + want + '>'); list = want; }
              html.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
            } else if (!line.trim()) {
              flushPara(); flushList();
            } else {
              flushList();
              para.push(line.trim());
            }
          }
          flushPara(); flushList();
          return html.join('\n');
        }

        function humanDate(iso) {
          return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        }

        function setMeta(id, text) {
          var el = document.getElementById(id);
          el.hidden = !text;
          if (text) el.querySelector('span').textContent = text;
        }

        // Icons reused across the sidebar replica.
        var ICON_EXT = '<svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>';
        var ICON_MAIL = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>';
        var ICON_GH = '<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.06 11.06 0 015.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0023.5 12c0-6.27-5.23-11.5-11.5-11.5z"/></svg>';
        var ICON_LINK = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>';
        var ICON_CHECK = '<svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

        function hostOf(url) {
          return url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
        }

        // Mirrors the contact classification in partials/job-apply.html.
        function classifyApply(lines) {
          var contacts = [];
          var notes = [];
          lines.forEach(function (line) {
            var emails = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emails) {
              var email = emails[0];
              var label = line.replace(/<[^>]*>/g, '').replace(email, '').replace(/^[\s:<>\-(),]+|[\s:<>\-(),]+$/g, '');
              if (label.length > 48) { notes.push(line); label = ''; }
              if (!label) label = email;
              contacts.push({ icon: ICON_MAIL, label: label, sub: label === email ? 'Email' : email });
            } else if (/^(https?:\/\/|www\.)/.test(line)) {
              var url = line.split(/\s/)[0].replace(/[).,;:!?>'"]+$/, '');
              if (/^www\./.test(url)) url = 'https://' + url;
              contacts.push({ icon: /(^|\.)github\.com$/.test(hostOf(url)) ? ICON_GH : ICON_LINK, label: hostOf(url), sub: line });
            } else if (/^@[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(line)) {
              contacts.push({ icon: ICON_GH, label: line, sub: 'GitHub' });
            } else if (/github/i.test(line) && /@[A-Za-z0-9][A-Za-z0-9-]{0,38}/.test(line) && line.length < 60) {
              contacts.push({ icon: ICON_GH, label: line.match(/@[A-Za-z0-9][A-Za-z0-9-]{0,38}/)[0], sub: 'GitHub' });
            } else {
              notes.push(line);
            }
          });
          return { contacts: contacts, notes: notes };
        }

        function detailRow(dt, ddHtml) {
          return '<div><dt class="text-slate-500">' + dt + '</dt>' + ddHtml + '</div>';
        }

        function renderPreview() {
          var title = form.title.value.trim() || 'Your job title';
          var org = form.organization.value.trim();
          var role = form.role ? String(form.role.value || '').trim() : '';
          var comp = getRadio('compensation');
          var isPaid = comp === 'paid';
          var deadline = (form.deadline || {}).value || '';
          var postedISO = (editMeta && editMeta.date_posted) || new Date().toISOString().slice(0, 10);
          var status = editFile ? (getRadio('status') || 'searching') : 'searching';

          document.getElementById('osd-pv-crumb').textContent = title;
          document.getElementById('osd-pv-title').textContent = title;

          // Status + compensation badges (classes copied from single.html / badge.html).
          var badges = [];
          if (status === 'searching') {
            badges.push('<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>Open</span>');
          } else {
            badges.push('<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 ring-1 ring-inset ring-slate-500/20">' + esc(status) + '</span>');
          }
          badges.push(isPaid
            ? '<span class="inline-flex shrink-0 items-center gap-1 rounded-full font-medium px-2.5 py-1 text-xs bg-emerald-100 text-emerald-800"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>Paid</span>'
            : '<span class="inline-flex shrink-0 items-center gap-1 rounded-full font-medium px-2.5 py-1 text-xs bg-violet-100 text-violet-800"><span class="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden="true"></span>Volunteer</span>');
          document.getElementById('osd-pv-badges').innerHTML = badges.join('');

          setMeta('osd-pv-m-org', org);
          setMeta('osd-pv-m-role', role);
          setMeta('osd-pv-m-posted', 'Posted ' + humanDate(postedISO));
          setMeta('osd-pv-m-deadline', deadline ? 'Apply by ' + humanDate(deadline) : '');

          document.getElementById('osd-pv-content').innerHTML =
            mdToHtml(form.description.value.trim() || '*The job description will appear here.*');

          // Deliverables card (checkmark list, like single.html).
          var dels = linesToList(form.deliverables.value).map(function (x) { return x.replace(/^[-•\s]+/, ''); }).filter(Boolean);
          document.getElementById('osd-pv-deliverables-wrap').hidden = !dels.length;
          document.getElementById('osd-pv-deliverables').innerHTML = dels.map(function (x) {
            return '<li class="flex items-start gap-2.5">' + ICON_CHECK + '<span>' + mdInline(esc(x)) + '</span></li>';
          }).join('');

          // Related links.
          var links = linesToList(form.links.value);
          document.getElementById('osd-pv-links-wrap').hidden = !links.length;
          document.getElementById('osd-pv-links').innerHTML = links.map(function (x) {
            return '<li class="break-words">' + mdInline(esc(x)) + '</li>';
          }).join('');

          // Tags chips.
          var tags = tagsToList(form.tags.value);
          document.getElementById('osd-pv-tags-wrap').hidden = !tags.length;
          document.getElementById('osd-pv-tags').innerHTML = tags.map(function (t) {
            return '<span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">' + esc(t) + '</span>';
          }).join('');

          // How to apply: contact buttons + prose notes, like job-apply.html.
          var parsed = classifyApply(linesToList(form.how_to_apply.value));
          var applyList = document.getElementById('osd-pv-apply');
          var applyNotes = document.getElementById('osd-pv-apply-notes');
          var applyFallback = document.getElementById('osd-pv-apply-fallback');
          applyList.hidden = !parsed.contacts.length;
          applyList.innerHTML = parsed.contacts.map(function (c) {
            return '<li><span class="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">'
              + '<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">' + c.icon + '</span>'
              + '<span class="min-w-0 flex-1">'
              + '<span class="block truncate font-semibold text-slate-900 underline decoration-slate-300 decoration-1 underline-offset-2">' + esc(c.label) + '</span>'
              + (c.sub ? '<span class="block truncate text-xs text-slate-500">' + esc(c.sub) + '</span>' : '')
              + '</span>'
              + '<svg class="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>'
              + '</span></li>';
          }).join('');
          applyNotes.hidden = !parsed.notes.length;
          applyNotes.className = (parsed.contacts.length ? 'mt-4 border-t border-slate-100 pt-4 ' : '') + 'space-y-2 text-sm leading-relaxed text-slate-600';
          applyNotes.innerHTML = parsed.notes.map(function (n) { return '<p>' + mdInline(esc(n)) + '</p>'; }).join('');
          applyFallback.hidden = !!(parsed.contacts.length || parsed.notes.length);

          // Details card rows (mirrors the dl in single.html).
          var rows = [];
          rows.push(detailRow('Compensation',
            '<dd class="mt-1 inline-flex items-center gap-1.5 font-medium text-slate-900"><span class="h-2 w-2 rounded-full ' + (isPaid ? 'bg-emerald-500' : 'bg-violet-500') + '"></span>' + (isPaid ? 'Paid' : 'Volunteer') + '</dd>'));
          var rmin = (form.rate_min || {}).value;
          var rmax = (form.rate_max || {}).value;
          if (isPaid && rmin) {
            var cur = (form.rate_currency || {}).value || 'USD';
            var sym = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', INR: '\u20b9' }[cur] || '';
            rows.push(detailRow('Rate',
              '<dd class="mt-1 font-medium text-slate-900">' + (sym || '') + esc(rmin) + (rmax ? '\u2013' + esc(rmax) : '') + (sym ? '' : '\u00a0' + cur)
              + ' <span class="font-normal text-slate-500">per ' + esc((form.rate_period || {}).value || 'hour') + '</span></dd>'));
          }
          var pd = (form.paid_details || {}).value ? form.paid_details.value.trim() : '';
          if (isPaid && pd) {
            rows.push(detailRow(rmin ? 'Notes' : 'Budget / rate', '<dd class="mt-1 font-medium text-slate-900">' + esc(pd) + '</dd>'));
          }
          if (deadline) {
            rows.push(detailRow('Apply by', '<dd class="mt-1 font-medium text-slate-900"><time datetime="' + esc(deadline) + '">' + humanDate(deadline) + '</time></dd>'));
          }
          if (org) {
            var orgUrl = form.org_url.value.trim().split(/[\s,]/)[0];
            var orgLink = orgUrl ? '<dd class="mt-1"><span class="inline-flex items-center gap-1 text-slate-600 underline decoration-slate-300 underline-offset-4 break-all">' + esc(hostOf(orgUrl)) + ICON_EXT + '</span></dd>' : '';
            rows.push(detailRow('Project', '<dd class="mt-1 font-medium text-slate-900">' + esc(org) + '</dd>' + orgLink));
          }
          if (form.license.value.trim()) {
            rows.push(detailRow('License', '<dd class="mt-1"><span class="inline-flex items-center gap-1 text-slate-600 underline decoration-slate-300 underline-offset-4">View license' + ICON_EXT + '</span></dd>'));
          }
          if (role) rows.push(detailRow('Category', '<dd class="mt-1 font-medium text-slate-900">' + esc(role) + '</dd>'));
          rows.push(detailRow('Posted', '<dd class="mt-1 font-medium text-slate-900"><time datetime="' + esc(postedISO) + '">' + humanDate(postedISO) + '</time></dd>'));
          var gh = form.github_handle.value.trim();
          if (gh) {
            var handle = (gh.match(/@?([A-Za-z0-9][A-Za-z0-9-]{0,38})/) || [])[1] || gh;
            rows.push(detailRow('Posted by', '<dd class="mt-1"><span class="inline-flex items-center gap-1.5 font-medium text-slate-700">' + ICON_GH + '@' + esc(handle) + '</span></dd>'));
          }
          document.getElementById('osd-pv-details').innerHTML = rows.join('');
        }

        if (pvBtn && pv) {
          // Re-parent to <body>: an ancestor of the form creates a stacking
          // context, so left in place the overlay would paint below the sticky
          // site header regardless of its own z-index.
          document.body.appendChild(pv);
          // Everything else on the page is made inert while the dialog is
          // open, so Tab and screen-reader navigation stay inside it.
          function setBackgroundInert(on) {
            Array.prototype.forEach.call(document.body.children, function (el) {
              if (el === pv || /^(script|style|link)$/i.test(el.tagName)) return;
              if (on) el.setAttribute('inert', '');
              else el.removeAttribute('inert');
            });
          }
          pvBtn.addEventListener('click', function () {
            renderPreview();
            pv.hidden = false;
            pv.scrollTop = 0;
            pvBtn.setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden';
            setBackgroundInert(true);
            if (pvClose) pvClose.focus();
          });
          function closePreview() {
            pv.hidden = true;
            pvBtn.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
            setBackgroundInert(false);
            pvBtn.focus();
          }
          if (pvClose) pvClose.addEventListener('click', closePreview);
          document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !pv.hidden) closePreview();
          });
        }

        syncPaid();
        if (editFile) enterEditMode();

}
