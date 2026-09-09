import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXPECTED_SCHEMA_VERSION } from '../../src/core/schema-contract';
import {
  interpretSchemaResult,
  parseSchemaDocument,
  schemaCacheDirName,
  type SchemaResultInput,
  type SchemaRunOutcome,
} from '../../src/core/schema';

/**
 * The real schema snapshot the CLI (issue #22) generated on the `crystall-edge`
 * fork, committed at `schema-cli/fixtures/metadata.json`. Read straight from
 * there — it is the same file later tickets treat as their schema fixture, and
 * copying 14 MB into `test/fixtures/` would only risk it drifting.
 */
function schemaFixtureText(): string {
  return readFileSync(
    fileURLToPath(new URL('../../schema-cli/fixtures/metadata.json', import.meta.url)),
    'utf8',
  );
}

/** A minimal but shape-valid schema document. */
function tinySchema(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    sourceFingerprint: 'abc123',
    prototypes: { entity: { className: 'E', yamlType: 'entity', inheriting: true, fields: [] } },
    components: {
      Transform: { className: 'T', name: 'Transform', fields: [] },
      Sprite: { className: 'S', name: 'Sprite', fields: [] },
    },
    dataDefinitions: {},
    polymorphicTypes: {},
    enumConstants: {},
    enums: {},
    ...overrides,
  });
}

const OK_RUN: SchemaRunOutcome = { kind: 'exited', code: 0, stderr: '' };

/** Build a result input, defaulting `parse` from `tinySchema()`. */
function input(over: Partial<SchemaResultInput> = {}): SchemaResultInput {
  return {
    run: OK_RUN,
    parse: parseSchemaDocument(tinySchema()),
    sidecarFingerprint: 'abc123',
    expectedVersion: EXPECTED_SCHEMA_VERSION,
    ...over,
  };
}

describe('schemaCacheDirName', () => {
  it('is "<slug>-<8 hex>" of the fork path', () => {
    const name = schemaCacheDirName('crystall-edge', 'C:\\Users\\me\\crystall-edge');
    expect(name).toMatch(/^crystall-edge-[0-9a-f]{8}$/);
  });

  it('is stable for the same path and folder name', () => {
    expect(schemaCacheDirName('fork', '/home/me/fork')).toBe(
      schemaCacheDirName('fork', '/home/me/fork'),
    );
  });

  it('separates two forks that share a folder name but sit at different paths', () => {
    expect(schemaCacheDirName('fork', '/home/me/a/fork')).not.toBe(
      schemaCacheDirName('fork', '/home/me/b/fork'),
    );
  });

  it('sanitises a folder name that is not filesystem-safe', () => {
    expect(schemaCacheDirName('my fork (v2)/../x', '/p')).toMatch(
      /^[A-Za-z0-9._-]+-[0-9a-f]{8}$/,
    );
  });
});

describe('parseSchemaDocument', () => {
  it('accepts the committed crystall-edge snapshot', () => {
    const parsed = parseSchemaDocument(schemaFixtureText());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.root.schemaVersion).toBe(EXPECTED_SCHEMA_VERSION);
    expect(Object.keys(parsed.root.components).length).toBeGreaterThan(2000);
    expect(typeof parsed.root.sourceFingerprint).toBe('string');
  });

  it('rejects text that is not JSON', () => {
    expect(parseSchemaDocument('<not json>')).toMatchObject({ ok: false });
  });

  it('rejects a JSON document missing a contract root', () => {
    expect(parseSchemaDocument(JSON.stringify({ schemaVersion: 1, components: {} }))).toMatchObject({
      ok: false,
    });
  });

  it('defaults every MetadataRoot map identically when absent', () => {
    const parsed = parseSchemaDocument(
      JSON.stringify({ schemaVersion: EXPECTED_SCHEMA_VERSION, sourceFingerprint: 'x' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.root.components).toEqual({});
    expect(parsed.root.polymorphicTypes).toEqual({});
    expect(parsed.root.enums).toEqual({});
  });
});

describe('interpretSchemaResult', () => {
  it('reports a loaded schema with the component count on success', () => {
    const status = interpretSchemaResult(input());
    expect(status).toMatchObject({
      state: 'loaded',
      componentCount: 2,
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      sourceFingerprint: 'abc123',
    });
    expect(status.message).toMatch(/2 components/);
  });

  it('names "dotnet not found" when the runtime is missing', () => {
    const status = interpretSchemaResult(input({ run: { kind: 'dotnet-missing' }, parse: undefined }));
    expect(status.state).toBe('dotnet-missing');
    expect(status.message.toLowerCase()).toContain('dotnet');
  });

  it('names an out-of-date runtime distinctly from a generic crash', () => {
    const status = interpretSchemaResult(
      input({
        run: {
          kind: 'exited',
          code: 150,
          stderr:
            "You must install or update .NET to run this application.\nFramework: 'Microsoft.NETCore.App', version '8.0.0'",
        },
        parse: undefined,
      }),
    );
    expect(status.state).toBe('dotnet-too-old');
  });

  it('flags a missing bundled extractor distinctly from a crash', () => {
    const status = interpretSchemaResult(
      input({ run: { kind: 'extractor-missing' }, parse: undefined }),
    );
    expect(status.state).toBe('extractor-missing');
  });

  it('carries the full stderr text when the CLI exits non-zero', () => {
    const stderr = 'error: unreadable assembly:\n  Content.Server.dll (bad IL)';
    const status = interpretSchemaResult(
      input({ run: { kind: 'exited', code: 1, stderr }, parse: undefined }),
    );
    expect(status).toMatchObject({ state: 'extraction-failed' });
    if (status.state !== 'extraction-failed') return;
    expect(status.stderr).toContain('unreadable assembly');
    expect(status.message).toContain('Content.Server.dll (bad IL)');
  });

  it('treats exit 0 with no metadata.json as a failed extraction', () => {
    const status = interpretSchemaResult(input({ parse: undefined }));
    expect(status.state).toBe('extraction-failed');
  });

  it('treats exit 0 with an unreadable metadata.json as a failed extraction', () => {
    const status = interpretSchemaResult(input({ parse: parseSchemaDocument('{ oops') }));
    expect(status.state).toBe('extraction-failed');
  });

  it('reports an incompatible schema when the version does not match the expected one', () => {
    const status = interpretSchemaResult(
      input({ parse: parseSchemaDocument(tinySchema({ schemaVersion: 999 })) }),
    );
    expect(status).toMatchObject({
      state: 'incompatible',
      foundVersion: 999,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
    });
  });

  it('reports a fingerprint mismatch as its own concrete cause', () => {
    const status = interpretSchemaResult(
      input({ parse: parseSchemaDocument(tinySchema({ sourceFingerprint: 'aaa' })), sidecarFingerprint: 'bbb' }),
    );
    expect(status.state).toBe('fingerprint-mismatch');
  });

  it('accepts output when no sidecar fingerprint is available to cross-check', () => {
    const status = interpretSchemaResult(input({ sidecarFingerprint: undefined }));
    expect(status.state).toBe('loaded');
  });
});
