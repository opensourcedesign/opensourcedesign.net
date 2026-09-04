import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarkdown } from '../../workers/job-submit/src/index.js';

const submission = {
  title: 'Markdown test',
  organization: 'Open Source Design',
  org_url: 'https://opensourcedesign.net',
  license: 'CC BY-SA 4.0',
  role: 'Designer',
  description: '**Bold** <script>alert(1)</script> <https://example.com>',
  deliverables: '**Brief** <script>alert(1)</script>',
  how_to_apply: 'https://example.com/apply',
};

test('submission serialization preserves Markdown but escapes raw HTML', () => {
  const { markdown } = buildMarkdown(submission, {});

  assert.match(markdown, /how_to_apply:\n  - "https:\/\/example\.com\/apply"/);
  assert.match(markdown, /deliverables: \|-\n  \*\*Brief\*\* &lt;script>alert\(1\)&lt;\/script>/);
  assert.match(markdown, /\*\*Bold\*\* &lt;script>alert\(1\)&lt;\/script> <https:\/\/example\.com>/);
});
