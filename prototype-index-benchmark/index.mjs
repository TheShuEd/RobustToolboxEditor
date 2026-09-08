// PROTOTYPE — throwaway. Answers issue #5: "Индекс прототипов и бюджет производительности".
//
// Ходит по Resources/Prototypes/** реального форка (путь первым аргументом CLI),
// парсит через `yaml` (eemeli) ^2.8 — тот же пакет и слой (CST/AST + LineCounter),
// который зафиксирован решением issue #3 — строит плоский индекс и резолвит
// множественное наследование ТЕМ ЖЕ алгоритмом, что и движок RobustToolbox
// (см. Robust.Shared/Serialization/Manager/SerializationManager.Composition.cs
// и Robust.Shared/Prototypes/PrototypeManager.cs:PushKindInheritance), затем
// печатает измеренные числа: время парсинга, время резолва наследования,
// размер структуры в памяти, стоимость точечного обновления и персистентного кэша.
//
// Запуск:  node index.mjs <путь-к-форку>
// Пример:  node index.mjs "C:/.../crystall-edge"

import { parseAllDocuments, isSeq, isMap, LineCounter } from 'yaml';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const forkRoot = process.argv[2];
if (!forkRoot) {
  console.error('Usage: node index.mjs <путь-к-форку>');
  process.exit(1);
}

const protoDirs = [
  path.join(forkRoot, 'Resources', 'Prototypes'),
  path.join(forkRoot, 'RobustToolbox', 'Resources', 'EnginePrototypes'),
];

// ---------------------------------------------------------------------------
// 1. Обход файловой системы
// ---------------------------------------------------------------------------

function walkYaml(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // движок игнорирует dot-файлы (PrototypeManager.YamlLoad.cs:90)
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkYaml(full, out);
    else if (e.name.endsWith('.yml') || e.name.endsWith('.yaml')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Парсинг файла → плоские записи индекса
//    Поля: id, kind, path, range (char-offsets), line/col (через LineCounter),
//    parents (сырые id, в порядке объявления — важно для порядка слияния),
//    abstract, engine (read-only källa).
// ---------------------------------------------------------------------------

function getScalarOrList(mapNode, key) {
  const node = mapNode.get(key, true);
  if (node == null) return null;
  if (isSeq(node)) return node.items.map((n) => String(n?.value ?? n));
  return [String(node.value ?? node)];
}

function parseFile(file, engine) {
  let text = readFileSync(file, 'utf8');
  // НАХОДКА: ~9% файлов форка начинаются с UTF-8 BOM (U+FEFF). `yaml` (eemeli) НЕ
  // снимает его сам и заваливает разбор ВСЕГО документа без единой ошибки на уровне
  // файла — просто 0 записей. .NET StreamReader(..., EncodingHelpers.UTF8) снимает
  // BOM автоматически, поэтому движок этих файлов "не видит" как проблему. Без этой
  // строки индекс тихо теряет 9% форка.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter, prettyErrors: false });
  const records = [];
  let skippedVariants = 0;

  for (const doc of docs) {
    const root = doc.contents;
    if (root == null) continue; // пустой документ (движок тоже это терпит: PrototypeManager.YamlLoad.cs:147)
    if (!isSeq(root)) continue; // не sequence на верхнем уровне — движок логирует ошибку и пропускает

    for (const item of root.items) {
      if (!isMap(item)) continue;
      const kind = item.get('type');
      const id = item.get('id');
      if (kind == null) continue;
      if (id == null) {
        // CreateVariants — генерирует несколько id из шаблона на C#-стороне.
        // Выброшенный прототип: не разворачиваем, просто считаем и пропускаем.
        skippedVariants++;
        continue;
      }

      const range = item.range; // [start, valueEnd, nodeEnd] — char offsets, решение issue #3
      const startPos = lineCounter.linePos(range[0]);
      const abstractRaw = item.get('abstract');
      const isAbstract = abstractRaw === true || abstractRaw === 'true';

      records.push({
        id: String(id),
        kind: String(kind),
        parents: getScalarOrList(item, 'parent'),
        abstract: isAbstract,
        file,
        range,
        line: startPos.line,
        col: startPos.col,
        engine,
      });
    }
  }

  return { records, skippedVariants, bytes: Buffer.byteLength(text, 'utf8') };
}

// ---------------------------------------------------------------------------
// 3. Резолв наследования — портирован 1:1 с алгоритмом движка:
//
//    MultiRootInheritanceGraph<T>: parents[id] = массив родителей КАК ОБЪЯВЛЕНО.
//    PushKindInheritance: топологический проход от корней (без родителей) к
//    листьям; каждый узел готов к обработке, когда обработаны ВСЕ его родители
//    (indegree == 0) — т.е. РЕЗОЛВ МЕМОИЗИРОВАН ПО ПОСТРОЕНИЮ: каждый прототип
//    сливается ровно один раз, не по цепочке предков при каждом обращении.
//
//    SerializationManager.PushComposition(type, parents[], child):
//      node = child
//      for each parent in parents (В ПОРЯДКЕ СПИСКА):
//        node = CombineMappings(child: node, parent: parent)
//    CombineMappings делает node.TryAddCopy(key, value) — то есть ДОБАВЛЯЕТ
//    ключ, только если его ещё нет в node. Значит:
//      узел (собственные поля) > parents[0] > parents[1] > … > parents[n-1]
//    "Слияние слева направо" из формулировки тикета = первый в списке parent
//    выигрывает у последующих при конфликте, но проигрывает самому потомку.
// ---------------------------------------------------------------------------

function resolveInheritance(recordsByKind) {
  const resolved = new Map(); // kind -> Map<id, mergedPlainObject>
  const errors = [];

  for (const [kind, byId] of recordsByKind) {
    const merged = new Map();
    const indegree = new Map();
    const children = new Map();

    for (const [id, rec] of byId) {
      const parents = (rec.parents ?? []).filter((p) => {
        if (!byId.has(p)) {
          errors.push(`${kind}:${id} ссылается на несуществующего родителя '${p}'`);
          return false;
        }
        return true;
      });
      indegree.set(id, parents.length);
      for (const p of parents) {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(id);
      }
    }

    const queue = [...byId.keys()].filter((id) => indegree.get(id) === 0);
    let processed = 0;

    while (queue.length) {
      const id = queue.shift();
      const rec = byId.get(id);
      const parents = (rec.parents ?? []).filter((p) => byId.has(p));

      let node = { ...rec.own }; // собственные поля прототипа (child)
      for (const p of parents) {
        const parentMerged = merged.get(p);
        // CombineMappings: добавить только отсутствующие в node ключи
        for (const [k, v] of Object.entries(parentMerged)) {
          if (!(k in node)) node[k] = v;
        }
      }
      merged.set(id, node);
      processed++;

      for (const child of children.get(id) ?? []) {
        indegree.set(child, indegree.get(child) - 1);
        if (indegree.get(child) === 0) queue.push(child);
      }
    }

    if (processed !== byId.size) {
      errors.push(`${kind}: цикл наследования — обработано ${processed} из ${byId.size}`);
    }

    resolved.set(kind, merged);
  }

  return { resolved, errors };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function bytesOf(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function heap() {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed;
}

console.log('=== Индекс прототипов: измерение на реальных данных ===\n');

let allFiles = [];
for (const dir of protoDirs) {
  const engine = dir.includes('RobustToolbox');
  const files = walkYaml(dir).map((f) => ({ f, engine }));
  allFiles = allFiles.concat(files);
  console.log(`${dir}\n  → ${files.length} файлов`);
}
console.log(`\nВсего файлов: ${allFiles.length}\n`);

// ---- Фаза 1: парсинг ----
const heapBeforeParse = heap();
const t0 = performance.now();

const allRecords = [];
let totalBytes = 0;
let totalSkippedVariants = 0;
const typeCasing = new Map(); // lower(type) -> Set(actual casings seen)

for (const { f, engine } of allFiles) {
  const { records, skippedVariants, bytes } = parseFile(f, engine);
  totalBytes += bytes;
  totalSkippedVariants += skippedVariants;
  for (const r of records) {
    allRecords.push(r);
    const lower = r.kind.toLowerCase();
    if (!typeCasing.has(lower)) typeCasing.set(lower, new Set());
    typeCasing.get(lower).add(r.kind);
  }
}

const t1 = performance.now();
const heapAfterParse = heap();

console.log(`--- Фаза 1: парсинг + извлечение записей ---`);
console.log(`Прочитано ${bytesOf(totalBytes)}, документов→записей: ${allRecords.length}`);
console.log(`Пропущено CreateVariants-заготовок (не разворачивали): ${totalSkippedVariants}`);
console.log(`Время: ${(t1 - t0).toFixed(0)} мс`);
console.log(`Heap прирост: ${bytesOf(heapAfterParse - heapBeforeParse)}`);

const inconsistentCasing = [...typeCasing.entries()].filter(([, set]) => set.size > 1);
if (inconsistentCasing.length) {
  console.log(`Непоследовательный регистр типов (${inconsistentCasing.length}):`,
    inconsistentCasing.map(([, set]) => [...set].join('/')).join(', '));
}

// ---- own-поля для мерджа: сериализуем то же, что вернёт item.toJS(), кроме id/type/parent/abstract (уже вынесены) ----
// Для оценки размера/стоимости мерджа достаточно placeholder-полей той же кардинальности,
// т.к. дорогая часть — количество узлов и глубина графа, не конкретные значения.
for (const r of allRecords) {
  r.own = { id: r.id, __srcRange: r.range };
}

// ---- индекс по (kind, id) ----
const byKind = new Map();
for (const r of allRecords) {
  if (!byKind.has(r.kind)) byKind.set(r.kind, new Map());
  const m = byKind.get(r.kind);
  if (m.has(r.id)) {
    console.log(`ДУБЛИКАТ id: ${r.kind}:${r.id} (${m.get(r.id).file} и ${r.file})`);
  }
  m.set(r.id, r);
}

console.log(`\nТипов прототипов: ${byKind.size}`);
const byKindCounts = [...byKind.entries()].map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]);
console.log('Топ-10 по числу записей:', byKindCounts.slice(0, 10).map(([k, n]) => `${k}=${n}`).join(', '));

const withParents = allRecords.filter((r) => r.parents && r.parents.length > 0);
const multiParent = allRecords.filter((r) => r.parents && r.parents.length > 1);
const abstractCount = allRecords.filter((r) => r.abstract).length;
console.log(`С parent: ${withParents.length}, из них множественное наследование (>1 родителя): ${multiParent.length}`);
console.log(`abstract: true: ${abstractCount}`);

// глубина цепочек наследования (для памятки о том, нужна ли мемоизация)
{
  const depthCache = new Map();
  function depth(kind, id, seen = new Set()) {
    if (depthCache.has(kind + ':' + id)) return depthCache.get(kind + ':' + id);
    if (seen.has(id)) return 0; // защита от цикла в этой грубой оценке
    const rec = byKind.get(kind)?.get(id);
    if (!rec || !rec.parents || rec.parents.length === 0) return 0;
    seen.add(id);
    const d = 1 + Math.max(...rec.parents.map((p) => depth(kind, p, seen)));
    depthCache.set(kind + ':' + id, d);
    return d;
  }
  let maxDepth = 0;
  let maxChain = null;
  for (const [kind, byId] of byKind) {
    for (const id of byId.keys()) {
      const d = depth(kind, id);
      if (d > maxDepth) { maxDepth = d; maxChain = `${kind}:${id}`; }
    }
  }
  console.log(`Максимальная глубина цепочки наследования: ${maxDepth} (у ${maxChain})`);
}

// ---- Фаза 2: резолв наследования (топологически, мемоизировано) ----
const heapBeforeResolve = heap();
const t2 = performance.now();
const { resolved, errors } = resolveInheritance(byKind);
const t3 = performance.now();
const heapAfterResolve = heap();

console.log(`\n--- Фаза 2: резолв наследования (топологический проход, как в движке) ---`);
console.log(`Время: ${(t3 - t2).toFixed(1)} мс`);
console.log(`Heap прирост (резолв-структуры): ${bytesOf(heapAfterResolve - heapBeforeResolve)}`);
if (errors.length) {
  console.log(`Ошибки резолва (${errors.length}), первые 5:`, errors.slice(0, 5));
}

// ---- Фаза 3: точечное обновление одного файла (save-триггер) ----
{
  const sample = allFiles.find(({ f }) => walkYaml, allFiles)[0]; // любой файл с записями
  const target = allFiles.map(({ f }) => f).find((f) => allRecords.some((r) => r.file === f));
  const t4 = performance.now();
  const { records: newRecords } = parseFile(target, false);
  const t5 = performance.now();

  // затронутые id: сами + все транзитивные потомки (единственное, что обязано пересчитаться)
  const kindsTouched = new Set(newRecords.map((r) => r.kind));
  let affectedCount = 0;
  for (const kind of kindsTouched) {
    const byId = byKind.get(kind);
    if (!byId) continue;
    const childrenMap = new Map();
    for (const [id, rec] of byId) {
      for (const p of rec.parents ?? []) {
        if (!childrenMap.has(p)) childrenMap.set(p, []);
        childrenMap.get(p).push(id);
      }
    }
    const changedIds = newRecords.filter((r) => r.kind === kind).map((r) => r.id);
    const queue = [...changedIds];
    const affected = new Set(queue);
    while (queue.length) {
      const id = queue.shift();
      for (const c of childrenMap.get(id) ?? []) {
        if (!affected.has(c)) { affected.add(c); queue.push(c); }
      }
    }
    affectedCount += affected.size;
  }
  const t6 = performance.now();

  console.log(`\n--- Фаза 3: точечное обновление одного файла (save) ---`);
  console.log(`Файл: ${path.relative(forkRoot, target)}`);
  console.log(`Перепарсинг файла: ${(t5 - t4).toFixed(2)} мс`);
  console.log(`Поиск транзитивно затронутых прототипов (нужно пересчитать): ${affectedCount} узлов, ${(t6 - t5).toFixed(2)} мс`);
  console.log(`(Полный ребилд занял бы ${(t3 - t0).toFixed(0)} мс — на save это того не стоит)`);
}

// ---- Фаза 4: персистентный кэш на диске ----
{
  const cachePath = path.join(path.dirname(process.argv[1]), 'proto-index.cache.json');
  const lightweight = allRecords.map((r) => [r.kind, r.id, r.parents, r.file, r.range, r.abstract, r.engine]);

  const t7 = performance.now();
  writeFileSync(cachePath, JSON.stringify(lightweight));
  const t8 = performance.now();
  const cacheStat = statSync(cachePath);
  const t9 = performance.now();
  const raw = readFileSync(cachePath, 'utf8');
  const parsed = JSON.parse(raw);
  const t10 = performance.now();

  console.log(`\n--- Фаза 4: персистентный кэш (только лёгкие поля: id/kind/parents/path/range) ---`);
  console.log(`Размер кэша на диске: ${bytesOf(cacheStat.size)}`);
  console.log(`Запись: ${(t8 - t7).toFixed(1)} мс, чтение+JSON.parse: ${(t10 - t9).toFixed(1)} мс, записей: ${parsed.length}`);
  console.log(`(холодный старт из кэша не требует ни одного вызова YAML-парсера)`);
}

console.log(`\n=== ИТОГО ===`);
console.log(`Холодный старт (парсинг + индекс + резолв всех типов): ${(t3 - t0).toFixed(0)} мс`);
console.log(`Heap прирост суммарно: ${bytesOf(heapAfterResolve - heapBeforeParse)}`);
