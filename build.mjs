/**
 * Build the loadable extension folders:
 *   dist/qq-mv3  (Manifest V3, preferred for current Chromium browsers)
 *   dist/qq-mv2  (Manifest V2 fallback for older QQ Browser builds)
 *
 * Usage:  node build.mjs
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

const sharedFiles = ['lib.js', 'content.js', 'background.js'];
const targets = [
  { folder: 'qq-mv3', manifest: 'manifest.mv3.json' },
  { folder: 'qq-mv2', manifest: 'manifest.mv2.json' }
];

for (const target of targets) {
  const out = join(dist, target.folder);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const file of sharedFiles) {
    cpSync(join(src, file), join(out, file));
  }
  cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true });

  const manifest = JSON.parse(readFileSync(join(src, target.manifest), 'utf8'));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // sanity check: every file referenced by the manifest exists
  const referenced = new Set([
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.browser_action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || [])
  ].filter(Boolean));

  for (const relative of referenced) {
    readFileSync(join(out, relative)); // throws if missing
  }

  console.log(`built ${target.folder} (manifest v${manifest.manifest_version})`);
}

writeFileSync(join(dist, 'VERSION.txt'), '1.0.0\n', 'utf8');
console.log('done');
