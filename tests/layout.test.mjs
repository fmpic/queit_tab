import test from 'node:test';
import assert from 'node:assert/strict';
import { viewportScale, viewportOffset } from '../src/layout.mjs';

test('moves the content slightly upward on roomy viewports', () => {
  assert.equal(viewportOffset(400, 1, 840, 900), 32);
  assert.equal(viewportOffset(200, 1, 440, 500), 20);
});

test('limits the shift to remaining space on short viewports', () => {
  assert.equal(viewportOffset(400, 1, 420, 480), 10);
  const scale = viewportScale(720, 800, 700, 400);
  assert.equal(scale, 0.5);
  assert.equal(viewportOffset(800, scale, 400, 450), 0);
  assert.equal(viewportOffset(500, 1, 400, 450), 0);
});
