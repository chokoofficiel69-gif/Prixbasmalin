import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (file) => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || file);
};

test('companion Chrome extension manifest is valid and limited to Studio origin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'companion-bridge/manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.externally_connectable.matches, ['https://studio.prixbasmalin.prod.page/*']);
  assert.ok(manifest.content_scripts.some(x => x.js.includes('content.js')));
});

test('companion server and browser relay scripts have valid JavaScript syntax', () => {
  for (const file of ['server/index.js', 'public/js/views/companion.js', 'public/js/lib/expertface.js', 'public/js/lib/core.js', 'companion-bridge/background.js', 'companion-bridge/content.js']) check(file);
});

test('browser relay does not expose a shell command or form submission action', () => {
  const bg = fs.readFileSync(path.join(root, 'companion-bridge/background.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'companion-bridge/content.js'), 'utf8');
  assert.doesNotMatch(bg, /child_process|exec\(|spawn\(/);
  assert.doesNotMatch(content, /\.submit\s*\(/);
  assert.match(content, /Action sensible bloquée/);
});
