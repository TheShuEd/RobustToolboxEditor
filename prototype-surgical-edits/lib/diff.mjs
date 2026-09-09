import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAllDocuments } from 'yaml';

// Каждая правка должна оставлять текст ПАРСИМЫМ — иначе "diff трогает только целевые
// строки" ничего не стоит, если результат вообще не YAML. Проверяем результат отдельным
// чистым re-parse, без keepSourceTokens и прочего мусора демо-скриптов.
function assertReparsable(after, label) {
  const docs = parseAllDocuments(after);
  const errors = docs.flatMap((d) => d.errors);
  if (errors.length) {
    throw new Error(`[${label}] результат правки не парсится: ${errors[0]}`);
  }
}

// Настоящий unified diff через `git diff --no-index`, а не самодельный алгоритм —
// прототип должен доказывать точечность правки, не переизобретать diff.
export function printDiff(label, before, after) {
  assertReparsable(after, label);
  const dir = mkdtempSync(join(tmpdir(), 'surgical-edit-'));
  const a = join(dir, 'before.yml');
  const b = join(dir, 'after.yml');
  writeFileSync(a, before);
  writeFileSync(b, after);
  let out = '';
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '-U1', a, b], { encoding: 'utf8' });
  } catch (e) {
    // git diff завершается с кодом 1, когда файлы отличаются — это не ошибка
    out = e.stdout ?? '';
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n=== ${label} ===`);
  console.log(out.split('\n').slice(4).join('\n').trim() || '(без изменений)');
  return out;
}
