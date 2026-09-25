import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionMeta } from './submission-meta.mjs';
import { MARKER, checkResult, latestRuns, previewState, renderStatus } from './submission-status-render.mjs';

const done = (conclusion) => ({ status: 'completed', conclusion });
const item = {
  title: 'UX Designer', rows: [['Organization', 'Org | Inc']],
  file: 'content/jobs/2026-09-25-ux-designer.md', liveUrl: 'https://opensourcedesign.net/jobs/ux-designer/',
};

test('open submission: reassures the submitter and folds checks away', () => {
  const body = renderStatus({
    meta: submissionMeta('job/2026-09-25-ux-designer-abc123'),
    state: 'open',
    preview: { state: 'ready', url: 'https://opensourcedesign.net/pr-preview/pr-7/jobs/ux-designer/' },
    checks: { lint: done('success'), 'build-preview': done('success'), a11y: done('failure') },
    items: [item],
  });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /Thanks for your job posting!/);
  assert.match(body, /nothing else is needed from you right now/);
  assert.match(body, /\[See how your job posting will look\]\(https:\/\/opensourcedesign\.net\/pr-preview\/pr-7\/jobs\/ux-designer\/\)/);
  assert.match(body, /<details>[\s\S]*does not mean your submission was rejected/);
  assert.match(body, /\| Accessibility \(sample of site pages\) \| ❌ Needs a look \|/);
  assert.match(body, /\| Repository checks \| ⏳ Waiting to start \|/);
  assert.match(body, /Org \\\| Inc/);
  assert.doesNotMatch(body, /formatting issue/);
});

test('lint failure: tells the submitter a moderator will fix it and lists the issues', () => {
  const body = renderStatus({
    meta: submissionMeta('event/2027-01-30-fosdem-xyz'),
    state: 'open',
    preview: { state: 'building' },
    checks: { lint: done('failure') },
    lintErrors: ['front matter: `status` is required'],
    items: [],
  });
  assert.match(body, /Thanks for your event!/);
  assert.match(body, /You don't need to do anything - a moderator will fix it/);
  assert.match(body, /- front matter: `status` is required/);
  assert.match(body, /Being built - usually ready in 2-3 minutes/);
});

test('merged and closed states', () => {
  const merged = renderStatus({ meta: submissionMeta('resource/penpot-1'), state: 'merged', preview: { state: 'none' }, checks: {}, items: [item] });
  assert.match(merged, /Your resource suggestion was approved/);
  assert.match(merged, /live within a few minutes at https:\/\/opensourcedesign\.net\/jobs\/ux-designer\//);
  assert.doesNotMatch(merged, /<details>/);
  const closed = renderStatus({ meta: submissionMeta('job-edit/x'), state: 'closed', preview: { state: 'none' }, checks: {}, items: [], formUrl: 'https://opensourcedesign.net/jobs/job-form/' });
  assert.match(closed, /job posting update was closed without publishing/);
  assert.match(closed, /\[job form\]\(https:\/\/opensourcedesign\.net\/jobs\/job-form\/\)/);
});

test('checkResult and previewState map check runs', () => {
  assert.equal(checkResult(undefined), '⏳ Waiting to start');
  assert.equal(checkResult({ status: 'in_progress' }), '⏳ Running');
  assert.equal(checkResult(done('skipped')), '➖ Not needed for this change');
  assert.equal(previewState({ 'deploy-preview': done('success') }, 'open'), 'deployed');
  assert.equal(previewState({ 'build-preview': done('failure') }, 'open'), 'failed');
  assert.equal(previewState({ 'build-preview': { status: 'in_progress' } }, 'open'), 'building');
  assert.equal(previewState({ 'deploy-preview': done('success') }, 'merged'), 'none');
});

test('latestRuns keeps the most recent run per check name', () => {
  const runs = latestRuns([
    { id: 1, name: 'lint', started_at: '2026-09-25T10:00:00Z', conclusion: 'failure' },
    { id: 2, name: 'lint', started_at: '2026-09-25T11:00:00Z', conclusion: 'success' },
    { id: 3, name: 'a11y', started_at: '2026-09-25T10:00:00Z', conclusion: 'success' },
  ]);
  assert.equal(runs.lint.id, 2);
  assert.equal(runs.a11y.id, 3);
});
