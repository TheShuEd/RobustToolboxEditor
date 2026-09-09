import { describe, expect, it } from 'vitest';

import { parsePrototypeFile } from '../../src/core/prototype-yaml';
import { fixtureText } from './prototype-fixtures';

const FORK_FIXTURES = [
  'fireaxe',
  'job',
  'light',
  'memorial',
  'mapping',
  'alert_levels',
  'drinks_bottles_plastic',
  'substation',
  'types',
];

describe('parsePrototypeFile', () => {
  it('parses a clean prototype file into a plain-data handle', () => {
    const result = parsePrototypeFile(fixtureText('fireaxe.yml'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hadBom).toBe(false);
    expect(result.documentCount).toBe(1);
    expect(result.entityCount).toBe(2);
  });

  it('strips a leading U+FEFF: a BOM file parses to the same shape as the same file without it', () => {
    const withBom = parsePrototypeFile(fixtureText('bom.yml')); // light.yml + BOM
    const without = parsePrototypeFile(fixtureText('light.yml'));

    expect(withBom.ok && without.ok).toBe(true);
    if (!withBom.ok || !without.ok) return;
    expect(withBom.hadBom).toBe(true);
    expect(without.hadBom).toBe(false);
    expect(withBom.documentCount).toBe(without.documentCount);
    expect(withBom.entityCount).toBe(without.entityCount);
    expect(withBom.text).toBe(without.text);
  });

  it('reports a broken document as an error flag, not an empty result', () => {
    const result = parsePrototypeFile('- type: entity\n  parent: [BaseItem,\n  id: Broken\n');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
  });

  it('parses every fork fixture without errors', () => {
    for (const name of FORK_FIXTURES) {
      expect(parsePrototypeFile(fixtureText(`${name}.yml`)).ok, name).toBe(true);
    }
  });

  it('an empty input is valid with zero prototypes', () => {
    const result = parsePrototypeFile('');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityCount).toBe(0);
  });

  it('the handle exposes only plain data — the CST never reaches callers', () => {
    const result = parsePrototypeFile(fixtureText('fireaxe.yml'));
    expect(Object.keys(result).sort()).toEqual(
      ['documentCount', 'entityCount', 'hadBom', 'ok', 'text'].sort(),
    );
  });
});
