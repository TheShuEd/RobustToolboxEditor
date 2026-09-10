import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { completionsAt } from '../../src/core/completion';
import { parseSchemaDocument } from '../../src/core/schema';
import type { SchemaRoot } from '../../src/core/schema-contract';
import { parsedFixture } from './prototype-fixtures';

/**
 * The real schema snapshot the CLI (issue #22) produced on `crystall-edge`,
 * committed at `schema-cli/fixtures/metadata.json` — the same file the schema
 * tests read. Candidate assertions below name components/fields/enums that are
 * present in it.
 */
function schema(): SchemaRoot {
  const text = readFileSync(
    fileURLToPath(new URL('../../schema-cli/fixtures/metadata.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseSchemaDocument(text);
  if (!parsed.ok) throw new Error(`schema snapshot did not parse: ${parsed.reason}`);
  return parsed.root;
}

const SCHEMA = schema();

/** Labels of the candidates, for set-style assertions. */
function labels(file: ReturnType<typeof parsedFixture>, offset: number): string[] {
  return completionsAt(file.text, offset, SCHEMA).map((c) => c.label);
}

describe('completionsAt — component names after `- type:`', () => {
  it('offers component names from the schema on the `type:` value slot', () => {
    const file = parsedFixture('completion_contexts.yml');
    const offset = file.text.indexOf('- type: Action') + '- type: Act'.length;

    const candidates = completionsAt(file.text, offset, SCHEMA);
    const action = candidates.find((c) => c.label === 'Action');

    expect(action).toEqual({ kind: 'component', label: 'Action', detail: 'ActionComponent' });
    // detail is the class short name, not the fully-qualified type.
    expect(action?.detail).not.toContain('.');
    expect(candidates.map((c) => c.label)).toEqual(expect.arrayContaining(['Sprite', 'MeleeWeapon']));
    expect(candidates.every((c) => c.kind === 'component')).toBe(true);
  });

  it('also fires inside fireaxe.yml, a real fork file', () => {
    const file = parsedFixture('fireaxe.yml');
    const offset = file.text.indexOf('- type: MeleeWeapon') + '- type: Mel'.length;

    expect(labels(file, offset)).toEqual(expect.arrayContaining(['MeleeWeapon', 'Sprite', 'Tag']));
  });
});

describe('completionsAt — component fields', () => {
  it('offers the component\'s fields and drops the ones already written in the block', () => {
    const file = parsedFixture('fireaxe.yml');
    // Caret on the `swingLeft` key inside `- type: MeleeWeapon`.
    const offset = file.text.indexOf('swingLeft: true') + 'swing'.length;

    const found = labels(file, offset);

    // Offered: real MeleeWeapon fields not yet present in this block.
    expect(found).toEqual(expect.arrayContaining(['swingLeft', 'range', 'angle', 'animation']));
    // Excluded: sibling keys already written in the same component block.
    expect(found).not.toContain('attackRate');
    expect(found).not.toContain('damage');
    expect(found).not.toContain('wideAnimationRotation');
    // Never the `type:` discriminator.
    expect(found).not.toContain('type');
    expect(completionsAt(file.text, offset, SCHEMA).every((c) => c.kind === 'field')).toBe(true);
  });
});

describe('completionsAt — nested DataDefinition fields', () => {
  it('offers the fields of the DataDefinition the key chain lands in', () => {
    const file = parsedFixture('completion_contexts.yml');
    // Caret on `superSlippery` inside `slipData:` (SlipperyEffectEntry) of a reagent.
    const offset = file.text.indexOf('superSlippery: true') + 'super'.length;

    const found = labels(file, offset);

    expect(found).toEqual(
      expect.arrayContaining(['superSlippery', 'stunTime', 'knockdownTime', 'autoStand']),
    );
    // `slipFriction` is already written in the block.
    expect(found).not.toContain('slipFriction');
    // Not reagent-prototype fields — we are inside the nested definition.
    expect(found).not.toContain('boilingPoint');
  });
});

describe('completionsAt — prototype fields by `[Prototype]` type', () => {
  it('offers ReagentPrototype fields for a `- type: reagent` document', () => {
    const file = parsedFixture('completion_contexts.yml');
    // Caret on the top-level `name` key of the reagent prototype.
    const offset = file.text.indexOf('  name: test chem') + '  na'.length;

    const found = labels(file, offset);

    expect(found).toEqual(expect.arrayContaining(['flavor', 'meltingPoint', 'specificHeat', 'color']));
    // Already-present top-level keys are excluded (the caret key `name` aside).
    expect(found).not.toContain('id');
    expect(found).not.toContain('boilingPoint');
    expect(found).not.toContain('slipData');
  });

  it('offers EntityPrototype fields for a `- type: entity` document', () => {
    const file = parsedFixture('fireaxe.yml');
    const offset = file.text.indexOf('  id: FireAxe') + '  i'.length;

    const found = labels(file, offset);
    expect(found).toEqual(expect.arrayContaining(['id', 'suffix', 'categories']));
    expect(found).not.toContain('name');
    expect(found).not.toContain('description');
  });
});

describe('completionsAt — enum values', () => {
  it('offers the enum members on an enum-typed field value', () => {
    const file = parsedFixture('completion_contexts.yml');
    const offset = file.text.indexOf('itemIconStyle: BigAction') + 'itemIconStyle: Big'.length;

    const candidates = completionsAt(file.text, offset, SCHEMA);
    expect(candidates.map((c) => c.label).sort()).toEqual(['BigAction', 'BigItem', 'NoItem']);
    expect(candidates.every((c) => c.kind === 'enum-value')).toBe(true);
  });

  it('is empty on a non-enum field value', () => {
    const file = parsedFixture('completion_contexts.yml');
    const offset = file.text.indexOf('boilingPoint: 300') + 'boilingPoint: 3'.length;
    expect(completionsAt(file.text, offset, SCHEMA)).toEqual([]);
  });
});

/**
 * Mid-edit positions — a caret line with no `:` on it yet. These run over both
 * line endings: real fork files on Windows are CRLF, and the whole recovery path
 * is regex-driven, so a `\r` left on the line silently disables it (issue #27
 * follow-up — the first cut only ever ran against LF strings).
 */
describe.each([
  ['LF', '\n'],
  ['CRLF', '\r\n'],
])('completionsAt — mid-edit, %s', (_name, eol) => {
  /** Join lines with the EOL under test; the caret goes at the end of the last one. */
  function atEndOf(lines: readonly string[]): { text: string; offset: number } {
    const text = lines.join(eol) + eol;
    return { text, offset: lines.join(eol).length };
  }

  const meleeBlock = [
    '- type: entity',
    '  id: X',
    '  components:',
    '  - type: MeleeWeapon',
    '    attackRate: 1',
  ];

  it('offers component fields on a half-typed key with no colon', () => {
    const { text, offset } = atEndOf([...meleeBlock, '    swingL']);

    const found = completionsAt(text, offset, SCHEMA).map((c) => c.label);
    expect(found).toContain('swingLeft');
    expect(found).not.toContain('attackRate'); // sibling already written
  });

  it('offers component fields on a blank indented line (Ctrl+Space)', () => {
    const { text, offset } = atEndOf([...meleeBlock, '    ']);

    const found = completionsAt(text, offset, SCHEMA).map((c) => c.label);
    expect(found).toEqual(expect.arrayContaining(['swingLeft', 'range', 'damage']));
    expect(found).not.toContain('attackRate');
  });

  it('offers prototype fields on a blank line at the top level', () => {
    const { text, offset } = atEndOf(['- type: reagent', '  id: X', '  ']);

    const found = completionsAt(text, offset, SCHEMA).map((c) => c.label);
    expect(found).toEqual(expect.arrayContaining(['flavor', 'boilingPoint', 'color']));
    expect(found).not.toContain('id');
  });

  it('offers nested DataDefinition fields even when `yaml` mis-parsed the key as a scalar', () => {
    // `damage:` followed by a bare `t` — `yaml` reads it as `damage: "t"`, a
    // valid-looking scalar, so recovery must still kick in off the missing `:`.
    const { text, offset } = atEndOf([
      '- type: entity',
      '  id: X',
      '  components:',
      '  - type: MeleeWeapon',
      '    damage:',
      '      t',
    ]);
    expect(completionsAt(text, offset, SCHEMA).map((c) => c.label)).toEqual(['types']);
  });

  it('does not offer field keys on a sequence-item line', () => {
    const { text } = atEndOf([
      '- type: entity',
      '  id: X',
      '  components:',
      '  - type: GuideHelp',
      '    guides:',
      '    - CEMiningGuideEN',
    ]);
    const offset = text.indexOf('- CEMiningGuideEN') + '- CEMining'.length;
    expect(completionsAt(text, offset, SCHEMA)).toEqual([]);
  });

  it('leaves an existing `key: value` line to the direct parse', () => {
    const { text } = atEndOf([...meleeBlock, '    swingLeft: true']);
    const offset = text.indexOf('    swingLeft') + '    swing'.length;

    const found = completionsAt(text, offset, SCHEMA).map((c) => c.label);
    expect(found).toContain('swingLeft');
    expect(found).not.toContain('attackRate');
  });

  it('still offers enum values on a value slot', () => {
    const { text } = atEndOf([
      '- type: entity',
      '  id: X',
      '  components:',
      '  - type: Action',
      '    itemIconStyle: Big',
    ]);
    const offset = text.indexOf('itemIconStyle: Big') + 'itemIconStyle: Big'.length;
    expect(completionsAt(text, offset, SCHEMA).map((c) => c.label).sort()).toEqual([
      'BigAction',
      'BigItem',
      'NoItem',
    ]);
  });

  it('returns [] when the document is unparseable and the line is not a key', () => {
    const { text, offset } = atEndOf(['- type: entity', '  id: X', '  : : broken']);
    expect(completionsAt(text, offset, SCHEMA)).toEqual([]);
  });

  it('offers component names on a bare `- `, inserting the `type:` it still needs', () => {
    const { text, offset } = atEndOf([...meleeBlock, '  - ']);

    const candidates = completionsAt(text, offset, SCHEMA);
    const sprite = candidates.find((c) => c.label === 'Sprite');
    expect(sprite).toEqual({
      label: 'Sprite',
      kind: 'component',
      detail: 'SpriteComponent',
      insertText: 'type: Sprite',
    });
    expect(candidates.every((c) => c.kind === 'component')).toBe(true);
  });

  it('re-supplies the space when the caret sits right against the dash', () => {
    const { text, offset } = atEndOf([...meleeBlock, '  -']);
    const sprite = completionsAt(text, offset, SCHEMA).find((c) => c.label === 'Sprite');
    expect(sprite?.insertText).toBe(' type: Sprite');
  });

  it('offers prototype types on a bare `- ` at the top level', () => {
    const { text, offset } = atEndOf(['- type: entity', '  id: X', '', '- ']);

    const candidates = completionsAt(text, offset, SCHEMA);
    expect(candidates.map((c) => c.label)).toEqual(expect.arrayContaining(['entity', 'reagent']));
    expect(candidates.every((c) => c.kind === 'prototype')).toBe(true);
    expect(candidates.find((c) => c.label === 'reagent')?.insertText).toBe('type: reagent');
  });

  it('does not offer anything on a bare `- ` in a scalar sequence', () => {
    const { text, offset } = atEndOf([
      '- type: entity',
      '  id: X',
      '  components:',
      '  - type: GuideHelp',
      '    guides:',
      '    - CEMiningGuideEN',
      '    - ',
    ]);
    expect(completionsAt(text, offset, SCHEMA)).toEqual([]);
  });
});

/**
 * The `type:` value of the prototype itself — the sibling of the component-name
 * point, one level out. Its empty-slot form (`- type: ` with nothing after)
 * needs the same recovery: that offset is past the end of every node range.
 */
describe.each([
  ['LF', '\n'],
  ['CRLF', '\r\n'],
])('completionsAt — prototype types, %s', (_name, eol) => {
  it('offers prototype types on a half-typed `- type: ent`', () => {
    const text = ['- type: entity', '  id: X', '', '- type: ent'].join(eol) + eol;
    const offset = text.lastIndexOf('ent') + 'ent'.length;

    const candidates = completionsAt(text, offset, SCHEMA);
    expect(candidates.map((c) => c.label)).toEqual(expect.arrayContaining(['entity', 'reagent']));
    expect(candidates.every((c) => c.kind === 'prototype')).toBe(true);
    // The author already typed `type: `, so the label inserts as-is.
    expect(candidates.every((c) => c.insertText === undefined)).toBe(true);
  });

  it('offers prototype types on an empty `- type: ` slot', () => {
    const text = ['- type: entity', '  id: X', '', '- type: '].join(eol) + eol;
    const offset = text.length - eol.length;

    expect(completionsAt(text, offset, SCHEMA).map((c) => c.label)).toEqual(
      expect.arrayContaining(['entity', 'reagent', 'jobIcon']),
    );
  });

  it('still offers component names on an empty `type: ` slot inside components:', () => {
    const text =
      ['- type: entity', '  id: X', '  components:', '  - type: '].join(eol) + eol;
    const offset = text.length - eol.length;

    const candidates = completionsAt(text, offset, SCHEMA);
    expect(candidates.map((c) => c.label)).toEqual(expect.arrayContaining(['Sprite', 'MeleeWeapon']));
    expect(candidates.every((c) => c.kind === 'component')).toBe(true);
  });
});

describe('completionsAt — nothing to offer', () => {
  it('returns [] outside every prototype', () => {
    const file = parsedFixture('completion_contexts.yml');
    expect(completionsAt(file.text, file.text.length + 50, SCHEMA)).toEqual([]);
  });

  it('returns [] when the prototype type is not in the schema', () => {
    const nakedSchema = { ...SCHEMA, prototypes: {}, components: {} };
    const file = parsedFixture('fireaxe.yml');
    const offset = file.text.indexOf('  id: FireAxe') + '  i'.length;
    expect(completionsAt(file.text, offset, nakedSchema)).toEqual([]);
  });
});
