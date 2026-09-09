import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parsePrototypeFile, type PrototypeFile } from '../../src/core/prototype-yaml';

/**
 * Real `crystall-edge` prototype files, copied 1:1 from
 * `prototype/prototype-surgical-edits` (spec #20, "Testing Decisions"). `bom.yml`
 * is `light.yml` with a leading UTF-8 BOM. The tests treat these as opaque text:
 * they read a fixture, ask the core a question, and assert on offsets/strings —
 * never on CST shape.
 */
export function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/prototypes/${name}`, import.meta.url)), 'utf8');
}

/** Parse a fixture, failing loudly if it does not parse cleanly. */
export function parsedFixture(name: string): PrototypeFile {
  const result = parsePrototypeFile(fixtureText(name));
  if (!result.ok) {
    throw new Error(`fixture ${name} did not parse: ${result.errors.join('; ')}`);
  }
  return result;
}
