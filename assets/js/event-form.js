/** Generated from layouts/events/event-form.html — edit the layout or re-run extract-form-js.mjs. */
import { parseFrontMatter } from './yaml-front-matter.js';
export function init(cfg) {
  cfg = cfg || {};
  var endpoint = cfg.endpoint || '';
  var repoURL = cfg.repoURL || '';
  var repoBranch = cfg.repoBranch || 'main';
var form = document.getElementById('osd-event-form');
        if (!form) return;

        // Edit mode: ?edit=<file>.md prefills the form from the existing
        // event and submits an update to that file instead of a new one.
        var editFile = '';
        try {
          var editParam = new URLSearchParams(window.location.search).get('edit') || '';
          if (/^[\w .,()&+'-]+\.md$/.test(editParam) && editParam.indexOf('..') === -1) editFile = editParam;
        } catch (e) { /* no URLSearchParams: edit mode unavailable */ }
        var editMeta = null;        // identity fields parsed from the original file
        var editSendStatus = false; // only offer/send status for non-past events

        var note = document.getElementById('osd-form-note');
        var out = document.getElementById('osd-result');
        var outTitle = document.getElementById('osd-result-title');
        var outBody = document.getElementById('osd-result-body');
        var outExtra = document.getElementById('osd-result-extra');
        var submitBtn = document.getElementById('osd-submit');

        // Turnstile tokens are single-use: the Worker spends one on every
        // request, whatever the outcome. Reset the widget after each attempt
        // and wait for a fresh token, so a retry doesn't fail with
        // "Captcha verification failed".
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
          str = str.replace(/\s+/g, '-').replace(/-+/g, '-');
          return str;
        }

        function yq(v) {
          var s = String(v == null ? '' : v);
          s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return '"' + s + '"';
        }

        // Human-readable date range in the site's eventDate style,
        // e.g. "1 February 2027", "1–2 February 2027", "28 February – 1 March 2027".
        function formatEventDate(startISO, endISO) {
          var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          function parts(iso) {
            var m = String(iso).split('-');
            return { y: +m[0], mo: +m[1], d: +m[2] };
          }
          var s = parts(startISO);
          var e = endISO ? parts(endISO) : s;
          if (s.y === e.y && s.mo === e.mo && s.d === e.d) return s.d + ' ' + months[s.mo - 1] + ' ' + s.y;
          if (s.y === e.y && s.mo === e.mo) return s.d + '\u2013' + e.d + ' ' + months[s.mo - 1] + ' ' + s.y;
          if (s.y === e.y) return s.d + ' ' + months[s.mo - 1] + ' \u2013 ' + e.d + ' ' + months[e.mo - 1] + ' ' + s.y;
          return s.d + ' ' + months[s.mo - 1] + ' ' + s.y + ' \u2013 ' + e.d + ' ' + months[e.mo - 1] + ' ' + e.y;
        }

        function escHTML(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
          var safePr = escHTML(String(prUrl || ''));
          form.hidden = true;
          if (note) note.textContent = '';
          out.classList.remove('border-slate-200', 'bg-white');
          out.classList.add('border-emerald-200', 'bg-emerald-50');
          showResult(
            heading,
            'Your event submission is in the moderation queue. Track progress in <a class="font-medium underline underline-offset-4 hover:text-emerald-700" href="' + safePr + '" target="_blank" rel="noopener noreferrer">this pull request</a>.',
            '<div class="flex flex-wrap gap-3"><a class="osd-btn-primary text-sm" href="' + safePr + '" target="_blank" rel="noopener noreferrer">View pull request</a><button type="button" id="osd-submit-another" class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">' + escHTML(againLabel) + '</button></div>'
          );
          var againBtn = document.getElementById('osd-submit-another');
          if (!againBtn) return;
          againBtn.addEventListener('click', function () {
            form.hidden = false;
            form.reset();
            if (out) out.hidden = true;
            var first = form.querySelector('#title');
            if (first) first.focus();
          });
        }

        function getRadio(name) {
          var el = form.querySelector('input[name="' + name + '"]:checked');
          return el ? el.value : '';
        }

        // Minimal front-matter reader for prefilling the edit form. Handles the
        // scalar / block-list shapes used across content/events/.
        function parseEventFile(text) {
          return parseFrontMatter(text);
        }

        function setVal(name, v) {
          if (form[name] && v) form[name].value = v;
        }

        function setRadio(name, v) {
          var el = form.querySelector('input[name="' + name + '"][value="' + v + '"]');
          if (el) el.checked = true;
        }

        function applyPrefill(parsed) {
          setVal('title', parsed.scalar('title'));
          setVal('location', parsed.scalar('location'));
          setVal('time', parsed.scalar('time'));
          var isIso = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); };
          var start = parsed.scalar('eventStart');
          var end = parsed.scalar('endDate');
          if (isIso(start)) {
            setVal('start_date', start);
            if (isIso(end) && end !== start) setVal('end_date', end);
          }
          // Pull a trailing "More information: <url>" line back into the
          // website field so it isn't duplicated on resubmit.
          var body = parsed.body;
          var mm = body.match(/\n*More information: <(https?:\/\/[^>\s]+)>\s*$/);
          if (mm) {
            setVal('website', mm[1]);
            body = body.slice(0, mm.index).trim();
          }
          setVal('description', body);
          var st = parsed.scalar('status').toLowerCase();
          if (st === 'past') {
            // Historical event: keep its status untouched and hide the picker.
            var statusWrap = document.getElementById('statusWrap');
            if (statusWrap) statusWrap.hidden = true;
            editSendStatus = false;
          } else {
            setRadio('status', st === 'cancelled' ? 'cancelled' : 'upcoming');
            editSendStatus = true;
          }
        }

        function enterEditMode() {
          var heading = document.getElementById('osd-heading');
          var intro = document.getElementById('osd-intro');
          var crumb = document.getElementById('osd-crumb');
          var submitLabel = document.getElementById('osd-submit-label');
          var banner = document.getElementById('osd-edit-banner');
          var bannerText = document.getElementById('osd-edit-banner-text');
          var statusWrap = document.getElementById('statusWrap');

          if (heading) heading.textContent = 'Edit Event';
          if (intro) intro.textContent = 'Update the details of an existing event, or mark it as cancelled. Changes are reviewed by our community moderators before they go live.';
          if (crumb) crumb.textContent = 'Edit event';
          if (submitLabel) submitLabel.textContent = 'Submit changes';
          if (statusWrap) statusWrap.hidden = false;
          if (banner && bannerText) {
            bannerText.textContent = 'You are editing ' + editFile + '. The live event stays unchanged until the update is approved.';
            banner.hidden = false;
          }
          document.title = document.title.replace(/^Submit an Event/, 'Edit Event');

          if (note) note.textContent = 'Loading current event\u2026';
          var rawURL = repoURL.replace('https://github.com/', 'https://raw.githubusercontent.com/') +
            '/' + repoBranch + '/content/events/' + encodeURIComponent(editFile);
          fetch(rawURL)
            .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (text) {
              var parsed = parseEventFile(text);
              if (!parsed) throw new Error('unparseable');
              editMeta = {
                date: parsed.scalar('date'),
                status: parsed.scalar('status'),
                id: parsed.scalar('_id'),
                slug: parsed.scalar('slug'),
                layout: parsed.scalar('layout'),
                url: parsed.scalar('url'),
                permalink: parsed.scalar('permalink'),
                author: parsed.scalar('author'),
                recurrence: parsed.scalar('recurrence'),
                aliases: parsed.list('aliases'),
                categories: parsed.list('categories')
              };
              if (!editMeta.categories.length) {
                var rawCats = parsed.scalar('categories');
                if (rawCats) editMeta.categories = rawCats.split(/[,\s]+/).filter(Boolean);
              }
              applyPrefill(parsed);
              if (note) note.textContent = '';
            })
            .catch(function () {
              if (note) note.textContent = 'Could not load the current event; the form starts blank, but submitting will still update the existing file.';
            });
        }

        function generateMarkdown(data, isoNow) {
          if (editFile && editMeta && editMeta.date) isoNow = editMeta.date;
          var slug = data.start_date + '-' + slugify(data.title);
          var path = editFile ? 'content/events/' + editFile : 'content/events/' + slug + '.md';

          var fm = [];
          fm.push('---');
          fm.push('layout: ' + yq((editFile && editMeta && editMeta.layout) ? editMeta.layout : 'event'));
          fm.push('title: ' + yq(data.title));
          fm.push('status: ' + (editFile ? (data.status || (editMeta && editMeta.status) || 'upcoming') : 'upcoming'));
          fm.push('date: ' + yq(isoNow));
          if (editFile && editMeta) {
            if (editMeta.id) fm.push('_id: ' + yq(editMeta.id));
            if (editMeta.slug) fm.push('slug: ' + yq(editMeta.slug));
            if (editMeta.url) fm.push('url: ' + yq(editMeta.url));
            if (editMeta.permalink) fm.push('permalink: ' + yq(editMeta.permalink));
            if (editMeta.author) fm.push('author: ' + yq(editMeta.author));
            if (editMeta.recurrence) fm.push('recurrence: ' + yq(editMeta.recurrence));
            if (editMeta.aliases && editMeta.aliases.length) {
              fm.push('aliases:');
              editMeta.aliases.forEach(function (a) { fm.push('  - ' + yq(a)); });
            }
            if (editMeta.categories && editMeta.categories.length) {
              fm.push('categories:');
              editMeta.categories.forEach(function (c) { fm.push('  - ' + yq(c)); });
            }
          }
          fm.push('eventDate: ' + yq(formatEventDate(data.start_date, data.end_date)));
          fm.push('eventStart: ' + yq(data.start_date));
          fm.push('endDate: ' + yq(data.end_date || data.start_date));
          if (data.time) fm.push('time: ' + yq(data.time));
          fm.push('location: ' + yq(data.location));
          fm.push('---');
          fm.push('');
          fm.push(data.description);
          if (data.website) {
            fm.push('');
            fm.push('More information: <' + data.website + '>');
          }
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
            var editURL = repoURL + '/edit/' + repoBranch + '/content/events/' + encodeURIComponent(editFile);
            html += '<p><a class="osd-btn-primary text-sm" href="' + editURL + '" target="_blank" rel="noopener noreferrer">Edit the file on GitHub</a></p>';
            html += '<p class="mt-3 text-slate-700">GitHub will fork the repository if needed. Replace the file contents with the markdown below, then press <strong>Propose changes</strong> and <strong>Create pull request</strong>.</p>';
          } else {
            var gh = githubNewFileURL(gen);
            if (gh) {
              html += '<p><a class="osd-btn-primary text-sm" href="' + gh + '" target="_blank" rel="noopener noreferrer">Open a pre-filled pull request on GitHub</a></p>';
              html += '<p class="mt-3 text-slate-700">The file name and contents are already filled in. GitHub will fork the repository if needed; press <strong>Propose new file</strong>, then <strong>Create pull request</strong>. Prefer to do it by hand? The markdown is below.</p>';
            } else {
              html += '<p class="text-slate-700">Copy the markdown below and <a class="font-medium underline underline-offset-4" href="' + repoURL + '/new/' + repoBranch + '?filename=' + encodeURIComponent(gen.path) + '" target="_blank" rel="noopener noreferrer">create a new file on GitHub</a> (the event is too long for a fully pre-filled link, so paste the contents into the editor).</p>';
            }
          }
          html += '<p class="mt-2 text-slate-700">Suggested path: <code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">' + gen.path + '</code></p>';
          return html;
        }

        form.addEventListener('reset', function () {
          if (out) out.hidden = true;
          if (note) note.textContent = '';
        });

        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          if (note) note.textContent = '';

          var honeypot = (form.company || {}).value;
          if (honeypot) return;

          var isoNow = new Date().toISOString();

          var data = {
            kind: 'event',
            title: form.title.value.trim(),
            website: form.website.value.trim(),
            location: form.location.value.trim(),
            start_date: form.start_date.value,
            end_date: form.end_date.value,
            time: form.time.value.trim(),
            description: form.description.value.trim(),
            email: (form.email || {}).value ? form.email.value.trim() : ''
          };
          if (editFile) {
            data.edit_file = editFile;
            // Only send a status when the original loaded and isn't a past
            // event; otherwise the worker keeps the current value.
            if (editMeta && editSendStatus) data.status = getRadio('status') || 'upcoming';
          }

          if (!data.title || !data.location || !data.start_date || !data.description) {
            if (note) note.textContent = 'Please fill in all required fields.';
            return;
          }

          if (data.end_date && data.end_date < data.start_date) {
            if (note) note.textContent = 'The end date cannot be before the start date.';
            return;
          }

          if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
            if (note) note.textContent = 'Please enter a valid email address, or leave it blank.';
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

              if (resp.ok && json && json.ok && json.pr_url) {
                if (note) note.textContent = 'Submitted.';
                if (editFile) {
                  showResult(
                    'Thanks - your changes were received',
                    'A pull request was created for moderation: <a class="font-medium underline underline-offset-4 hover:text-emerald-700" href="' + escHTML(json.pr_url) + '" target="_blank" rel="noopener noreferrer">' + escHTML(json.pr_url) + '</a>',
                    ''
                  );
                  return;
                }
                showSubmissionSuccess(json.pr_url, 'Thanks - submission received', 'Add another event');
                return;
              }

              var msg = (json && json.error) ? String(json.error) : 'Submission failed.';
              throw new Error(msg);
            } catch (err) {
              if (note) note.textContent = 'Could not submit automatically' + (err && err.message ? ' (' + err.message + ')' : '') + '. Try again, or use the fallback below.';
              out.classList.remove('border-emerald-200', 'bg-emerald-50');
              out.classList.add('border-slate-200', 'bg-white');

              var gen = generateMarkdown(data, isoNow);
              showResult(
                'Fallback: open the pull request yourself',
                fallbackBodyHTML(gen),
                '<textarea class="mt-3 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-900/20" aria-label="Generated event markdown" readonly>' + gen.markdown.replace(/</g,'&lt;') + '</textarea>'
              );
              return;
            } finally {
              if (submitBtn) submitBtn.disabled = false;
              resetTurnstile();
            }
          }

          out.classList.remove('border-emerald-200', 'bg-emerald-50');
          out.classList.add('border-slate-200', 'bg-white');

          var gen2 = generateMarkdown(data, isoNow);
          showResult(
            'Open the pull request on GitHub',
            fallbackBodyHTML(gen2),
            '<textarea class="mt-3 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-900/20" aria-label="Generated event markdown" readonly>' + gen2.markdown.replace(/</g,'&lt;') + '</textarea>'
          );
        });

        if (editFile) enterEditMode();

}
