import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const forkRoot = process.argv[2];
function walkYaml(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkYaml(full, out);
    else if (e.name.endsWith('.yml') || e.name.endsWith('.yaml')) out.push(full);
  }
  return out;
}
const files = walkYaml(path.join(forkRoot, 'Resources', 'Prototypes'));
let bomCount = 0;
for (const f of files) {
  const buf = readFileSync(f);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) bomCount++;
}
console.log(`Файлов с BOM: ${bomCount} из ${files.length} (${(100 * bomCount / files.length).toFixed(1)}%)`);
