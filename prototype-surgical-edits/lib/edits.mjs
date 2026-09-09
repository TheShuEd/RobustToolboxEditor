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

// Класс 4 (issue #16): материализация ВСЕЙ отсутствующей цепочки контейнеров разом — не только
// последнего ключа (класс 2), но произвольного числа промежуточных карт, которых в тексте нет
// вообще. Пример из тикета: `damage.types.Piercing`, когда в MeleeWeapon нет ни `damage`, ни
// `types` (реальный случай — fixtures/fireaxe.yml, FireAxeFlaming.MeleeWeapon: оба ключа
// наследуются от родителя FireAxe, в тексте потомка отсутствуют целиком).
//
// Строгое обобщение insertKey: при missingPath.length === 1 генерирует ровно ту же одну
// строку `key: value`, что и insertKey. Точка вставки — та же граница `range[2]` контейнера
// (не последнего элемента) по тем же причинам, что в insertKey/insertComponentBlock — стоит
// комментарий на последнем существующем поле или нет, роли не играет: вставляем ПОСЛЕ него.
// Отступ каждого следующего уровня — на шаг больше предыдущего. Шаг — 2 пробела, не
// предположение: это тот же эмпирически подтверждённый шаг блочного YAML SS14, что уже
// захардкожен для тире в insertComponentBlock (fireaxe.yml подтверждает его и здесь —
// damage: -> types: -> Blunt: в существующем тексте того же файла идут с шагом ровно 2, см.
// demo).
export function insertNestedPath(text, lineCounter, container, missingPath, valueRaw, eol, indentStep = 2) {
  const items = container.items;
  if (items.length === 0) throw new Error('пустой контейнер без единого существующего поля — колонку отступа взять неоткуда');
  if (missingPath.length === 0) throw new Error('missingPath пуст — материализовать нечего, пара уже есть в тексте');
  const baseCol = colAt(lineCounter, items[0].key.range[0]);
  const insertAt = container.range[2];
  const block = missingPath
    .map((key, i) => {
      const indent = ' '.repeat(baseCol - 1 + i * indentStep);
      const isLast = i === missingPath.length - 1;
      return `${indent}${key}:${isLast ? ` ${valueRaw}` : ''}${eol}`;
    })
    .join('');
  return splice(text, insertAt, insertAt, block);
}

function lineStart(text, offset) {
  const idx = text.lastIndexOf('\n', offset - 1);
  return idx === -1 ? 0 : idx + 1;
}

// index===0 нужен ДВА разных текстовых отката, оба обнаружены на issue #17
// (docs/research/top-level-seq-leading-comment.md), а не один:
//
// 1) «Осиротевший отступ» — для ЛЮБОГО вложенного (с ненулевым отступом) списка, комментарий
//    есть или нет. `cstItem.start[0].offset` элемента 0 — это офсет маркера `- ` САМОГО ПО СЕБЕ,
//    БЕЗ отступа перед ним на той же строке (в отличие от НЕ-первых элементов, чьи `.start`
//    захватывают отступ от конца предыдущего соседа). У top-level-последовательности прототипов
//    это неощутимо (отступ = 0 всегда), поэтому баг ни разу не проявлялся в demo-hazards.mjs
//    (там `deleteSeqItem` гонялся только на job.yml, top-level, индекс 1). Но для ВЛОЖЕННОГО
//    списка (`components:`) при удалении его же первого элемента наивный `anchor` оставляет
//    висеть отступ дефиса — ровно тот же класс бага, что `deleteMapKey` чинит для первого ключа
//    карты (см. её комментарий). Доказано эмпирически на `fixtures/substation.yml`,
//    `CoreSubstation.components`, элемент 0 (`Battery`, без своего commentBefore): наивная
//    версия склеивает отступ `Battery` (2 пробела) с отступом `ExaminableBattery` (тоже 2) в
//    ОДНУ строку, но поскольку между ними исчезает перевод строки количество пробелов ПЕРЕД `-`
//    следующего элемента искажается настолько, что список перестаёт парситься («A block sequence
//    may not be used as an implicit map key») — не просто задвоенный отступ как у карт, а прямая
//    порча YAML. Фикс — как у `deleteMapKey`: для index===0 брать `lineStart(text, anchor)`
//    (начало СТРОКИ маркера `- `, включая её собственный отступ), а не голый `anchor`.
//
// 2) «Комментарий перед самым первым элементом» — отдельный, более редкий случай (см. подробный
//    разбор в docs/research/top-level-seq-leading-comment.md): комментарий перед элементом 0
//    ЛЮБОЙ последовательности физически лежит в сыром CST-потоке токенов ДО токена `document`
//    (top-level-последовательность) или ДО токена самой последовательности (вложенная), то есть
//    вне `seqNode.srcToken.items[0].start`. Composer приписывает такой «бесхозный» комментарий
//    ПЕРВОМУ узлу, которому есть куда его деть в момент составления:
//    - контейнер (вложенный список) уже существует как узел → комментарий достаётся ЕМУ
//      (`componentsSeq.commentBefore`, `items[0].commentBefore === undefined`) — доказано на
//      `fixtures/substation.yml` (`# Core power behavior` перед `Battery`). Это ТО ЖЕ правило,
//      что и у карт: `lineStart(text, anchor)` из пункта 1 уже останавливается ровно на границе
//      маркера `- `, комментарий контейнера вне игры, никакого дополнительного отката не нужно.
//    - контейнера ещё нет (самый верх документа — top-level-seq прототипов ещё не существует как
//      узел, пока не встречен первый настоящий токен) → комментарий достаётся ПЕРВОМУ РЕАЛЬНО
//      СОСТАВЛЕННОМУ узлу, `items[0].commentBefore` — доказано на `fixtures/types.yml`:
//      `doc.commentBefore === null`, `doc.contents.commentBefore === undefined`, но
//      `doc.contents.items[0].commentBefore === " base actions\n\n base prototype for all action
//      entities"`. Здесь `lineStart(text, anchor)` (пункт 1) НЕ дотягивается до комментария —
//      нужен дополнительный откат назад через весь непрерывный блок комментарий/пустая-строка,
//      но ТОЛЬКО когда `item.commentBefore` истинен (иначе рискуем откатиться в комментарий
//      КОНТЕЙНЕРА из предыдущего пункта, который этому элементу не принадлежит — проверено:
//      без этого условия для `Battery` откат неверно захватывает `# Core power behavior`).
// `doc`/`doc.contents` в сигнатуру добавлять не пришлось — оба признака (глубина отступа через
// сам текст, владение комментарием через `item.commentBefore`) уже доступны без обращения к doc.
function firstItemStart(text, anchorOffset, hasOwnCommentBefore) {
  let ls = lineStart(text, anchorOffset);
  if (!hasOwnCommentBefore) return ls;
  for (;;) {
    if (ls === 0) break;
    const prevLs = lineStart(text, ls - 1);
    const prevLine = text.slice(prevLs, ls).replace(/\r?\n$/, '');
    if (prevLine !== '' && !/^\s*#/.test(prevLine)) break;
    ls = prevLs;
  }
  return ls;
}

// Удаление элемента блочной последовательности (компонента) вместе с «прилипшим» комментарием.
// В CST маркер `- ` — часть СОБСТВЕННЫХ `.start`-токенов элемента для НЕ-первых элементов, и
// туда же попадает комментарий, если он стоял прямо перед этим элементом (раздел `# Cargo` перед
// второй entity в job.yml — пример для НЕ-первого элемента; `.start[0].offset` уже указывает
// точно на конец предыдущего элемента, без зазора). Для index===0 см. комментарий у
// `firstItemStart` выше — issue #17 доказал, что этот случай нужно обрабатывать отдельно (и не
// по одной, а по двум разным причинам).
export function deleteSeqItem(text, seqNode, index) {
  const items = seqNode.items;
  const item = items[index];
  const cstItem = seqNode.srcToken.items[index];
  const anchor = cstItem.start[0]?.offset ?? item.range[0];
  const start = index === 0 ? firstItemStart(text, anchor, Boolean(item.commentBefore)) : anchor;
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
