// Прототип для issue #14: единственный открытый вопрос из "Residual unknowns" п.3
// (docs/research/ts-yaml-node-positions.md) — семантика вставки (класс 2 insertKey, класс 3
// insertComponentBlock из issue #10) рядом с комментарием, прилипшим к ПОСЛЕДНЕМУ существующему
// полю/компоненту контейнера, куда идёт вставка. На fireaxe.yml (issue #10) такого места не было
// вообще — ни у одной из двух точек вставки нет соседнего комментария. Три новые фикстуры из
// форка crystall-edge закрывают все четыре комбинации {карта, components:-список} x {трейлинг на
// той же строке, standalone на отдельной строке}.
import { readFileSync } from 'node:fs';
import { loadPrototypeFile, findEntity, findComponent, findField } from './lib/model.mjs';
import { insertKey, insertComponentBlock } from './lib/edits.mjs';
import { printDiff } from './lib/diff.mjs';

function splice(text, start, end, insertion) {
  return text.slice(0, start) + insertion + text.slice(end);
}

// Наивная (дотикетная #14) версия точки вставки — range[2] ПОСЛЕДНЕГО поля/элемента, а не
// range[2] самого контейнера. Воспроизведена здесь ЛОКАЛЬНО, только для демонстрации разницы —
// в lib/edits.mjs эта версия больше не используется (см. комментарии в lib/edits.mjs).
function naiveInsertKeyOffset(containerNode) {
  const last = containerNode.items[containerNode.items.length - 1];
  return last.value.range[2];
}
function naiveInsertComponentBlockOffset(componentsSeq) {
  const items = componentsSeq.items;
  return items[items.length - 1].range[2];
}

console.log('####################################################################');
console.log('# 1. Трейлинг-комментарий на той же строке, что последнее поле —');
console.log('#    fixtures/mapping.yml, BaseMappingDecalAction.WorldTargetAction.event');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/mapping.yml', import.meta.url), 'utf8');
  const { doc } = loadPrototypeFile(original);
  const entity = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'BaseMappingDecalAction',
  );
  const { componentNode } = findComponent(entity, 'WorldTargetAction');
  const { pair } = findField(componentNode, ['event']);
  console.log(`event.comment (трейлинг того же поля) = ${JSON.stringify(pair.value.comment)}`);
  const naive = naiveInsertKeyOffset(componentNode);
  const fixed = componentNode.range[2];
  console.log(`naive offset (range[2] последнего ПОЛЯ)     = ${naive}`);
  console.log(`fixed offset (range[2] самого КОНТЕЙНЕРА)   = ${fixed}`);
  console.log(`совпадают? ${naive === fixed} — трейлинг-комментарий на той же строке уже поглощён`);
  console.log('nodeEnd поля/значения (docs/05_content_nodes.md): "value-end ... node-end covers trailing');
  console.log('whitespace/comment/newline that the composer associates with the node" — здесь это и есть');
  console.log('сам комментарий, поэтому range[2] последнего поля УЖЕ landит после него. Наивный и');
  console.log('исправленный алгоритм здесь тождественны — доказано равенством офсетов, не предположением.');
}

console.log('\n####################################################################');
console.log('# 2. Тот же файл: класс 2 (insertKey) и класс 3 (insertComponentBlock) —');
console.log('#    фактический прогон через lib/edits.mjs (исправленную версию)');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/mapping.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = findEntity(doc, 1); // BaseMappingDecalAction
  const { componentNode, componentsSeq } = findComponent(entity, 'WorldTargetAction');

  const afterKey = insertKey(text, lineCounter, componentNode, 'range', '-1', eol);
  printDiff(
    'Класс 2: новое поле в WorldTargetAction рядом с трейлинг-комментарием у event',
    text,
    afterKey,
  );

  const afterBlock = insertComponentBlock(
    text,
    lineCounter,
    componentsSeq,
    ['type: DecalPlacementBlocker', 'radius: 1'],
    eol,
  );
  printDiff(
    'Класс 3: новый компонент после WorldTargetAction (тот же трейлинг-комментарий рядом)',
    text,
    afterBlock,
  );
  console.log('В обоих диффах комментарий "# has to be set with SetEvent..." остаётся ровно на своей');
  console.log('исходной строке, новая строка(и) уходят СРАЗУ после неё, до пустой строки перед следующей entity.');
}

console.log('\n####################################################################');
console.log('# 2b. Бонус: вставка ровно на границе EOF — fixtures/mapping.yml,');
console.log('#     BaseMappingEntityAction.InstantAction.event — последнее поле последнего компонента');
console.log('#     последней entity файла, комментарий заканчивается на самом конце файла (нет \\n\\n после).');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/mapping.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'BaseMappingEntityAction',
  );
  const { componentNode } = findComponent(entity, 'InstantAction');
  console.log(`text.length = ${text.length}, componentNode.range[2] = ${componentNode.range[2]} (offset == EOF)`);
  const after = insertKey(text, lineCounter, componentNode, 'range', '2', eol);
  printDiff('Класс 2 на самой границе EOF', text, after);
}

console.log('\n####################################################################');
console.log('# 3. Standalone многострочный комментарий-блок после последнего поля карты —');
console.log('#    fixtures/alert_levels.yml, запись Red (без components:, плоская карта)');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/alert_levels.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const red = doc.contents.items.find((e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'Red');
  const { pair } = findField(red, ['shuttleTime']);
  console.log(`shuttleTime.comment (значение поля) = ${JSON.stringify(pair.value.comment)} — комментарий НЕ здесь`);
  console.log(`red.comment (карта целиком) = ${JSON.stringify(red.comment)}`);

  const naive = naiveInsertKeyOffset(red);
  const fixed = red.range[2];
  console.log(`\nnaive offset (range[2] последнего ПОЛЯ shuttleTime) = ${naive}`);
  console.log(`fixed offset (range[2] самой карты Red)              = ${fixed}`);
  console.log(`совпадают? ${naive === fixed} — НЕТ: standalone-комментарий блока НЕ входит в диапазон`);
  console.log('последнего поля, а входит только в range[2] контейнера целиком.');

  const naiveAfter = splice(text, naive, naive, `  emergencyLightBlink: true${eol}`);
  printDiff('НАИВНЫЙ алгоритм (range[2] последнего поля) — комментарий оторван от Red, торчит в середине', text, naiveAfter);

  const fixedAfter = insertKey(text, lineCounter, red, 'emergencyLightBlink', 'true', eol);
  printDiff('ИСПРАВЛЕННЫЙ insertKey (range[2] контейнера) — комментарий остаётся на месте, поле после него', text, fixedAfter);
}

console.log('\n####################################################################');
console.log('# 4. Standalone комментарий после последнего компонента, перед закрытием');
console.log('#    components: — fixtures/drinks_bottles_plastic.yml, DrinkSugarJug ("# TODO new sprite",');
console.log('#    паттерн повторяется 12 раз в этом же файле — не единичный случай)');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/drinks_bottles_plastic.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'DrinkSugarJug',
  );
  const { componentsSeq, componentNode } = findComponent(entity, 'Label');
  console.log(`Label(componentNode).comment = ${JSON.stringify(componentNode.comment)} — комментарий НЕ здесь`);
  console.log(`componentsSeq.comment = ${JSON.stringify(componentsSeq.comment)} — а вот здесь`);

  const naive = naiveInsertComponentBlockOffset(componentsSeq);
  const fixed = componentsSeq.range[2];
  console.log(`\nnaive offset (range[2] последнего КОМПОНЕНТА Label) = ${naive}`);
  console.log(`fixed offset (range[2] самой seq components:)        = ${fixed}`);
  console.log(`совпадают? ${naive === fixed} — НЕТ`);

  const naiveBlock = '  - type: Sprite\r\n    sprite: Objects/Consumable/Drinks/sugarjug.rsi\r\n';
  const naiveAfter = splice(text, naive, naive, naiveBlock);
  printDiff(
    'НАИВНЫЙ insertComponentBlock (range[2] последнего элемента) — "# TODO new sprite" оказывается ПОСЛЕ нового Sprite-компонента (иронично и неверно)',
    text,
    naiveAfter,
  );

  const fixedAfter = insertComponentBlock(
    text,
    lineCounter,
    componentsSeq,
    ['type: Sprite', 'sprite: Objects/Consumable/Drinks/sugarjug.rsi'],
    eol,
  );
  printDiff(
    'ИСПРАВЛЕННЫЙ insertComponentBlock (range[2] seq) — "# TODO new sprite" остаётся последней строкой entity, новый компонент вставлен ПЕРЕД ним',
    text,
    fixedAfter,
  );
}

console.log('\nВывод: у трейлинг-комментария на строке последнего поля/компонента наивный и');
console.log('исправленный офсет всегда совпадают (комментарий уже поглощён в range[2] значения).');
console.log('У standalone-комментария на отдельной строке они расходятся: наивный офсет (range[2]');
console.log('последнего элемента) вставляет НОВОЕ содержимое МЕЖДУ последним полем/компонентом и его');
console.log('комментарием, отрывая комментарий от того, к чему он относился. Исправление — брать');
console.log('range[2] самого КОНТЕЙНЕРА (карты для insertKey, components:-seq для insertComponentBlock),');
console.log('а не последнего элемента; на уже доказанных no-comment случаях (fireaxe.yml) оба офсета');
console.log('тождественны, так что фикс не меняет прежнее поведение — см. lib/edits.mjs.');
