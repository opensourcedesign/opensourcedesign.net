import assert from 'node:assert/strict';
import test from 'node:test';
import { eventPath, hugoSlug, jobPath } from './job-url.mjs';

// Expected values are the URLs Hugo 0.166 builds for these titles.
const HUGO_SLUGS = [
  ['Design our new home page + web site theme', 'design-our-new-home-page--web-site-theme'],
  ['Senior UX/UI Designer, OpenProject', 'senior-ux-ui-designer-openproject'],
  ["UX Improvement Pass + Style Guide for Colorado Mesh's Mesh Client used around the world",
    'ux-improvement-pass--style-guide-for-colorado-meshs-mesh-client-used-around-the-world'],
  ['A & B', 'a-b'],
  ['A&B', 'ab'],
  ['C++ developer', 'c-developer'],
  ['plus+plus', 'plus-plus'],
  ['+start', '-start'],
  ['end+', 'end'],
  ['Foo -- bar', 'foo--bar'],
  ['Foo - bar', 'foo-bar'],
  ['  Leading space', 'leading-space'],
  ['Hello, World!', 'hello-world'],
  ['Q&A: design?', 'qa-design'],
  ['(parens) [brackets] {braces}', 'parens-brackets-braces'],
  ['dash—em – en', 'dashem-en'],
  ['a / b', 'a-b'],
  ['/leading slash', '-leading-slash'],
  ['slash/at/end/', 'slash-at-end-'],
  ['dots.in.title', 'dots.in.title'],
  ['under_score', 'under_score'],
  ['tilde ~x', 'tilde-~x'],
  ['Émile Café', 'émile-café'],
  ['Привет мир', 'привет-мир'],
  ['emoji 🎨 art', 'emoji-art'],
];

test('hugoSlug matches Hugo 0.166 :slug output', () => {
  for (const [title, slug] of HUGO_SLUGS) assert.equal(hugoSlug(title), slug, title);
});

test('jobPath prefers url, then slug, then the title', () => {
  assert.equal(jobPath('---\ntitle: "X"\nurl: /jobs/job-form/\n---\n'), '/jobs/job-form/');
  // Jekyll's permalink: is ignored by Hugo.
  assert.equal(jobPath('---\ntitle: "X Y"\npermalink: /2016/01/30/x/\n---\n'), '/jobs/x-y/');
  // A trailing YAML comment on a plain scalar is not part of the value.
  assert.equal(jobPath('---\ntitle: GalliumOS Team Member # Try to keep it to three words\n---\n'), '/jobs/galliumos-team-member/');
  assert.equal(jobPath('---\ntitle: "UX Designer"\nslug: ux-designer-2\n---\n'), '/jobs/ux-designer-2/');
  assert.equal(jobPath('---\ntitle: "Senior UX/UI Designer, OpenProject"\n---\n'), '/jobs/senior-ux-ui-designer-openproject/');
  assert.equal(jobPath('---\ntitle: ""\n---\n'), '');
});

test('eventPath uses the file name unless overridden', () => {
  assert.equal(eventPath('content/events/2027-01-30-fosdem.md', '---\ntitle: "FOSDEM"\n---\n'), '/events/2027-01-30-fosdem/');
  assert.equal(eventPath('content/events/x.md', '---\ntitle: "X"\nslug: fosdem-2027\n---\n'), '/events/fosdem-2027/');
  assert.equal(eventPath('content/events/x.md', '---\nurl: /events/special/\n---\n'), '/events/special/');
});
