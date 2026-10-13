// Runtime typography (examples/build-chain/assets/typo.js), no browser: the glue() function on its own.
//   node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPO = process.env.TYPO_PATH || join(ROOT, 'examples/build-chain/assets/typo.js');
const { glue } = createRequire(import.meta.url)(TYPO);
const N = '\u00a0';

test('typo: a run of short words is glued word by word', () => {
  assert.equal(glue('put it in a box to a place', 'en'), `put it in${N}a${N}box to${N}a${N}place`);
});

test('typo: sentence-start capitals are glued too (case-insensitive per language)', () => {
  assert.equal(glue('A note. In a box. I am here.', 'en'), `A${N}note. In${N}a${N}box. I${N}am here.`);
  assert.equal(glue('Zu Hause im Garten und so weiter', 'de-DE'), `Zu${N}Hause im${N}Garten und so${N}weiter`);
});

test('typo: emits a real U+00A0, never an entity; words that only start with a short word stay', () => {
  const out = glue('about an apple', 'en');
  assert.equal(out, `about an${N}apple`);
  assert.ok(!out.includes('&nbsp;'));
});

test('typo: the brand from data-brand stays on one line; unknown languages are left alone', () => {
  assert.equal(glue('Try Acme Pad today', 'en', 'Acme Pad'), `Try Acme${N}Pad today`);
  assert.equal(glue('a b c', 'xx'), 'a b c');
});
