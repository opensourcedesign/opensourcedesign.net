/**
 * Renders the single status comment the bot keeps on a form submission PR
 * (job, event or resource). Pure functions only - submission-status.mjs
 * gathers the state from the GitHub API and posts the result.
 *
 * The comment is written for two readers: the person who used the form (who
 * usually doesn't know GitHub and shouldn't read a red check as "rejected"),
 * and the moderators (who get the check results and details, folded away).
 */

export const MARKER = '<!-- submission-status -->';
// Comments posted by the previous submission-preview-comment.mjs; the status
// comment takes them over instead of adding a second bot comment.
export const LEGACY_MARKERS = ['<!-- submission-preview -->'];

/** Check runs shown in the moderator table, keyed by job name. */
export const CHECKS = [
  { name: 'lint', label: 'Required fields and formatting' },
  { name: 'build-preview', label: 'Site builds with this submission' },
  { name: 'a11y', label: 'Accessibility (sample of site pages)' },
  { name: 'checks', label: 'Repository checks' },
];

/** One check run (or undefined) -> a short result for the table. */
export function checkResult(run) {
  if (!run) return '⏳ Waiting to start';
  if (run.status !== 'completed') return '⏳ Running';
  switch (run.conclusion) {
    case 'success': return '✅ Passed';
    case 'skipped':
    case 'neutral': return '➖ Not needed for this change';
    case 'cancelled': return '⏹️ Cancelled - re-run it from the Checks tab';
    default: return '❌ Needs a look';
  }
}

function previewLine(preview, noun) {
  switch (preview.state) {
    case 'ready':
      return `**Preview:** ✅ [See how your ${noun} will look](${preview.url}) (not public yet - only people with this link can see it).`;
    case 'publishing':
      return '**Preview:** ⏳ Almost ready - the preview is being published. This comment updates itself when it is.';
    case 'failed':
      return '**Preview:** ⚠️ The preview couldn\'t be built this time. A moderator will look into it - this is usually a problem on our side, not with your submission.';
    case 'none':
      return '';
    default:
      return '**Preview:** ⏳ Being built - usually ready in 2-3 minutes. This comment updates itself.';
  }
}

function tableCell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * @param {object} s
 * @param {{kind: string, label: string, formName: string}} s.meta  submissionMeta(ref)
 * @param {'open'|'merged'|'closed'} s.state
 * @param {{state: string, url?: string}} s.preview
 * @param {Object<string, object>} s.checks  latest check run per job name
 * @param {string[]} [s.lintErrors]  problems found in the submitted file(s)
 * @param {{title: string, rows: string[][], file: string, liveUrl: string}[]} s.items
 * @param {string} [s.formUrl]
 */
export function renderStatus(s) {
  const noun = s.meta.kind;
  const lines = [MARKER];

  if (s.state === 'merged') {
    lines.push(`### 🎉 Your ${noun} was approved`, '');
    const live = s.items.map((i) => i.liveUrl).filter(Boolean);
    lines.push(`It is being published now and will be live within a few minutes${live.length ? ' at ' + live.join(', ') : ''}. If you left an email address, you'll get a message as soon as it's online.`);
    lines.push('', 'Thank you for supporting open source design!');
    return lines.join('\n') + '\n';
  }

  if (s.state === 'closed') {
    lines.push(`### Your ${noun} was closed without publishing`, '');
    lines.push('A moderator closed this pull request - the comments above usually explain why, and if you left an email address you\'ll get a message with their feedback.');
    if (s.formUrl) lines.push('', `You're welcome to update it and submit again through the [${s.meta.formName}](${s.formUrl}).`);
    return lines.join('\n') + '\n';
  }

  lines.push(`### 👋 Thanks for your ${noun}!`, '');
  lines.push('It has reached the Open Source Design moderators - **nothing else is needed from you right now.**', '');
  lines.push('**What happens next**');
  lines.push(`1. A volunteer moderator reviews your ${noun}, usually within a few days. If something needs changing they'll ask in a comment below.`);
  lines.push('2. Once it\'s approved and merged, it goes live on opensourcedesign.net. If you left an email address, you\'ll get a message then (or if it isn\'t accepted).');
  const pv = previewLine(s.preview, noun);
  if (pv) lines.push('', pv);

  const lintRun = s.checks.lint;
  if (lintRun && lintRun.status === 'completed' && lintRun.conclusion === 'failure') {
    lines.push('', `ℹ️ The automated check found a small formatting issue. You don't need to do anything - a moderator will fix it before publishing.`);
  }

  lines.push('', '<details>');
  lines.push('<summary><b>Automated checks and details</b> - for moderators. A ❌ here or in the checks list below does not mean your submission was rejected.</summary>', '');
  lines.push('| Check | Result |', '| --- | --- |');
  for (const c of CHECKS) lines.push(`| ${c.label} | ${checkResult(s.checks[c.name])} |`);

  if (s.lintErrors && s.lintErrors.length) {
    lines.push('', '**Formatting issues to fix before merging**');
    for (const e of s.lintErrors.slice(0, 8)) lines.push(`- ${e}`);
    if (s.lintErrors.length > 8) lines.push(`- …and ${s.lintErrors.length - 8} more (see the "Lint changed content" check).`);
  }

  for (const item of s.items) {
    lines.push('', `**${tableCell(item.title)}**`, '', '| Field | Value |', '| --- | --- |');
    for (const [k, v] of item.rows) lines.push(`| ${k} | ${tableCell(v)} |`);
    lines.push(`| File | \`${item.file}\` |`);
    if (item.liveUrl) lines.push(`| Live URL after merge | ${item.liveUrl} |`);
  }

  lines.push('', 'Review the preview and the checks, then merge to publish, or close with a comment explaining why - the submitter is emailed either way. Small fixes can be made by editing the file in this pull request.');
  lines.push('</details>', '');
  lines.push('<sub>This comment is updated automatically as the checks finish.</sub>');
  return lines.join('\n') + '\n';
}

/** Latest check run per name (re-runs create new runs with the same name). */
export function latestRuns(checkRuns) {
  const byName = {};
  for (const run of checkRuns || []) {
    const prev = byName[run.name];
    if (!prev || String(run.started_at || '') > String(prev.started_at || '') || (run.started_at === prev.started_at && run.id > prev.id)) {
      byName[run.name] = run;
    }
  }
  return byName;
}

/** Preview state from the preview workflow's check runs (before probing the URL). */
export function previewState(runs, prState) {
  if (prState !== 'open') return 'none';
  const deploy = runs['deploy-preview'];
  const build = runs['build-preview'];
  if (deploy && deploy.status === 'completed' && deploy.conclusion === 'success') return 'deployed';
  if (build && build.status === 'completed' && build.conclusion === 'failure') return 'failed';
  if (deploy && deploy.status === 'completed' && deploy.conclusion === 'failure') return 'failed';
  if (build && build.status === 'completed' && build.conclusion === 'skipped' && runs['skip-preview']) return 'none';
  return 'building';
}
