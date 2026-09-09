// Прототип для issue #10: путь в схеме -> диапазон текста, три класса правок,
// на настоящем файле форка crystall-edge (fixtures/fireaxe.yml — 1:1 копия
// Resources/Prototypes/Entities/Objects/Weapons/Melee/fireaxe.yml).
import { readFileSync } from 'node:fs';
import { loadPrototypeFile, findEntity, findComponent, findField } from './lib/model.mjs';
import { replaceScalar, insertKey, insertComponentBlock } from './lib/edits.mjs';
import { printDiff } from './lib/diff.mjs';

const original = readFileSync(new URL('./fixtures/fireaxe.yml', import.meta.url), 'utf8');

// --- Класс 1: замена скаляра на месте ---
// Путь: entity 0 (FireAxe) -> компонент Sprite (по type:, не по индексу) -> поле state.
{
  const { text, doc } = loadPrototypeFile(original);
  const entity = findEntity(doc, 0);
  const { componentNode } = findComponent(entity, 'Sprite');
  const { pair } = findField(componentNode, ['state']);
  const after = replaceScalar(text, pair, 'icon-open');
  printDiff('Класс 1: скаляр на месте (FireAxe.Sprite.state: icon -> icon-open)', text, after);
}

// --- Класс 2: добавление ключа, которого в файле нет (материализация унаследованного) ---
// Путь: entity 1 (FireAxeFlaming) -> компонент MeleeWeapon -> поле attackRate.
// В файле у второго MeleeWeapon нет attackRate вовсе — оно наследуется от родителя FireAxe.
// Инспектор материализует его как явный ключ дочернего прототипа.
{
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = findEntity(doc, 1);
  const { componentNode } = findComponent(entity, 'MeleeWeapon');
  const existing = findField(componentNode, ['attackRate']);
  if (existing.pair) throw new Error('ожидали отсутствие attackRate в файле — фикстура изменилась?');
  const after = insertKey(text, lineCounter, componentNode, 'attackRate', '0.9', eol);
  printDiff('Класс 2: материализация унаследованного поля (FireAxeFlaming.MeleeWeapon.attackRate = 0.9)', text, after);
}

// --- Класс 3: добавление целого блока `- type: X` в components: ---
// Путь: entity 0 (FireAxe) -> components: -> новый компонент SharpDamageSound (условный).
{
  const { text, doc, lineCounter, eol } = loadPrototypeFile(original);
  const entity = findEntity(doc, 0);
  const { componentsSeq, componentNode: existing } = findComponent(entity, 'SharpDamageSound');
  if (existing) throw new Error('ожидали отсутствие SharpDamageSound в файле — фикстура изменилась?');
  const after = insertComponentBlock(
    text,
    lineCounter,
    componentsSeq,
    ['type: SharpDamageSound', 'sound:', '  collection: MetalThud'],
    eol,
  );
  printDiff('Класс 3: новый компонент в components: (FireAxe + SharpDamageSound)', text, after);
}

console.log('\nВсе три класса правок применены на реальном файле форка; смотри диффы выше — тронуты только целевые строки.');
