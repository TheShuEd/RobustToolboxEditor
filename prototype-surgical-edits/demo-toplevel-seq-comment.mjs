// Прототип для issue #17: последний нерешённый пункт из "Не проверено" секции issue #10
// (см. lib/edits.mjs, старый комментарий deleteSeqItem) — комментарий прямо перед САМЫМ ПЕРВЫМ
// элементом top-level последовательности прототипов (документ = YAMLSeq без обёртывающего ключа,
// в отличие от `components:`, который является YAMLSeq ВНУТРИ карты). Вопрос: принадлежит такой
// комментарий контейнеру (как первый ключ карты, issue #10) или элементу?
//
// Ответ оказался ТРЕТЬИМ вариантом, отличным от обеих гипотез "как карта" / "как components:":
// комментарий перед самым первым элементом ЛЮБОЙ последовательности лежит в сыром CST-потоке
// токенов ДО того, как появляется контейнер, которому он мог бы принадлежать. Если контейнер к
// этому моменту уже существует (вложенный список, напр. `components:` — сам список уже "открыт"
// ключом `components:`), комментарий достаётся ЕМУ (`componentsSeq.commentBefore`) — точно так
// же, как для карт. Но если контейнера ещё нет вовсе — а top-level-последовательность прототипов
// в момент, когда парсер видит самый первый комментарий файла, ещё не существует как узел, её тип
// (seq или map) не известен, пока не встретится первый настоящий токен — комментарию некуда
// приписаться "к контейнеру", и Composer отдаёт его ПЕРВОМУ реально составленному узлу:
// `doc.contents.items[0].commentBefore`.
//
// Две фикстуры из форка crystall-edge:
// - fixtures/types.yml (Actions/types.yml) — ГЛАВНАЯ фикстура тикета: 43 entity, комментарий
//   перед самым первым entity состоит из ДВУХ групп, разделённых пустой строкой ("# base
//   actions" — общий заголовок файла, затем "# base prototype for all action entities" —
//   комментарий, специфичный именно для BaseAction, без пустой строки перед самой entity).
// - fixtures/substation.yml (Entities/Structures/Power/substation.yml) — ВСПОМОГАТЕЛЬНАЯ
//   фикстура: демонстрирует ОБА случая в одном файле — комментарий перед самым первым entity
//   документа (top-level, ведёт себя как в types.yml) И комментарий перед самым первым
//   компонентом вложенного `components:` (ведёт себя как у карт — достаётся контейнеру).
import { readFileSync } from 'node:fs';
import { loadPrototypeFile, findEntity } from './lib/model.mjs';
import { deleteSeqItem } from './lib/edits.mjs';
import { printDiff } from './lib/diff.mjs';

function splice(text, start, end, insertion) {
  return text.slice(0, start) + insertion + text.slice(end);
}

// Наивная (дотикетная #17) версия deleteSeqItem — без специального случая для index===0.
// Воспроизведена здесь ЛОКАЛЬНО для демонстрации разницы; в lib/edits.mjs эта версия больше
// не используется.
function naiveDeleteSeqItem(text, seqNode, index) {
  const item = seqNode.items[index];
  const cstItem = seqNode.srcToken.items[index];
  const start = cstItem.start[0]?.offset ?? item.range[0];
  const end = item.range[2];
  return splice(text, start, end, '');
}

console.log('####################################################################');
console.log('# 1. Кому принадлежит комментарий перед САМЫМ ПЕРВЫМ элементом');
console.log('#    top-level последовательности — fixtures/types.yml');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/types.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter } = loadPrototypeFile(original);
  const seq = doc.contents;

  console.log(`\nВсего entity в файле: ${seq.items.length}`);
  console.log(`doc.commentBefore              = ${JSON.stringify(doc.commentBefore)}`);
  console.log(`doc.contents.commentBefore     = ${JSON.stringify(seq.commentBefore)} (root YAMLSeq — НЕ берёт)`);
  console.log(`doc.contents.range             = [${seq.range}] (начинается ПОСЛЕ комментария, на строке ${lineCounter.linePos(seq.range[0]).line})`);
  console.log(`items[0].commentBefore         = ${JSON.stringify(seq.items[0].commentBefore)}`);
  console.log(`items[0].range                 = [${seq.items[0].range}] (строка ${lineCounter.linePos(seq.items[0].range[0]).line})`);
  console.log(`\nСырой текст [0:70]: ${JSON.stringify(text.slice(0, 70))}`);
  console.log('\nВывод: ни Document (doc.commentBefore=null), ни сама последовательность');
  console.log('(doc.contents.commentBefore=undefined) не владеют комментарием — оба этих узла');
  console.log('физически начинаются ПОСЛЕ него (range[0]=60, а комментарий занимает байты 0..59).');
  console.log('Владелец — САМ ПЕРВЫЙ ЭЛЕМЕНТ (items[0].commentBefore), и это объединённая строка');
  console.log('ОБЕИХ комментарных групп ("# base actions" + пустая строка + "# base prototype...")');
  console.log('— несмотря на то что первая группа читается как общий заголовок файла, а не как');
  console.log('комментарий конкретно про BaseAction. AST не различает эти две группы отдельно.');

  console.log('\n--- Сравнение с НЕ-первым элементом (items[1], уже доказанное правило issue #10) ---');
  console.log(`items[1].commentBefore = ${JSON.stringify(seq.items[1].commentBefore)} (строка ${lineCounter.linePos(seq.items[1].range[0]).line}) — тоже на элементе, как и всегда для НЕ-первых.`);
}

console.log('\n####################################################################');
console.log('# 2. Удаление ПЕРВОГО entity (index 0) — до фикса #17 (наивная версия)');
console.log('#    комментарий остаётся висеть осиротевшим');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/types.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const seq = doc.contents;
  const naiveAfter = naiveDeleteSeqItem(text, seq, 0);
  printDiff(
    'НАИВНЫЙ deleteSeqItem (без isFirst-случая) на index 0 — комментарий про BaseAction остаётся, но BaseAction удалён',
    text,
    naiveAfter,
  );
  console.log('\nПервые 120 символов результата:', JSON.stringify(naiveAfter.slice(0, 120)));
  console.log('Оба комментарных блока ("base actions" и "base prototype for all action entities")');
  console.log('пережили удаление BaseAction — хотя AST называет их именно items[0].commentBefore,');
  console.log('а не свойством контейнера. Комментарий сирота: теперь он висит перед');
  console.log('BaseDoAfterAction (у которого уже есть СВОЙ собственный, отдельный, корректно');
  console.log('прилипший комментарий "# base proto for an action that requires a DoAfter").');
}

console.log('\n####################################################################');
console.log('# 3. Удаление ПЕРВОГО entity (index 0) — ИСПРАВЛЕННЫЙ deleteSeqItem (lib/edits.mjs)');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/types.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const seq = doc.contents;
  const fixedAfter = deleteSeqItem(text, seq, 0);
  printDiff(
    'ИСПРАВЛЕННЫЙ deleteSeqItem на index 0 — оба комментарных блока уходят вместе с BaseAction',
    text,
    fixedAfter,
  );
  console.log('\nПервые 120 символов результата:', JSON.stringify(fixedAfter.slice(0, 120)));
  console.log('Теперь файл начинается сразу с "# base proto for an action that requires a DoAfter"');
  console.log('— собственного комментария НОВОГО первого entity (BaseDoAfterAction), без остатков');
  console.log('комментария удалённого BaseAction. Ровно то, что подразумевает items[0].commentBefore.');
}

console.log('\n####################################################################');
console.log('# 4. Санити-чек: удаление ВТОРОГО entity (index 1) — правило issue #10 не сломано');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/types.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const seq = doc.contents;
  const after = deleteSeqItem(text, seq, 1);
  printDiff(
    'Удаление НЕ-первого entity (BaseDoAfterAction, index 1) — его собственный комментарий уходит вместе с ним, как и раньше',
    text,
    after,
  );
}

console.log('\n####################################################################');
console.log('# 5. Контраст: комментарий перед первым элементом ВЛОЖЕННОГО списка —');
console.log('#    fixtures/substation.yml, CoreSubstation.components (ведёт себя КАК КАРТА)');
console.log('####################################################################');
{
  const original = readFileSync(new URL('./fixtures/substation.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter } = loadPrototypeFile(original);
  const seq = doc.contents;

  console.log(`\n--- Тот же top-level-эффект, что и в types.yml, но с ОДНОЙ комментарной строкой ---`);
  console.log(`doc.contents.commentBefore = ${JSON.stringify(seq.commentBefore)} (root YAMLSeq — НЕ берёт)`);
  console.log(`items[0].commentBefore     = ${JSON.stringify(seq.items[0].commentBefore)} (первый entity — берёт)`);

  const entity0 = findEntity(doc, 0);
  const compPair = entity0.items.find((p) => p.key.value === 'components');
  const componentsSeq = compPair.value;
  console.log(`\n--- А вот ВЛОЖЕННЫЙ список components: ведёт себя ИНАЧЕ ---`);
  console.log(`componentsSeq.commentBefore            = ${JSON.stringify(componentsSeq.commentBefore)} (сам контейнер — БЕРЁТ, как карта)`);
  console.log(`componentsSeq.items[0].commentBefore   = ${JSON.stringify(componentsSeq.items[0].commentBefore)} (первый компонент Battery — НЕ берёт)`);
  console.log(`componentsSeq.range                    = [${componentsSeq.range}] (строка ${lineCounter.linePos(componentsSeq.range[0]).line})`);
  console.log(`componentsSeq.items[0].range           = [${componentsSeq.items[0].range}] (строка ${lineCounter.linePos(componentsSeq.items[0].range[0]).line})`);
  console.log(`\nСырой текст вокруг components: ${JSON.stringify(text.slice(compPair.key.range[0] - 2, componentsSeq.range[0] + 20))}`);

  console.log('\n--- deleteSeqItem на первом компоненте ВЛОЖЕННОГО списка ---');
  console.log('Комментарий "# Core power behavior" не требует отдельной правки (он вне диапазона');
  console.log('любого элемента, item.commentBefore для Battery === undefined) — НО эта фикстура');
  console.log('вскрыла ДРУГОЙ, независимый от комментариев баг: cstItem.start[0].offset элемента 0');
  console.log(`(${componentsSeq.srcToken.items[0].start[0].offset}, сам дефис) не включает СОБСТВЕННЫЙ отступ Battery на той же строке`);
  console.log('("  - type: Battery" — 2 пробела перед дефисом принадлежат никому, точно как у');
  console.log('первого ключа карты). Наивная (дотикетная) версия deleteSeqItem на этом месте ломает YAML:');

  const naiveNested = naiveDeleteSeqItem(text, componentsSeq, 0);
  try {
    printDiff('НАИВНЫЙ deleteSeqItem (без index===0 случая) на первом компоненте Battery', text, naiveNested);
  } catch (e) {
    console.log(`  -> printDiff отказал на re-parse: ${e.message.split('\n')[0]}`);
    console.log('  (не просто задвоенный отступ, как у карт, — здесь список вообще перестаёт парситься)');
  }

  console.log('\nИсправленный deleteSeqItem всегда берёт lineStart(text, anchor) для index===0 (см.');
  console.log('firstItemStart в lib/edits.mjs), даже без комментария — а дополнительный откат через');
  console.log('комментарий/пустую строку включается ТОЛЬКО если item.commentBefore истинен (здесь —');
  console.log('нет, так что откат останавливается на границе строки дефиса, комментарий контейнера');
  console.log('остаётся нетронутым):');
  const afterNested = deleteSeqItem(text, componentsSeq, 0);
  printDiff(
    'Удаление первого КОМПОНЕНТА (Battery, index 0 componentsSeq) — исправленный deleteSeqItem: чистый diff, валидный YAML',
    text,
    afterNested,
  );
}

console.log('\n####################################################################');
console.log('# Вывод');
console.log('####################################################################');
console.log(`
Комментарий перед самым первым элементом ПОСЛЕДОВАТЕЛЬНОСТИ — НЕ симметричен правилу для карт
(issue #10: "первый ключ карты — комментарий у контейнера"). У последовательностей действует
третье, более общее правило: комментарий достаётся ПЕРВОМУ УЗЛУ, которому есть куда его
приписать в момент composition. Если сама последовательность уже существует как открытый
контейнер (вложенный список, напр. components:) — комментарий достаётся ЕЙ (как у карт).
Если последовательность ЕЩЁ НЕ СУЩЕСТВУЕТ как узел (самый верх документа, top-level-seq
прототипов) — комментарий достаётся её первому элементу (items[0].commentBefore).

deleteSeqItem исправлен для index===0 в ДВУХ независимых направлениях (firstItemStart в
lib/edits.mjs): (1) ВСЕГДА берёт lineStart(text, anchor) вместо голого anchor — иначе собственный
отступ первого элемента вложенного списка осиротевает и ломает YAML целиком (fixtures/substation.yml,
Battery — без этого фикса demo падал на re-parse); (2) ДОПОЛНИТЕЛЬНО откатывается назад через
весь непрерывный блок комментарий/пустая-строка, но ТОЛЬКО когда item.commentBefore истинен —
это и есть top-level-случай (fixtures/types.yml). Оба условия проверяются независимо, поэтому
вложенный список без комментария (Battery) получает только поправку (1), top-level с комментарием
(BaseAction) — обе. Регрессии нет: demo-hazards.mjs, demo-fireaxe.mjs и demo-comment-insertion.mjs
дают тот же вывод, что и до фикса (единственный существующий вызов deleteSeqItem — job.yml,
index 1, не задет ни одним из двух условий).
`);
