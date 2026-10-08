import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFeatureRelease, shortVersion } from './release.ts';

test('a new minor or major is worth a word, a patch is not', () => {
  assert.ok(isFeatureRelease('1.0.0', '1.1.0'));
  assert.ok(isFeatureRelease('1.4.2', '2.0.0'));
  assert.ok(!isFeatureRelease('1.1.0', '1.1.1'));
  assert.ok(!isFeatureRelease('1.1.0', '1.1.0'));
  assert.ok(!isFeatureRelease('2.0.0', '1.9.0'), 'a rollback is not news');
  assert.ok(
    !isFeatureRelease(undefined, '1.1.0'),
    'nor is a version Chrome did not report',
  );
});

test('the footer names a version without its patch', () => {
  assert.equal(shortVersion('1.1.0'), '1.1');
  assert.equal(shortVersion('2.0'), '2.0');
});
