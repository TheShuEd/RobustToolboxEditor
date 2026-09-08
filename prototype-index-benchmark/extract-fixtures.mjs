// Достаёт реальные, показательные примеры прототипов из форка для HTML-прототипа:
// множественное наследование с конфликтом полей, глубокая цепочка, abstract, engine vs content.
import { parseAllDocuments, isSeq, isMap } from 'yaml';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

function getScalarOrList(mapNode, key) {
  const node = mapNode.get(key, true);
  if (node == null) return null;
  if (isSeq(node)) return node.items.map((n) => String(n?.value ?? n));
  return [String(node.value ?? node)];
}

const files = walkYaml(path.join(forkRoot, 'Resources', 'Prototypes'));
const all = []; // { kind, id, own, parents, abstract, file }

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  let docs;
  try { docs = parseAllDocuments(text); } catch { continue; }
  for (const doc of docs) {
    const root = doc.contents;
    if (!root || !isSeq(root)) continue;
    for (const item of root.items) {
      if (!isMap(item)) continue;
      const kind = item.get('type');
      const id = item.get('id');
      if (kind == null || id == null) continue;
      const abstractRaw = item.get('abstract');
      all.push({
        kind: String(kind),
        id: String(id),
        parents: getScalarOrList(item, 'parent'),
        abstract: abstractRaw === true || abstractRaw === 'true',
        own: item.toJSON(),
        file: path.relative(forkRoot, file),
      });
    }
  }
}

const byKindId = new Map();
for (const r of all) byKindId.set(`${r.kind}:${r.id}`, r);

// 1. Множественное наследование с реальным конфликтом полей между родителями
let multiParentExample = null;
for (const r of all) {
  if (!r.parents || r.parents.length < 2) continue;
  const parentRecs = r.parents.map((p) => byKindId.get(`${r.kind}:${p}`)).filter(Boolean);
  if (parentRecs.length !== r.parents.length) continue;
  // ищем ключ, который есть в >=2 родителях с разными значениями (конфликт => виден порядок слияния)
  const keyCounts = new Map();
  for (const p of parentRecs) {
    for (const k of Object.keys(p.own)) {
      if (k === 'id' || k === 'parent' || k === 'type' || k === 'abstract') continue;
      if (!keyCounts.has(k)) keyCounts.set(k, []);
      keyCounts.get(k).push({ parent: p.id, value: p.own[k] });
    }
  }
  const conflictKey = [...keyCounts.entries()].find(([, vals]) => vals.length >= 2 &&
    new Set(vals.map((v) => JSON.stringify(v.value))).size > 1);
  if (conflictKey) {
    multiParentExample = { record: r, parents: parentRecs, conflictField: conflictKey[0], conflictValues: conflictKey[1] };
    break;
  }
}

// 2. Самая глубокая цепочка (уже знаем: entity:BoxSurvivalHugNitrogen, глубина 9)
function buildChain(kind, id, acc = []) {
  const r = byKindId.get(`${kind}:${id}`);
  if (!r) return acc;
  acc.push(r);
  if (r.parents && r.parents.length === 1) return buildChain(kind, r.parents[0], acc);
  return acc;
}
const deepChain = buildChain('entity', 'BoxSurvivalHugNitrogen');

// 3. abstract vs конкретный (content)
const abstractExample = all.find((r) => r.abstract && r.kind === 'entity' && (all.some((c) => c.parents?.includes(r.id))));

// 4. engine-прототип (для контраста типов — просто пример структуры типа из контента с малым числом полей)
const smallKindExample = all.find((r) => r.kind === 'Tag');

const fixtures = {
  multiParentExample: multiParentExample && {
    id: multiParentExample.record.id,
    kind: multiParentExample.record.kind,
    file: multiParentExample.record.file,
    own: multiParentExample.record.own,
    parents: multiParentExample.parents.map((p) => ({ id: p.id, own: p.own, file: p.file })),
    conflictField: multiParentExample.conflictField,
  },
  deepChain: deepChain.map((r) => ({ id: r.id, own: r.own, file: r.file, abstract: r.abstract })),
  abstractExample: abstractExample && { id: abstractExample.id, own: abstractExample.own, file: abstractExample.file },
  smallKindExample: smallKindExample && { id: smallKindExample.id, own: smallKindExample.own, file: smallKindExample.file },
};

writeFileSync(path.join(path.dirname(process.argv[1]), 'fixtures.json'), JSON.stringify(fixtures, null, 2));
console.log('multiParentExample:', multiParentExample ? `${multiParentExample.record.kind}:${multiParentExample.record.id} (конфликт по '${multiParentExample.conflictField}')` : 'не найден');
console.log('deepChain length:', deepChain.length, deepChain.map((r) => r.id).join(' <- '));
console.log('abstractExample:', abstractExample ? `${abstractExample.kind}:${abstractExample.id}` : 'не найден');
console.log('smallKindExample:', smallKindExample ? `${smallKindExample.kind}:${smallKindExample.id}` : 'не найден');
