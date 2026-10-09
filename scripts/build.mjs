import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePackage } from './validate-package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = {};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative + '/');
    else files[relative] = new Uint8Array(await readFile(path.join(directory, entry.name)));
  }
}
await collect(path.join(root, 'addon'));
for (const [name, entry, globalName] of [
  ['plugin', 'src/plugin.ts', 'FigureExtract'],
  ['preferences', 'src/preferences.ts', 'FigureExtractPreferences']
]) {
  const result = await build({
    absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    format: 'iife', globalName, target: 'firefox115', platform: 'browser',
    legalComments: 'inline'
  });
  files[`chrome/content/${name}.js`] = result.outputFiles[0].contents;
}
files['LICENSE'] = new Uint8Array(await readFile(path.join(root, 'LICENSE')));
files['NOTICE'] = strToU8(await readFile(path.join(root, 'NOTICE'), 'utf8'));
const manifest = validatePackage(files);
const packageJSON = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJSON.version !== manifest.version) throw new Error('package.json 与插件清单版本不一致');
await mkdir(path.join(root, 'dist'), { recursive: true });
const output = path.join(root, 'dist/zotero-figure-extract.xpi');
const archive = zipSync(files, { level: 9 });
await writeFile(output, archive);
await writeFile(path.join(root, `dist/zotero-figure-extract-${manifest.version}.xpi`), archive);
const repository = packageJSON.repository.url.replace(/\.git$/, '');
const update = {
  addons: {
    [manifest.applications.zotero.id]: {
      updates: [{
        version: manifest.version,
        update_link: `${repository}/releases/download/v${manifest.version}/zotero-figure-extract.xpi`,
        update_hash: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
        applications: { zotero: {
          strict_min_version: manifest.applications.zotero.strict_min_version,
          strict_max_version: manifest.applications.zotero.strict_max_version
        } }
      }]
    }
  }
};
await writeFile(path.join(root, 'dist/update.json'), JSON.stringify(update, null, 2) + '\n');
console.log(`已生成 ${output}（${Object.keys(files).length} 个文件）`);
console.log('已生成 dist/update.json（包含 XPI 的 SHA-256 校验值）');
