import { describe, expect, it } from 'vitest';

import { resolveField } from '../../src/core/prototype-yaml';
import { parsedFixture } from './prototype-fixtures';

describe('resolveField — path to text range', () => {
  const fireaxe = parsedFixture('fireaxe.yml');

  it('returns a scalar value range with no trailing whitespace or comment', () => {
    const memorial = parsedFixture('memorial.yml');
    // Monolith (entity 2), Sprite.color — the line carries a trailing `#...` comment.
    const res = resolveField(memorial, { entityIndex: 2, component: 'Sprite', fieldPath: ['color'] });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    const slice = memorial.text.slice(res.field.valueRange[0], res.field.valueRange[1]);
    expect(slice).toBe('"#1a1a22"');
    expect(slice).not.toContain('#yes');
  });

  it('keeps a !type: tag outside the value range', () => {
    const mapping = parsedFixture('mapping.yml');
    // ActionMappingEraser (entity 3), InstantAction.event — `!type:StartPlacementActionEvent`.
    const res = resolveField(mapping, { entityIndex: 3, component: 'InstantAction', fieldPath: ['event'] });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    expect(res.field.kind).toBe('map');
    expect(res.field.tag).toBe('!type:StartPlacementActionEvent');
    const slice = mapping.text.slice(res.field.valueRange[0], res.field.valueRange[1]);
    expect(slice).not.toContain('!type:');
  });

  describe('missingPath tells the three cases apart (fireaxe FireAxeFlaming.MeleeWeapon)', () => {
    const address = (fieldPath: string[]) => ({
      entityIndex: 1,
      component: 'MeleeWeapon',
      fieldPath,
    });

    it('present: the field exists in the text (missingPath length 0)', () => {
      const res = resolveField(fireaxe, address(['swingLeft']));
      expect(res.outcome).toBe('resolved');
      if (res.outcome !== 'resolved') return;
      expect(fireaxe.text.slice(res.field.valueRange[0], res.field.valueRange[1])).toBe('true');
    });

    it('leaf missing: only the last key is absent (missingPath length 1)', () => {
      const res = resolveField(fireaxe, address(['attackRate']));
      expect(res.outcome).toBe('missing');
      if (res.outcome !== 'missing') return;
      expect(res.missing.missingPath).toEqual(['attackRate']);
    });

    it('chain missing: a whole container chain is absent (missingPath length > 1)', () => {
      const res = resolveField(fireaxe, address(['damage', 'types', 'Piercing']));
      expect(res.outcome).toBe('missing');
      if (res.outcome !== 'missing') return;
      expect(res.missing.missingPath).toEqual(['damage', 'types', 'Piercing']);
    });
  });

  it('finds a component by its type value, not its position in components:', () => {
    // IgniteOnMeleeHit is the last component of FireAxe (entity 0); Tag is first.
    const res = resolveField(fireaxe, {
      entityIndex: 0,
      component: 'IgniteOnMeleeHit',
      fieldPath: ['fireStacks'],
    });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    expect(fireaxe.text.slice(res.field.valueRange[0], res.field.valueRange[1])).toBe('-4');
  });

  it('reports component-not-found for a type that is not in components:', () => {
    const res = resolveField(fireaxe, { entityIndex: 0, component: 'NoSuchComponent', fieldPath: ['x'] });
    expect(res.outcome).toBe('component-not-found');
  });

  it('descends an arbitrary key chain', () => {
    const res = resolveField(fireaxe, {
      entityIndex: 0,
      component: 'MeleeWeapon',
      fieldPath: ['damage', 'types', 'Blunt'],
    });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    expect(fireaxe.text.slice(res.field.valueRange[0], res.field.valueRange[1])).toBe('5');
  });

  it('flags an anchored scalar and excludes the &name marker from the range (job)', () => {
    const job = parsedFixture('job.yml');
    // JobIconCargoTechnician (entity 1) defines `sprite: &icon-rsi /Textures/...`.
    const res = resolveField(job, { entityIndex: 1, fieldPath: ['icon', 'sprite'] });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    expect(res.field.anchor).toBe('icon-rsi');
    const slice = job.text.slice(res.field.valueRange[0], res.field.valueRange[1]);
    expect(slice).toBe('/Textures/Interface/Misc/job_icons.rsi');
    expect(slice).not.toContain('&');
  });

  it('flags an alias field (job)', () => {
    const job = parsedFixture('job.yml');
    // JobIconShaftMiner (entity 2) uses `sprite: *icon-rsi`.
    const res = resolveField(job, { entityIndex: 2, fieldPath: ['icon', 'sprite'] });

    expect(res.outcome).toBe('resolved');
    if (res.outcome !== 'resolved') return;
    expect(res.field.kind).toBe('alias');
    expect(res.field.alias).toBe('icon-rsi');
  });

  it('reports entity-not-found for an out-of-range index', () => {
    expect(resolveField(fireaxe, { entityIndex: 99, fieldPath: ['id'] }).outcome).toBe('entity-not-found');
  });
});
