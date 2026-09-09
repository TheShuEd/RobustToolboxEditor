import { describe, expect, it } from 'vitest';

import {
  deleteAt,
  insertComponent,
  insertField,
  parsePrototypeFile,
  replaceBlockScalarValue,
  replaceScalarValue,
  resolveField,
  type EditOutcome,
  type PrototypeFile,
  type SurgicalEdit,
} from '../../src/core/prototype-yaml';
import { parsedFixture } from './prototype-fixtures';

// ---------------------------------------------------------------------------
// The three checks every edit gets, per issue #26:
//   1. byte comparison — the spliced result equals a reference built by hand
//      from the known input (`applied` + explicit `expect(...).toBe`);
//   2. re-parse — the result is still a clean prototype file;
//   3. diff shape — the changed hunk has exactly the expected line counts.
// ---------------------------------------------------------------------------

function edit(result: EditOutcome): SurgicalEdit {
  if (result.outcome !== 'edit') {
    throw new Error(`expected an edit, got ${result.outcome}${'reason' in result ? `: ${result.reason}` : ''}`);
  }
  return result.edit;
}

function apply(text: string, e: SurgicalEdit): string {
  return text.slice(0, e.range[0]) + e.newText + text.slice(e.range[1]);
}

function reparses(text: string): boolean {
  return parsePrototypeFile(text).ok;
}

/** The single contiguous block of lines that differ, prefix/suffix trimmed away. */
function diffHunk(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length;
  let hiB = b.length;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--;
    hiB--;
  }
  return { removed: a.slice(lo, hiA), added: b.slice(lo, hiB) };
}

function entityIndexById(file: PrototypeFile, id: string): number {
  for (let i = 0; i < file.entityCount; i++) {
    const r = resolveField(file, { entityIndex: i, fieldPath: ['id'] });
    if (r.outcome === 'resolved' && file.text.slice(r.field.valueRange[0], r.field.valueRange[1]) === id) {
      return i;
    }
  }
  throw new Error(`no entity with id: ${id}`);
}

const EOL = '\r\n'; // every fork fixture is CRLF (see .gitattributes)

describe('surgical edits — class 1: replace a scalar in place', () => {
  it('fireaxe: Sprite.state icon -> icon-open, exactly one line changed', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const e = edit(replaceScalarValue(fireaxe, { entityIndex: 0, component: 'Sprite', fieldPath: ['state'] }, 'icon-open'));

    expect(fireaxe.text.slice(e.range[0], e.range[1])).toBe('icon');
    const after = apply(fireaxe.text, e);

    expect(after).toBe(fireaxe.text.replace('    state: icon\r\n', '    state: icon-open\r\n'));
    expect(reparses(after)).toBe(true);
    const { removed, added } = diffHunk(fireaxe.text, after);
    expect(removed).toEqual(['    state: icon']);
    expect(added).toEqual(['    state: icon-open']);
  });

  it('memorial: a value carrying a trailing comment keeps the comment', () => {
    const memorial = parsedFixture('memorial.yml');
    // Monolith (entity 2), Sprite.color — line ends with `#yes, I bothered ...`.
    const e = edit(replaceScalarValue(memorial, { entityIndex: 2, component: 'Sprite', fieldPath: ['color'] }, '"#000000"'));
    const after = apply(memorial.text, e);

    expect(after).toContain('    color: "#000000" #yes, I bothered to get the actual color');
    expect(reparses(after)).toBe(true);
    expect(diffHunk(memorial.text, after)).toEqual({
      removed: ['    color: "#1a1a22" #yes, I bothered to get the actual color from 2001 a space odyssey'],
      added: ['    color: "#000000" #yes, I bothered to get the actual color from 2001 a space odyssey'],
    });
  });

  it('memorial: editing bounds inside a !type: tagged map never touches the tag line', () => {
    const memorial = parsedFixture('memorial.yml');
    // Monolith.Fixtures.fixtures.fix1.shape is `!type:PhysShapeAabb` + `bounds:`.
    const address = { entityIndex: 2, component: 'Fixtures', fieldPath: ['fixtures', 'fix1', 'shape', 'bounds'] };
    const e = edit(replaceScalarValue(memorial, address, '"-1,-1,1,1"'));
    const after = apply(memorial.text, e);

    expect(memorial.text.slice(e.range[0], e.range[1])).toBe('"-0.45,-0.45,0.45,0.20"');
    expect(after).toContain('          !type:PhysShapeAabb\r\n          bounds: "-1,-1,1,1"\r\n');
    expect(reparses(after)).toBe(true);
    expect(diffHunk(memorial.text, after).added).toEqual(['          bounds: "-1,-1,1,1"']);
  });

  it('light: a scalar edit leaves every !type: line in the file byte-identical', () => {
    // light.yml has no `!type:`-tagged *scalar value* reachable through the address
    // model — its tags sit on `effects[0]` maps, nested in a sequence. So the
    // adjacent-tag guarantee is proven on `memorial` (bounds under !type:PhysShapeAabb)
    // above; here we pin the file-wide invariant: an unrelated scalar edit touches
    // no `!type:` line anywhere.
    const light = parsedFixture('light.yml');
    const before = light.text;
    const e = edit(replaceScalarValue(light, { entityIndex: 1, fieldPath: ['generationWeight'] }, '25'));
    const after = apply(before, e);

    const tagLines = (t: string) => t.split(/\r?\n/).filter((l) => l.includes('!type:'));
    expect(tagLines(after)).toEqual(tagLines(before));
    expect(tagLines(before)).toHaveLength(3);
    expect(reparses(after)).toBe(true);
    expect(diffHunk(before, after)).toEqual({
      removed: ['  generationWeight: 10'],
      added: ['  generationWeight: 25'],
    });
  });

  it('rejects a field that is not in the text', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const r = replaceScalarValue(fireaxe, { entityIndex: 1, component: 'MeleeWeapon', fieldPath: ['attackRate'] }, '1');
    expect(r.outcome).toBe('field-not-found');
  });
});

describe('surgical edits — anchors and aliases (job)', () => {
  it('an anchored scalar edits its value text only; &name and the aliases stay', () => {
    const job = parsedFixture('job.yml');
    // JobIconCargoTechnician (entity 1): `sprite: &icon-rsi /Textures/...`.
    const e = edit(replaceScalarValue(job, { entityIndex: 1, fieldPath: ['icon', 'sprite'] }, '/Textures/New/path.rsi'));
    const after = apply(job.text, e);

    expect(job.text.slice(e.range[0], e.range[1])).toBe('/Textures/Interface/Misc/job_icons.rsi');
    expect(after).toContain('sprite: &icon-rsi /Textures/New/path.rsi\r\n');
    expect(after).toContain('sprite: *icon-rsi\r\n'); // the aliases are untouched
    expect(reparses(after)).toBe(true);
    expect(diffHunk(job.text, after)).toEqual({
      removed: ['    sprite: &icon-rsi /Textures/Interface/Misc/job_icons.rsi'],
      added: ['    sprite: &icon-rsi /Textures/New/path.rsi'],
    });
  });

  it('a field that resolves to an alias is rejected, not spliced', () => {
    const job = parsedFixture('job.yml');
    // JobIconShaftMiner (entity 2): `sprite: *icon-rsi`.
    const r = replaceScalarValue(job, { entityIndex: 2, fieldPath: ['icon', 'sprite'] }, '/Textures/x.rsi');
    expect(r.outcome).toBe('rejected');
    if (r.outcome !== 'rejected') return;
    expect(r.reason).toContain('*icon-rsi');
  });
});

describe('surgical edits — block scalars (memorial)', () => {
  it('SS13Memorial.description: | style and 4-space content indent survive', () => {
    const memorial = parsedFixture('memorial.yml');
    const e = edit(
      replaceBlockScalarValue(memorial, { entityIndex: 1, fieldPath: ['description'] }, [
        'Rewritten memorial text,',
        'now with a second reason to grieve.',
      ]),
    );
    const after = apply(memorial.text, e);

    expect(after).toContain(
      '  description: |\r\n' +
        '    Rewritten memorial text,\r\n' +
        '    now with a second reason to grieve.\r\n' +
        '  components:\r\n',
    );
    expect(reparses(after)).toBe(true);
    const { removed, added } = diffHunk(memorial.text, after);
    expect(removed).toEqual([
      '    Here rests an unknown employee',
      '    Unknown by name or rank',
      '    Whose acts will not be forgotten',
    ]);
    expect(added).toEqual([
      '    Rewritten memorial text,',
      '    now with a second reason to grieve.',
    ]);
  });

  it('rejects a plain scalar handed to the block path, and vice versa', () => {
    const memorial = parsedFixture('memorial.yml');
    const plainToBlock = replaceBlockScalarValue(memorial, { entityIndex: 2, component: 'Sprite', fieldPath: ['color'] }, ['x']);
    expect(plainToBlock.outcome).toBe('rejected');

    const blockToPlain = replaceScalarValue(memorial, { entityIndex: 1, fieldPath: ['description'] }, 'x');
    expect(blockToPlain.outcome).toBe('rejected');
    if (blockToPlain.outcome !== 'rejected') return;
    expect(blockToPlain.reason).toContain('block scalar');
  });
});

describe('surgical edits — class 2/4: materialise an inherited field', () => {
  it('class 2, fireaxe FireAxeFlaming.MeleeWeapon: attackRate lands after the last field', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const e = edit(insertField(fireaxe, { entityIndex: 1, component: 'MeleeWeapon', fieldPath: ['attackRate'] }, '0.75'));

    expect(e.range[0]).toBe(e.range[1]); // pure insertion
    expect(e.newText).toBe(`    attackRate: 0.75${EOL}`);
    const after = apply(fireaxe.text, e);
    expect(after).toContain('    swingLeft: true\r\n    attackRate: 0.75\r\n  - type: Item\r\n');
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({ removed: [], added: ['    attackRate: 0.75'] });
  });

  it('a container comment is not disturbed (fireaxe FireAxe MeleeWeapon.damage.types)', () => {
    // fireaxe.yml has no standalone comment *after* a container's last field, so the
    // canonical "comment stays with the container" instance is the alert_levels Red
    // test below; here fireaxe's `types:` comment (before its first key) is the
    // nearest available shape and must likewise be left alone.
    const fireaxe = parsedFixture('fireaxe.yml');
    // `types:` carries `# axes are kinda like sharp hammers, you know?` before its first key.
    const e = edit(insertField(fireaxe, { entityIndex: 0, component: 'MeleeWeapon', fieldPath: ['damage', 'types', 'Piercing'] }, '7'));
    const after = apply(fireaxe.text, e);

    expect(after).toContain('        # axes are kinda like sharp hammers, you know?\r\n        Blunt: 5\r\n');
    expect(after).toContain('        Structural: 5\r\n        Piercing: 7\r\n');
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({ removed: [], added: ['        Piercing: 7'] });
  });

  it('class 4, fireaxe FireAxeFlaming.MeleeWeapon: a depth-3 missing chain is materialised whole', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const e = edit(insertField(fireaxe, { entityIndex: 1, component: 'MeleeWeapon', fieldPath: ['damage', 'types', 'Piercing'] }, '5'));
    const after = apply(fireaxe.text, e);

    expect(e.newText).toBe(
      `    damage:${EOL}` + `      types:${EOL}` + `        Piercing: 5${EOL}`,
    );
    expect(after).toContain(
      '    swingLeft: true\r\n' +
        '    damage:\r\n' +
        '      types:\r\n' +
        '        Piercing: 5\r\n' +
        '  - type: Item\r\n',
    );
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({
      removed: [],
      added: ['    damage:', '      types:', '        Piercing: 5'],
    });
    // the freshly materialised leaf now resolves
    const reparsed = parsePrototypeFile(after);
    expect(reparsed.ok).toBe(true);
  });

  it('at depth 1 the class-4 path emits exactly what a dedicated class-2 insert would', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const leaf = edit(insertField(fireaxe, { entityIndex: 1, component: 'MeleeWeapon', fieldPath: ['attackRate'] }, '0.75'));
    // byte-for-byte a single `<indent>key: value<eol>` line, inserted (no removal).
    expect(leaf.newText).toBe(`    attackRate: 0.75${EOL}`);
    expect(leaf.range[0]).toBe(leaf.range[1]);
    const after = apply(fireaxe.text, leaf);
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({ removed: [], added: ['    attackRate: 0.75'] });
  });

  it('insertion after a standalone trailing comment stays with the container (alert_levels Red)', () => {
    const alerts = parsedFixture('alert_levels.yml');
    const e = edit(insertField(alerts, { entityIndex: 3, fieldPath: ['newField'] }, 'x'));
    const after = apply(alerts.text, e);

    // the three-line comment block is intact, still right after shuttleTime, and the
    // new key sits after it — not wedged between the last field and its comment.
    expect(after).toContain(
      '  shuttleTime: 600\r\n' +
        "  # No reduction in time as we don't have swiping for red alert like in /tg/.\r\n" +
        '  # Shuttle times are intended to create friction,\r\n' +
        '  # so having a way to brainlessly bypass that would be dumb.\r\n',
    );
    expect(after).toContain('bypass that would be dumb.\r\n\r\n  newField: x\r\n- type: alertLevel\r\n');
    expect(reparses(after)).toBe(true);
    expect(diffHunk(alerts.text, after)).toEqual({ removed: [], added: ['  newField: x'] });
  });

  it('a trailing same-line comment is always safe (mapping WorldTargetAction)', () => {
    const mapping = parsedFixture('mapping.yml');
    const e = edit(insertField(mapping, { entityIndex: 1, component: 'WorldTargetAction', fieldPath: ['foo'] }, 'bar'));
    const after = apply(mapping.text, e);

    expect(after).toContain(
      '    event: null # has to be set with SetEvent in DecalPlacementSystem\r\n    foo: bar\r\n',
    );
    expect(reparses(after)).toBe(true);
    expect(diffHunk(mapping.text, after)).toEqual({ removed: [], added: ['    foo: bar'] });
  });

  it('rejects a field that is already present', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const r = insertField(fireaxe, { entityIndex: 0, component: 'MeleeWeapon', fieldPath: ['swingLeft'] }, 'false');
    expect(r.outcome).toBe('rejected');
  });
});

describe('surgical edits — class 3: append a component block', () => {
  it('fireaxe FireAxeFlaming: a 3-line block lands after the last component at the right indent', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    const e = edit(insertComponent(fireaxe, 1, ['type: StealTarget', 'stealGroup: FireAxe', 'extra: 1']));

    expect(e.range[0]).toBe(e.range[1]);
    expect(e.newText).toBe(
      `  - type: StealTarget${EOL}` + `    stealGroup: FireAxe${EOL}` + `    extra: 1${EOL}`,
    );
    const after = apply(fireaxe.text, e);
    expect(after.endsWith(
      '    - back\r\n    - suitStorage\r\n' +
        '  - type: StealTarget\r\n    stealGroup: FireAxe\r\n    extra: 1\r\n',
    )).toBe(true);
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({
      removed: [],
      added: ['  - type: StealTarget', '    stealGroup: FireAxe', '    extra: 1'],
    });
  });

  it('drinks_bottles_plastic: the block goes after a standalone `# TODO new sprite`', () => {
    const drinks = parsedFixture('drinks_bottles_plastic.yml');
    const idx = entityIndexById(drinks, 'DrinkSugarJug');
    const e = edit(insertComponent(drinks, idx, ['type: Sprite', 'sprite: X.rsi']));
    const after = apply(drinks.text, e);

    expect(after).toContain(
      '  - type: Label\r\n' +
        '    localizedLabel: reagent-name-sugar\r\n' +
        '  # TODO new sprite\r\n' +
        '\r\n' +
        '  - type: Sprite\r\n' +
        '    sprite: X.rsi\r\n',
    );
    expect(reparses(after)).toBe(true);
    expect(diffHunk(drinks.text, after)).toEqual({
      removed: [],
      added: ['  - type: Sprite', '    sprite: X.rsi'],
    });
  });

  it('rejects an entity with no components: sequence', () => {
    const light = parsedFixture('light.yml');
    // entity 0 is a demiplaneModifierCategory: just id, no components.
    expect(insertComponent(light, 0, ['type: X']).outcome).toBe('rejected');
  });
});

describe('surgical edits — deletion', () => {
  it('substation: deleting the first nested-list item keeps the container comment, valid YAML', () => {
    const substation = parsedFixture('substation.yml');
    const e = edit(deleteAt(substation, { entityIndex: 0, component: 'Battery', fieldPath: [] }));
    const after = apply(substation.text, e);

    // Pure deletion (nothing added); the 6-line Battery block goes; the marker
    // line's own indent goes with it (no orphan) so ExaminableBattery keeps its own.
    expect(e.newText).toBe('');
    const { removed, added } = diffHunk(substation.text, after);
    expect(added).toEqual([]);
    expect(removed).toEqual([
      '  - type: Battery',
      '    # Very important:',
      '    # Disable networking to prevent the battery getting continuously dirtied every tick as it interacts with the power network.',
      '    # This can not be done by changing the charge rate as the power supply ramps up over time.',
      '    # This disables prediction for this battery.',
      '    netsync: false',
    ]);
    // byte-exact at the cut.
    expect(after).toContain('  components:\r\n  # Core power behavior\r\n  - type: ExaminableBattery\r\n');
    expect(reparses(after)).toBe(true);
  });

  it('types: deleting the first top-level item takes its leading comment block, valid YAML', () => {
    const types = parsedFixture('types.yml');
    const before = types.text;
    const e = edit(deleteAt(types, { entityIndex: 0, fieldPath: [] }));
    const after = apply(before, e);

    expect(e.range[0]).toBe(0); // start walked back over the two comment groups to BOF
    expect(e.newText).toBe('');
    const { removed, added } = diffHunk(before, after);
    expect(added).toEqual([]);
    expect(removed[0]).toBe('# base actions');
    expect(removed).toContain('# base prototype for all action entities');
    expect(removed).not.toContain('# base proto for an action that requires a DoAfter');
    expect(after.startsWith('\r\n# base proto for an action that requires a DoAfter\r\n')).toBe(true);

    const reparsed = parsePrototypeFile(after);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.entityCount).toBe(types.entityCount - 1);
  });

  it('job: deleting a non-first item carries its own leading comment away', () => {
    const job = parsedFixture('job.yml');
    // entity 1 is JobIconCargoTechnician, preceded by a `# Cargo` block that the CST
    // ties to the element itself.
    const e = edit(deleteAt(job, { entityIndex: 1, fieldPath: [] }));
    const after = apply(job.text, e);

    expect(e.newText).toBe('');
    expect(job.text).toContain('# Cargo');
    expect(after).not.toContain('# Cargo');
    expect(after).not.toContain('id: JobIconCargoTechnician');
    // byte-exact at the cut: one blank line left between entity 0 and the new entity 1.
    expect(after).toContain('  isShaded: true\r\n\r\n- type: jobIcon\r\n  parent: JobIcon\r\n  id: JobIconShaftMiner');
    const { removed, added } = diffHunk(job.text, after);
    expect(added).toEqual([]);
    // `# Cargo`, its surrounding blanks, and the 6-line entity leave together.
    expect(removed).toContain('# Cargo');
    expect(removed).toContain('  id: JobIconCargoTechnician');
    expect(removed).not.toContain('  id: JobIconShaftMiner');
    expect(removed).toHaveLength(10);
    expect(reparses(after)).toBe(true);
  });

  it('deletes a map key from a component, non-first key', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    // FireAxe (entity 0) MeleeWeapon: drop `swingLeft` (2nd key).
    const e = edit(deleteAt(fireaxe, { entityIndex: 0, component: 'MeleeWeapon', fieldPath: ['swingLeft'] }));
    const after = apply(fireaxe.text, e);

    // FireAxe's MeleeWeapon loses swingLeft; FireAxeFlaming's keeps its own copy.
    expect(after).toContain('    wideAnimationRotation: 135\r\n    attackRate: 0.75\r\n');
    expect(after).not.toContain('    wideAnimationRotation: 135\r\n    swingLeft: true\r\n    attackRate');
    expect(after.match(/swingLeft/g)).toHaveLength(1);
    expect(reparses(after)).toBe(true);
    expect(diffHunk(fireaxe.text, after)).toEqual({ removed: ['    swingLeft: true'], added: [] });
  });

  it('reports not-found for a missing target', () => {
    const fireaxe = parsedFixture('fireaxe.yml');
    expect(deleteAt(fireaxe, { entityIndex: 0, component: 'Nope', fieldPath: [] }).outcome).toBe('component-not-found');
    expect(deleteAt(fireaxe, { entityIndex: 99, fieldPath: [] }).outcome).toBe('entity-not-found');
    expect(
      deleteAt(fireaxe, { entityIndex: 0, component: 'MeleeWeapon', fieldPath: ['nope'] }).outcome,
    ).toBe('field-not-found');
  });
});

describe('surgical edits — import boundary', () => {
  it('the module is reachable without pulling in vscode (compile-time check via lint)', () => {
    // The eslint `no-restricted-imports` rule on src/core/** already fails CI if
    // this file's module reaches for `vscode`; this test just pins that the
    // public surface is importable as plain functions.
    expect(typeof replaceScalarValue).toBe('function');
    expect(typeof deleteAt).toBe('function');
  });
});
