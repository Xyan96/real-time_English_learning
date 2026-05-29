import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('track fixture drives video currentTime from a real media stream', () => {
  const html = fs.readFileSync(new URL('../demo/track-fixture.html', import.meta.url), 'utf8');

  assert.match(html, /<canvas\b/);
  assert.match(html, /captureStream\(/);
  assert.match(html, /video\.srcObject\s*=/);
  assert.doesNotMatch(html, /video\.currentTime\s*=/);
});
