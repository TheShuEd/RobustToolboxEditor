import { describe, expect, it } from 'vitest';

import { generateNonce } from '../../src/core/nonce';

describe('generateNonce', () => {
  it('defaults to a 32-character string', () => {
    expect(generateNonce()).toHaveLength(32);
  });

  it('honours an explicit length', () => {
    expect(generateNonce(16)).toHaveLength(16);
  });

  it('emits only URL-safe alphanumerics', () => {
    expect(generateNonce(256)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('is different on each call', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });
});
