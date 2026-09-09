import { colAt, assertNotAlias } from './model.mjs';

function splice(text, start, end, insertion) {
  return text.slice(0, start) + insertion + text.slice(end);
}

// Класс 1: замена скаляра на месте. `pair.value.range` — [start, end) точного текста значения,
// без хвостовых пробелов/комментариев. Комментарии, теги, якоря соседних узлов вне диапазона —
// физически не могут быть задеты.
export function replaceScalar(text, pair, newRaw) {
  const valueNode = pair.value;
  assertNotAlias(valueNode, `значение ключа "${pair.key.value}"`);
  if (valueNode.type === 'BLOCK_LITERAL' || valueNode.type === 'BLOCK_FOLDED') {
    throw new Error(`значение "${pair.key.value}" — блочный скаляр (${valueNode.type}), нужен replaceBlockScalar`);
  }
  const [start, end] = valueNode.range;
  return splice(text, start, end, newRaw);
}

// Блочные скаляры (`|`, `>`) хранят индикатор и переносы строк как часть собственного `range`:
// наивная замена диапазона голым текстом сломает форматирование. Нужно заново собрать блок:
// сохранить стиль (`|` vs `>`), переиспользовать реальный отступ контента, переиндентировать
// каждую строку нового значения.
export function replaceBlockScalar(text, lineCounter, pair, newLines, eol) {
  const valueNode = pair.value;
  assertNotAlias(valueNode, `значение ключа "${pair.key.value}"`);
  const [start, , end] = valueNode.range;
  const raw = text.slice(start, valueNode.range[1]);
  const headerEnd = raw.indexOf('\n');
  const header = raw.slice(0, headerEnd).replace(/\r$/, ''); // '|', '|-', '>', и т.п.
  const indentMatch = raw.slice(headerEnd + 1).match(/^( +)/);
  const indent = indentMatch ? indentMatch[1] : ' '.repeat(colAt(lineCounter, start) - 1 + 2);
  const body = newLines.map((l) => `${indent}${l}${eol}`).join('');
  return splice(text, start, end, `${header}${eol}${body}`);
}

// Класс 2: добавление ключа, которого в файле нет (материализация унаследованного значения).
// Точка вставки — граница `range[2]` САМОГО КОНТЕЙНЕРА (карты), а не последнего поля.
// Раньше здесь стояло `last.value.range[2]` (range[2] значения последнего поля) — это
// эмпирически совпадает с `containerNode.range[2]` в дырка-нет-комментария случае (проверено
// на fireaxe.yml, issue #10), но РАСХОДИТСЯ, когда последнее поле карты сопровождается
// STANDALONE-комментарием на отдельной строке (не трейлинг на той же строке): такой комментарий
// в CST/AST `yaml`@eemeli становится `.comment` САМОЙ карты (`containerNode.comment`), а
// `containerNode.range[2]` расширяется, чтобы включить комментарий и последующие пустые строки —
// а `last.value.range[2]` останавливается ДО комментария. Вставка по `last.value.range[2]` в
// этом случае воткнула бы новую строку МЕЖДУ последним полем и его комментарием, оторвав
// комментарий от того, к чему он относился (см. docs/research/yaml-insertion-near-comments.md,
// фикстура `alert_levels.yml`). `containerNode.range[2]` корректен в обоих случаях —
// доказано равенством на fireaxe.yml и на `alert_levels.yml`/`mapping.yml` для новых.
// Отступ берём с колонки первого соседнего ключа того же контейнера — в блочных картах SS14
// все поля одного узла всегда на одной колонке.
export function insertKey(text, lineCounter, containerNode, key, valueRaw, eol) {
  const items = containerNode.items;
  if (items.length === 0) throw new Error('пустой контейнер без единого существующего поля — колонку отступа взять неоткуда');
  const col = colAt(lineCounter, items[0].key.range[0]);
  const insertAt = containerNode.range[2];
  const indent = ' '.repeat(col - 1);
  return splice(text, insertAt, insertAt, `${indent}${key}: ${valueRaw}${eol}`);
}

// Класс 3: добавление целого блока `- type: X` в `components:`. Тот же приём с границей
// `range[2]`, но теперь — границей САМОЙ последовательности (`componentsSeq.range[2]`), не
// последнего элемента (`items[items.length-1].range[2]`). Причина та же, что и в insertKey:
// standalone-комментарий сразу после последнего компонента (перед закрытием `components:` —
// новой entity или концом файла) в `yaml`@eemeli становится `.comment` самой seq-ноды
// (`componentsSeq.comment`), НЕ последнего элемента и не следующей entity; `componentsSeq.range[2]`
// включает этот комментарий и хвостовые пустые строки, `items[...].range[2]` — нет. Реальный
// пример — 13 повторов `# TODO new sprite` после последнего компонента в
// fixtures/drinks_bottles_plastic.yml (см. docs/research/yaml-insertion-near-comments.md).
// Отступ считаем в двух частях: колонка первого поля первого существующего компонента даёт
// колонку ПОЛЕЙ нового блока; тире вставляем на два символа левее (`- ` перед `type:` в
// блочной последовательности съедает ровно 2 колонки).
export function insertComponentBlock(text, lineCounter, componentsSeq, lines, eol) {
  const items = componentsSeq.items;
  if (items.length === 0) throw new Error('пустой components: — колонку отступа взять неоткуда');
  const first = items[0];
  const fieldCol = colAt(lineCounter, first.items[0].key.range[0]);
  const dashIndent = ' '.repeat(fieldCol - 1 - 2);
  const fieldIndent = ' '.repeat(fieldCol - 1);
  const insertAt = componentsSeq.range[2];
  const [firstLine, ...rest] = lines;
  const block = `${dashIndent}- ${firstLine}${eol}` + rest.map((l) => `${fieldIndent}${l}${eol}`).join('');
  return splice(text, insertAt, insertAt, block);
}

function lineStart(text, offset) {
  const idx = text.lastIndexOf('\n', offset - 1);
  return idx === -1 ? 0 : idx + 1;
}

// Удаление элемента блочной последовательности (компонента) вместе с «прилипшим» комментарием.
// В CST маркер `- ` — часть СОБСТВЕННЫХ `.start`-токенов элемента, в том числе для самого первого
// (в отличие от ключей карты, см. deleteMapKey) — там же оказывается и комментарий, если он стоял
// прямо перед этим элементом (раздел `# Cargo` перед второй entity в job.yml — пример для НЕ-первого
// элемента; `.start[0].offset` уже указывает точно на конец предыдущего элемента, без зазора).
// НЕ проверено: комментарий прямо перед САМЫМ первым элементом всей последовательности —
// в наших фикстурах такого случая нет, остаётся открытым вопросом для реализации.
export function deleteSeqItem(text, seqNode, index) {
  const items = seqNode.items;
  const item = items[index];
  const cstItem = seqNode.srcToken.items[index];
  const start = cstItem.start[0]?.offset ?? item.range[0];
  const end = item.range[2];
  return splice(text, start, end, '');
}

// Удаление ключа из карты. В отличие от элементов последовательности, у записи карты нет
// собственного маркера — для НЕ-первого ключа `.start`-токены (пробел/комментарий/пустая строка)
// корректно ведут точно к концу предыдущей пары. Но для ПЕРВОЙ пары `.start` пуст даже с её
// собственным отступом внутри строки: этот отступ ничей — он не входит ни в один диапазон узла.
// Наивный `pair.key.range[0]` как границу удаления оставляет чужой отступ висеть перед новым первым
// ключом (эмпирически: получаются задвоенные пробелы). Отступ первой пары — на её собственной
// строке, без пустых строк внутри, так что откат до начала строки текстом безопасен и не заденет
// комментарий контейнера (`mapNode.commentBefore`) с предыдущей строки.
export function deleteMapKey(text, mapNode, key) {
  const index = mapNode.items.findIndex((p) => p.key.value === key);
  if (index === -1) throw new Error(`ключ "${key}" отсутствует`);
  const isFirst = index === 0;
  const pair = mapNode.items[index];
  const cstItem = mapNode.srcToken.items[index];
  const start = isFirst ? lineStart(text, pair.key.range[0]) : cstItem.start[0].offset;
  const end = pair.value.range[2];
  return splice(text, start, end, '');
}
