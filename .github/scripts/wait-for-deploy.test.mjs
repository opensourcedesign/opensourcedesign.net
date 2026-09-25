import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeployedAfter } from './wait-for-deploy.mjs';

test('isDeployedAfter compares the job index build time with the merge time', () => {
  const merged = '2026-09-24T09:35:46Z';
  assert.equal(isDeployedAfter({ generated: '2026-09-24T09:38:33Z' }, merged), true);
  assert.equal(isDeployedAfter({ generated: '2026-09-24T11:38:33+02:00' }, merged), true);
  assert.equal(isDeployedAfter({ generated: '2026-09-24T09:35:46Z' }, merged), true);
  assert.equal(isDeployedAfter({ generated: '2026-09-13T03:22:58Z' }, merged), false);
  assert.equal(isDeployedAfter({}, merged), false);
  assert.equal(isDeployedAfter(null, merged), false);
  assert.equal(isDeployedAfter({ generated: '2026-09-24T09:38:33Z' }, ''), false);
});
