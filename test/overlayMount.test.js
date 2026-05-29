import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOverlayMountTarget,
  shouldMoveOverlay,
} from '../src/content/overlayMount.js';

test('getOverlayMountTarget uses fullscreen element when present', () => {
  const fullscreenElement = { id: 'player-fullscreen' };
  const documentElement = { id: 'document' };

  assert.equal(
    getOverlayMountTarget({ fullscreenElement, documentElement }),
    fullscreenElement,
  );
});

test('getOverlayMountTarget falls back to documentElement', () => {
  const documentElement = { id: 'document' };

  assert.equal(
    getOverlayMountTarget({ fullscreenElement: null, documentElement }),
    documentElement,
  );
});

test('shouldMoveOverlay detects when root is not inside target', () => {
  const target = { contains: () => false };
  const root = {};

  assert.equal(shouldMoveOverlay(root, target), true);
});

test('shouldMoveOverlay avoids unnecessary DOM moves', () => {
  const root = {};
  const target = { contains: (node) => node === root };

  assert.equal(shouldMoveOverlay(root, target), false);
});
