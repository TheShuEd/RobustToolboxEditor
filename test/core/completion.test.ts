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

describe('completionsAt — half-typed key with no colon yet', () => {
  it('recovers a bare key line so field completion still fires mid-edit', () => {
    // `swingL` with no `:` — `yaml` rejects the whole document; the core splices
    // a colon onto that line and re-parses.
    const text = [
      '- type: entity',
      '  id: X',
      '  components:',
      '  - type: MeleeWeapon',
      '    attackRate: 1',
      '    swingL',
      '',
    ].join('\n');
    const offset = text.indexOf('swingL') + 'swingL'.length;

    const found = completionsAt(text, offset, SCHEMA).map((c) => c.label);
    expect(found).toContain('swingLeft');
    // sibling already written in the block is still excluded
    expect(found).not.toContain('attackRate');
  });

  it('recovers a bare key at the top level of a prototype', () => {
    const text = ['- type: reagent', '  id: X', '  fla', ''].join('\n');
    const offset = text.indexOf('  fla') + '  fla'.length;

    expect(completionsAt(text, offset, SCHEMA).map((c) => c.label)).toContain('flavor');
  });

  it('returns [] when the document is unparseable and not a bare-key line', () => {
    const text = ['- type: entity', '  id: X', '  : : broken', ''].join('\n');
    expect(completionsAt(text, text.length - 1, SCHEMA)).toEqual([]);
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
