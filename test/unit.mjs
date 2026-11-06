/**
 * Unit tests for src/lib.js (pure helpers, no browser required).
 * Usage: node test/unit.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../src/lib.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'lib.js' });
const LIB = globalThis.AssetLib;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('parses a character asset key', () => {
  const parsed = LIB.parseAssetKey('character:大胤前军·绯黑前军甲');
  assert.equal(parsed.type, 'character');
  assert.equal(parsed.typeLabel, '角色');
  assert.equal(parsed.name, '大胤前军·绯黑前军甲');
});

test('keeps colons inside the name', () => {
  const parsed = LIB.parseAssetKey('prop:神秘道具:觉醒形态');
  assert.equal(parsed.type, 'prop');
  assert.equal(parsed.name, '神秘道具:觉醒形态');
});

test('falls back to other when no type prefix exists', () => {
  const parsed = LIB.parseAssetKey('无名素材');
  assert.equal(parsed.type, 'other');
  assert.equal(parsed.name, '无名素材');
});

test('sanitizes path-hostile characters', () => {
  const safe = LIB.sanitizeFilename('a/b:c*?"<>|d');
  assert.ok(!/[\\/:*?"<>|]/.test(safe));
  assert.equal(safe, 'a_b_c______d');
});

test('trims dots and spaces and handles empty names', () => {
  assert.equal(LIB.sanitizeFilename('  ..名字..  '), '名字');
  assert.equal(LIB.sanitizeFilename('   '), '未命名');
});

test('escapes Windows reserved names', () => {
  assert.equal(LIB.sanitizeFilename('CON'), '_CON');
  assert.equal(LIB.sanitizeFilename('lpt1'), '_lpt1');
});

test('limits long names', () => {
  const safe = LIB.sanitizeFilename('长'.repeat(200), 70);
  assert.equal(safe.length, 70);
});

test('builds index-prefixed filenames with padding', () => {
  assert.equal(
    LIB.buildFilename({ index: 0, total: 16, name: '大胤前军·绯黑前军甲', typeLabel: '角色', ext: 'png', pattern: 'index' }),
    '001_大胤前军·绯黑前军甲.png'
  );
  assert.equal(
    LIB.buildFilename({ index: 1199, total: 1200, name: '素材', typeLabel: '角色', ext: 'webp', pattern: 'index' }),
    '1200_素材.webp'
  );
});

test('builds name-only and type-prefixed filenames', () => {
  assert.equal(
    LIB.buildFilename({ index: 3, total: 9, name: '道具名', typeLabel: '道具', ext: 'jpg', pattern: 'name' }),
    '道具名.jpg'
  );
  assert.equal(
    LIB.buildFilename({ index: 3, total: 9, name: '道具名', typeLabel: '道具', ext: 'jpg', pattern: 'type' }),
    '道具_道具名.jpg'
  );
});

test('maps mime types to extensions', () => {
  assert.equal(LIB.extFromMime('image/png'), 'png');
  assert.equal(LIB.extFromMime('image/jpeg; charset=binary'), 'jpg');
  assert.equal(LIB.extFromMime('application/octet-stream'), '');
});

test('sniffs common image signatures', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(LIB.sniffImageExt(png), 'png');
  assert.equal(LIB.sniffImageExt(jpg), 'jpg');
  assert.equal(LIB.sniffImageExt(gif), 'gif');
  assert.equal(LIB.sniffImageExt(webp), 'webp');
});

test('formats a stable date stamp', () => {
  assert.equal(LIB.dateStamp(new Date(2026, 10, 6)), '20261106');
});

console.log(`\n${passed} tests passed`);
