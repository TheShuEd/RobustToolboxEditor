// Прототип для issue #16: материализация ВСЕЙ отсутствующей цепочки контейнеров разом —
// класс 4, обобщение класса 2 (insertKey, issue #10) на произвольную глубину.
// Реальный случай уже сидит в fixtures/fireaxe.yml (issue #10) и не нуждался в новой фикстуре:
// FireAxeFlaming.MeleeWeapon вообще не упоминает `damage` — оно наследуется от родителя FireAxe,
// у которого `damage.types.{Blunt,Slash,Structural}` задано текстом. Путь `damage.types.Piercing`
// у потомка отсутствует ЦЕЛИКОМ на глубине 0 (нет даже `damage`), это и есть кейс тикета.
import { readFileSync } from 'node:fs';
import { loadPrototypeFile, findEntity, findComponent, findField, colAt } from './lib/model.mjs';
import { insertKey, insertNestedPath } from './lib/edits.mjs';
import { printDiff } from './lib/diff.mjs';

const original = readFileSync(new URL('./fixtures/fireaxe.yml', import.meta.url), 'utf8');

console.log('####################################################################');
console.log('# 0. Шаг отступа 2 пробела — не предположение, измерено на РЕАЛЬНОМ');
console.log('#    тексте: FireAxe(entity 0).MeleeWeapon.damage -> types -> Blunt');
console.log('####################################################################');
{
  const { doc, lineCounter } = loadPrototypeFile(original);
  const entity = findEntity(doc, 0);
  const { componentNode } = findComponent(entity, 'MeleeWeapon');
  const { pair: damagePair } = findField(componentNode, ['damage']);
  const { pair: typesPair } = findField(componentNode, ['damage', 'types']);
  const { pair: bluntPair } = findField(componentNode, ['damage', 'types', 'Blunt']);
  const damageCol = colAt(lineCounter, damagePair.key.range[0]);
  const typesCol = colAt(lineCounter, typesPair.key.range[0]);
  const bluntCol = colAt(lineCounter, bluntPair.key.range[0]);
  console.log(`damage col=${damageCol}, types col=${typesCol} (шаг ${typesCol - damageCol}), Blunt col=${bluntCol} (шаг ${bluntCol - typesCol})`);
  if (typesCol - damageCol !== 2 || bluntCol - typesCol !== 2) {
    throw new Error('шаг отступа в реальном файле не 2 — константа indentStep в insertNestedPath устарела');
  }
  console.log('Оба шага по 2 — подтверждает indentStep=2, захардкоженный в insertNestedPath (та же величина, что уже принята для тире в insertComponentBlock).');
}

console.log('\n####################################################################');
console.log('# 1. findField больше не падает на отсутствующем промежуточном ключе —');
console.log('#    возвращает missingPath (весь хвост пути, которого нет в тексте)');
console.log('####################################################################');
{
  const { doc } = loadPrototypeFile(original);
  const entity = findEntity(doc, 1); // FireAxeFlaming
  const { componentNode } = findComponent(entity, 'MeleeWeapon');
  const { container, pair, missingPath } = findField(componentNode, ['damage', 'types', 'Piercing']);
  console.log(`pair = ${pair}, missingPath = ${JSON.stringify(missingPath)}`);
  if (pair !== null || missingPath.length !== 3) {
    throw new Error('ожидали missingPath длины 3 (damage, types, Piercing все отсутствуют) — фикстура изменилась?');
  }
  console.log('container === MeleeWeapon-компонент (глубже спускаться некуда — damage там нет вообще).');
  if (container !== componentNode) throw new Error('container должен совпасть с самим компонентом');
}

console.log('\n####################################################################');
console.log('# 2. Класс 4: материализация всей цепочки разом —');
console.log('#    FireAxeFlaming.MeleeWeapon.damage.types.Piercing = 5');
console.log('####################################################################');
{
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = findEntity(doc, 1);
  const { componentNode } = findComponent(entity, 'MeleeWeapon');
  const { container, missingPath } = findField(componentNode, ['damage', 'types', 'Piercing']);
  const after = insertNestedPath(text, lineCounter, container, missingPath, '5', eol);
  printDiff(
    'Класс 4: вся цепочка damage -> types -> Piercing материализована тремя новыми строками с нарастающим отступом',
    text,
    after,
  );
}

console.log('\n####################################################################');
console.log('# 3. Класс 4 — строгое обобщение класса 2: при missingPath.length === 1');
console.log('#    insertNestedPath даёт БУКВАЛЬНО ТУ ЖЕ строку, что insertKey (issue #10)');
console.log('####################################################################');
{
  const { text: text1, doc: doc1, lineCounter: lc1, eol: eol1 } = loadPrototypeFile(original);
  const entity1 = findEntity(doc1, 1);
  const { componentNode: mw1 } = findComponent(entity1, 'MeleeWeapon');
  const viaInsertKey = insertKey(text1, lc1, mw1, 'attackRate', '0.9', eol1);

  const { text: text2, doc: doc2, lineCounter: lc2, eol: eol2 } = loadPrototypeFile(original);
  const entity2 = findEntity(doc2, 1);
  const { componentNode: mw2 } = findComponent(entity2, 'MeleeWeapon');
  const { container, missingPath } = findField(mw2, ['attackRate']);
  const viaInsertNestedPath = insertNestedPath(text2, lc2, container, missingPath, '0.9', eol2);

  console.log(`insertKey === insertNestedPath? ${viaInsertKey === viaInsertNestedPath}`);
  if (viaInsertKey !== viaInsertNestedPath) throw new Error('класс 4 должен буквально совпадать с классом 2 при глубине 1');
  printDiff('insertNestedPath при missingPath.length===1 (эквивалент insertKey)', text2, viaInsertNestedPath);
}

console.log('\nВывод: findField теперь возвращает missingPath любой длины вместо падения на первом же');
console.log('отсутствующем промежуточном ключе; insertNestedPath материализует всю цепочку одной правкой');
console.log('(N новых строк с нарастающим на indentStep=2 отступом, N = missingPath.length) и при длине 1');
console.log('буквально вырождается в старый insertKey — не параллельная ветка кода, а его обобщение.');
