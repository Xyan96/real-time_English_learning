import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const popupCss = fs.readFileSync(new URL('../src/popup/popup.css', import.meta.url), 'utf8');

test('popup keeps a stable extension popup width instead of clamping to the current viewport', () => {
  assert.match(popupCss, /body\s*\{[\s\S]*width:\s*380px;/);
  assert.doesNotMatch(popupCss, /max-width:\s*100vw;/);
});

test('popup layout constrains grid children and long status text inside the popup width', () => {
  assert.match(popupCss, /main\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(popupCss, /label\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(popupCss, /input,\s*\nselect\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(popupCss, /\.actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(popupCss, /button\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(popupCss, /#status\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
});

test('popup learning preference switches leave enough room for full Chinese labels', () => {
  assert.match(popupCss, /\.switch-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(popupCss, /\.switch-row span\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.doesNotMatch(
    popupCss.match(/\.switch-row span\s*\{[\s\S]*?\}/)?.[0] ?? '',
    /text-overflow:\s*ellipsis;/,
  );
});
