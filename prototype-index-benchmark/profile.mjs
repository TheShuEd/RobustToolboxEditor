// Разбивка времени парсинга по стадиям — куда уходят 6.7с.
import { parseAllDocuments, parseDocument, LineCounter, isSeq, isMap } from 'yaml';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const forkRoot = process.argv[2];
const dir = path.join(forkRoot, 'Resources', 'Prototypes');

function walkYaml(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkYaml(full, out);
    else if (e.name.endsWith('.yml') || e.name.endsWith('.yaml')) out.push(full);
  }
  return out;
}

const files = walkYaml(dir);
console.log(`${files.length} файлов`);

// A: только чтение файлов с диска
let tA0 = performance.now();
const texts = files.map((f) => readFileSync(f, 'utf8'));
let tA1 = performance.now();
console.log(`A. Чтение файлов с диска: ${(tA1 - tA0).toFixed(0)} мс`);

// B: parseAllDocuments БЕЗ LineCounter, без извлечения записей
let tB0 = performance.now();
let docCountB = 0;
for (const text of texts) {
  const docs = parseAllDocuments(text);
  docCountB += docs.length;
}
let tB1 = performance.now();
console.log(`B. parseAllDocuments (без LineCounter): ${(tB1 - tB0).toFixed(0)} мс, документов: ${docCountB}`);

// C: parseAllDocuments С LineCounter (как в основном скрипте)
let tC0 = performance.now();
for (const text of texts) {
  const lc = new LineCounter();
  parseAllDocuments(text, { lineCounter: lc });
}
let tC1 = performance.now();
console.log(`C. parseAllDocuments (с LineCounter): ${(tC1 - tC0).toFixed(0)} мс`);

// D: только Composer/CST без compose в Document (parseDocument с {strict:false} без lineCounter, повтор для сравнения одиночного doc/file)
let tD0 = performance.now();
for (const text of texts) {
  parseDocument(text, { strict: false });
}
let tD1 = performance.now();
console.log(`D. parseDocument (single-doc API, strict:false): ${(tD1 - tD0).toFixed(0)} мс`);

// E: полный проход как в index.mjs (парсинг + get() по каждой записи) для сравнения
let tE0 = performance.now();
let records = 0;
for (const text of texts) {
  const lc = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter: lc });
  for (const doc of docs) {
    const root = doc.contents;
    if (!root || !isSeq(root)) continue;
    for (const item of root.items) {
      if (!isMap(item)) continue;
      const kind = item.get('type');
      const id = item.get('id');
      if (kind == null || id == null) continue;
      const range = item.range;
      lc.linePos(range[0]);
      item.get('parent', true);
      item.get('abstract');
      records++;
    }
  }
}
let tE1 = performance.now();
console.log(`E. Полный проход (parse + LineCounter + все get()): ${(tE1 - tE0).toFixed(0)} мс, записей: ${records}`);

// F: top-N самых тяжёлых файлов по времени парсинга
const perFile = [];
for (const [i, text] of texts.entries()) {
  const t0 = performance.now();
  parseAllDocuments(text);
  const t1 = performance.now();
  perFile.push({ file: files[i], ms: t1 - t0, bytes: Buffer.byteLength(text, 'utf8') });
}
perFile.sort((a, b) => b.ms - a.ms);
console.log('\nТоп-10 самых медленных файлов:');
for (const { file, ms, bytes } of perFile.slice(0, 10)) {
  console.log(`  ${ms.toFixed(1)} мс  (${(bytes / 1024).toFixed(0)} KB)  ${path.relative(forkRoot, file)}`);
}
const totalMs = perFile.reduce((a, b) => a + b.ms, 0);
console.log(`\nСумма по всем файлам (изолированно, без warm-up): ${totalMs.toFixed(0)} мс`);
