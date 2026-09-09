// Прототип для issue #10: побочные вопросы карты — удаление с комментариями,
// якоря/алиасы, `!type:`-теги, многострочные блочные скаляры. На реальных фикстурах
// из форка crystall-edge (не только fireaxe.yml — там этих хазардов просто нет).
import { readFileSync } from 'node:fs';
import { isAlias } from 'yaml';
import { loadPrototypeFile, findEntity, findComponent, findField } from './lib/model.mjs';
import { replaceScalar, replaceBlockScalar, deleteSeqItem, deleteMapKey } from './lib/edits.mjs';
import { printDiff } from './lib/diff.mjs';

// --- Удаление ключа: комментарий перед ПЕРВЫМ элементом карты принадлежит контейнеру ---
// fixtures/fireaxe.yml, MeleeWeapon.damage.types: комментарий "axes are kinda like sharp
// hammers..." стоит перед Blunt — первым ключом карты types. В AST он оказывается на
// `typesMap.commentBefore`, а не на паре Blunt. Значит удаление Blunt не должно (и физически
// не может через deleteMapKey с диапазоном самой пары) задеть этот комментарий — он размечает
// карту в целом, а не конкретно первое поле.
{
  const original = readFileSync(new URL('./fixtures/fireaxe.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const entity = findEntity(doc, 0);
  const { componentNode } = findComponent(entity, 'MeleeWeapon');
  const { pair: typesPair } = findField(componentNode, ['damage', 'types']);
  const typesMap = typesPair.value;
  console.log(`\ntypesMap.commentBefore = ${JSON.stringify(typesMap.commentBefore)} (висит на контейнере, не на первом ключе)`);
  const after = deleteMapKey(text, typesMap, 'Blunt');
  printDiff('Удаление ПЕРВОГО ключа карты — комментарий контейнера остаётся на месте', text, after);
}

// --- Удаление элемента списка: комментарий перед НЕ-первым элементом принадлежит ЕМУ ---
// fixtures/job.yml: "# Cargo" стоит перед JobIconCargoTechnician — вторым элементом
// top-level списка. В AST это `entity.commentBefore` самой entity, и CST даёт точный offset
// начала комментария в `.start[0]` этого элемента — удаление элемента прицельно забирает
// комментарий с собой.
{
  const original = readFileSync(new URL('./fixtures/job.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const seq = doc.contents;
  console.log(`\nseq.items[1].commentBefore = ${JSON.stringify(seq.items[1].commentBefore)} (висит на самом элементе)`);
  const after = deleteSeqItem(text, seq, 1);
  printDiff('Удаление НЕ-первого элемента списка — прилипший комментарий уходит вместе с ним', text, after);
}

// --- Якорь/алиас: правка на месте под алиасом переписывает только ссылку ---
// fixtures/job.yml: `&icon-rsi` на JobIconCargoTechnician.icon.sprite, `*icon-rsi` — на
// JobIconShaftMiner и ещё нескольких. Инспектор, открытый на JobIconShaftMiner, не должен
// молча заменить `*icon-rsi` на голую строку.
{
  const original = readFileSync(new URL('./fixtures/job.yml', import.meta.url), 'utf8');
  const { doc } = loadPrototypeFile(original);
  const shaftMiner = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'JobIconShaftMiner',
  );
  const { pair } = findField(shaftMiner.items.find((p) => p.key.value === 'icon').value, ['sprite']);
  console.log(`\nJobIconShaftMiner.icon.sprite — узел ${isAlias(pair.value) ? 'Alias' : pair.value.constructor.name} (*${pair.value.source})`);
  try {
    replaceScalar('', pair, '/Textures/other.rsi');
    console.log('ОШИБКА: replaceScalar должен был отказать на алиасе');
  } catch (e) {
    console.log(`replaceScalar корректно отказал: ${e.message}`);
  }
}

// --- !type:-тег переживает правку соседнего поля ---
// fixtures/light.yml: `- !type:AddZNetworkComponents` — тег висит на узле карты как
// `.tag`-строка, вне диапазона любого из вложенных скаляров. Правка соседнего поля
// (seed у CECloudsOverlay) не должна тронуть строку с тегом.
{
  const original = readFileSync(new URL('./fixtures/light.yml', import.meta.url), 'utf8');
  const { text, doc } = loadPrototypeFile(original);
  const modifier = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'LightDefault',
  );
  const effects = modifier.items.find((p) => p.key.value === 'effects').value;
  const tagged = effects.items[0];
  console.log(`\neffects[0].tag = ${tagged.tag}`);
  const clouds = tagged.items.find((p) => p.key.value === 'components').value.items.find(
    (m) => m.items.find((p) => p.key.value === 'type')?.value.value === 'CECloudsOverlay',
  );
  const { pair } = findField(clouds, ['seed']);
  const after = replaceScalar(text, pair, '777');
  const diff = printDiff('Правка поля рядом с !type:-тегом — тег не задет', text, after);
  if (!diff.includes('!type:AddZNetworkComponents') && after.includes('!type:AddZNetworkComponents')) {
    console.log('(тег отсутствует в diff — значит не изменился; в файле он остался)');
  }
}

// --- Многострочный блочный скаляр (`description: |`) ---
// fixtures/memorial.yml: `range` блочного скаляра включает индикатор `|` и все переносы
// строк как сырой текст — наивная замена диапазона голым текстом сломает форматирование.
// replaceBlockScalar переиспользует реальный отступ контента и пересобирает блок.
{
  const original = readFileSync(new URL('./fixtures/memorial.yml', import.meta.url), 'utf8');
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = doc.contents.items.find(
    (e) => e.items.find((p) => p.key.value === 'id')?.value.value === 'SS13Memorial',
  );
  const { pair } = findField(entity, ['description']);
  console.log(`\ndescription — ${pair.value.type}, raw range захватывает индикатор и все строки целиком`);
  const after = replaceBlockScalar(
    text,
    lineCounter,
    pair,
    ['Rewritten memorial text,', 'now with a second reason to grieve.'],
    eol,
  );
  printDiff('Замена блочного скаляра — переиндентирован, стиль | сохранён', text, after);
}
