import { parseDocument, LineCounter, isAlias } from 'yaml';

export function loadPrototypeFile(text) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true, strict: false });
  if (doc.errors.length) {
    throw new Error(`YAML не парсится начисто (doc.errors.length=${doc.errors.length}) — инспектор должен уйти в read-only, не резать текст: ${doc.errors[0]}`);
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { text, lineCounter, doc, eol };
}

export function colAt(lineCounter, offset) {
  return lineCounter.linePos(offset).col;
}

// entity identity внутри top-level последовательности прототипов — позиционный индекс.
// Стабилен на время жизни одного открытого документа: реордер извне = полный re-parse,
// узлы дерева всё равно пересоздаются целиком, так что индекс не «протухает» тише, чем весь документ.
export function findEntity(doc, entityIndex) {
  const entity = doc.contents.items[entityIndex];
  if (!entity) throw new Error(`нет entity с индексом ${entityIndex}`);
  return entity;
}

// component identity — ЗНАЧЕНИЕ поля `type:`, не индекс в списке.
// Причины (см. README): движок не допускает двух компонентов одного типа на одной entity,
// поэтому type — уже уникальный ключ; индекс рассыпается при любой вставке/удалении соседа
// в том же редакторском шаге; и мерженный (с учётом наследования) список в UI вообще не обязан
// совпадать по порядку с сырым списком в файле — только type согласован по обе стороны.
export function findComponent(entityNode, componentType) {
  const componentsPair = entityNode.items.find((p) => p.key.value === 'components');
  if (!componentsPair) return { componentsSeq: null, componentNode: null };
  const componentsSeq = componentsPair.value;
  const componentNode = componentsSeq.items.find(
    (m) => m.items.find((p) => p.key.value === 'type')?.value.value === componentType,
  );
  return { componentsSeq, componentNode };
}

// Спуск по цепочке ключей внутри карты (напр. ['damage', 'types', 'Blunt']).
// Останавливается на первом отсутствующем в тексте ключе — какой бы глубины путь ни был,
// а не только у последнего ключа. `container` — глубочайшая карта, реально существующая в
// тексте; `missingPath` — хвост пути, которого в тексте нет вообще (может быть длиннее одного
// ключа: issue #16, `damage.types.Piercing`, когда в файле нет ни `damage`, ни `types`).
// `missingPath.length === 0` — пара найдена (класс 1, замена на месте); `=== 1` — найден только
// контейнер последнего ключа (класс 2, insertKey); `> 1` — не найден контейнер вовсе на какой-то
// промежуточной глубине (класс 4, insertNestedPath — материализация всей цепочки разом).
export function findField(mapNode, fieldPath) {
  let node = mapNode;
  for (let i = 0; i < fieldPath.length - 1; i++) {
    const pair = node.items.find((p) => p.key.value === fieldPath[i]);
    if (!pair) return { container: node, pair: null, missingPath: fieldPath.slice(i) };
    node = pair.value;
  }
  const lastKey = fieldPath[fieldPath.length - 1];
  const pair = node.items.find((p) => p.key.value === lastKey);
  return { container: node, pair: pair ?? null, missingPath: pair ? [] : [lastKey] };
}

export function assertNotAlias(node, label) {
  if (isAlias(node)) {
    throw new Error(
      `${label} — это YAML-алиас (*${node.source}): правка на месте перепишет только эту ссылку ` +
        `и разорвёт связь с якорем, а не поменяет значение везде, где алиас использован. ` +
        `Инспектор должен считать такое поле read-only без явного жеста «открепить от якоря».`,
    );
  }
}
