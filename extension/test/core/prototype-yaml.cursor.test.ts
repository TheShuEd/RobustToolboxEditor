import { describe, expect, it } from 'vitest';

import { cursorContextAt, positionAt } from '../../src/core/prototype-yaml';
import { parsedFixture } from './prototype-fixtures';

describe('cursorContextAt — offset to context', () => {
  const fireaxe = parsedFixture('fireaxe.yml');

  it('inside components:, on the `- type:` slot', () => {
    const offset = fireaxe.text.indexOf('type: Tag') + 'type: T'.length;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.prototypeType).toBe('entity');
    expect(ctx.component).toBe('Tag');
    expect(ctx.fieldPath).toEqual([]);
    expect(ctx.token).toEqual({ kind: 'component-type', text: 'Tag' });
  });

  it('on the `type` key itself (not its value) reports a key token, not component-type', () => {
    const offset = fireaxe.text.indexOf('- type: Tag') + '- ty'.length;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.component).toBe('Tag');
    expect(ctx.fieldPath).toEqual(['type']);
    expect(ctx.token).toEqual({ kind: 'key', name: 'type' });
  });

  it('in the gap between a `key:` and its value still lands on that field', () => {
    const offset = fireaxe.text.indexOf('description: Truly') + 'description:'.length;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.component).toBeNull();
    expect(ctx.fieldPath).toEqual(['description']);
    expect(ctx.token).toEqual({ kind: 'value' });
  });

  it('on a component field key', () => {
    const offset = fireaxe.text.indexOf('swingLeft: true') + 2;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.component).toBe('MeleeWeapon');
    expect(ctx.fieldPath).toEqual(['swingLeft']);
    expect(ctx.token).toEqual({ kind: 'key', name: 'swingLeft' });
  });

  it('on the value of a top-level prototype field', () => {
    const offset = fireaxe.text.indexOf('Truly, the weapon') + 3;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.component).toBeNull();
    expect(ctx.fieldPath).toEqual(['description']);
    expect(ctx.token).toEqual({ kind: 'value' });
  });

  it('on the `parent:` key', () => {
    const offset = fireaxe.text.indexOf('parent: [BaseItem') + 2;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.entityIndex).toBe(0);
    expect(ctx.component).toBeNull();
    expect(ctx.fieldPath).toEqual(['parent']);
    expect(ctx.token).toEqual({ kind: 'key', name: 'parent' });
  });

  it('keeps the full key chain on a deeply nested value', () => {
    const offset = fireaxe.text.indexOf('Blunt: 5') + 'Blunt: '.length;
    const ctx = cursorContextAt(fireaxe, offset);

    expect(ctx.component).toBe('MeleeWeapon');
    expect(ctx.fieldPath).toEqual(['damage', 'types', 'Blunt']);
    expect(ctx.token).toEqual({ kind: 'value' });
  });

  it('marks an anchored value with its anchor name (job)', () => {
    const job = parsedFixture('job.yml');
    const offset = job.text.indexOf('&icon-rsi /Textures') + '&icon-rsi /Tex'.length;
    const ctx = cursorContextAt(job, offset);

    expect(ctx.entityIndex).toBe(1);
    expect(ctx.fieldPath).toEqual(['icon', 'sprite']);
    expect(ctx.token).toEqual({ kind: 'value' });
    expect(ctx.anchor).toBe('icon-rsi');
    expect(ctx.alias).toBeUndefined();
  });

  it('marks an alias value with its target name (job)', () => {
    const job = parsedFixture('job.yml');
    const offset = job.text.indexOf('sprite: *icon-rsi') + 'sprite: *ic'.length;
    const ctx = cursorContextAt(job, offset);

    expect(ctx.entityIndex).toBe(2);
    expect(ctx.fieldPath).toEqual(['icon', 'sprite']);
    expect(ctx.alias).toBe('icon-rsi');
    expect(ctx.anchor).toBeUndefined();
  });

  it('returns an empty context for an offset outside every prototype', () => {
    const ctx = cursorContextAt(fireaxe, fireaxe.text.length + 50);

    expect(ctx.entityIndex).toBeNull();
    expect(ctx.prototypeType).toBeNull();
    expect(ctx.component).toBeNull();
    expect(ctx.fieldPath).toEqual([]);
    expect(ctx.token).toEqual({ kind: 'none' });
  });

  it('positionAt converts an offset to a 0-based line/character', () => {
    expect(positionAt(fireaxe, 0)).toEqual({ line: 0, character: 0 });
    const idOffset = fireaxe.text.indexOf('id: FireAxe');
    const pos = positionAt(fireaxe, idOffset);
    expect(pos.line).toBe(3);
    expect(pos.character).toBe(2);
  });
});
