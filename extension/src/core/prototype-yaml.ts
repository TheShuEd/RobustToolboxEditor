/**
 * Prototype-file YAML core (spec #20, "Парсинг YAML" and "Хирургические правки";
 * issue #24). Pure and VS-Code-free: text in, plain data out.
 *
 * It answers the two questions every editing surface keeps asking about a
 * prototype file, and shares one path resolver between them:
 *
 *   1. path -> range  ({@link resolveField}): where in the text is the field at
 *      `{ entityIndex, component, fieldPath }` — an exact value range, or the
 *      container plus the missing key tail when the field is only inherited.
 *   2. offset -> context  ({@link cursorContextAt}): which prototype, component
 *      and field does an offset fall in, and is it on a key, a value, or the
 *      `type:` slot of a `components:` entry.
 *
 * Parsing rules, straight from the spec:
 *   - Strip a leading U+FEFF before parsing. Without it `yaml`@eemeli yields a
 *     document full of errors for ~9% of real fork files, losing them silently.
 *   - `yaml` (eemeli) with `keepSourceTokens: true`, `strict: false`, and a
 *     `LineCounter` for offset -> line/col. The CST is the oracle for positions.
 *   - No incremental parser: re-parse the whole document on every edit.
 *   - Any `doc.errors` => the file is "invalid" as a whole; callers get an error
 *     flag, never a partial tree.
 *
 * The parsed AST never leaves this module — {@link parsePrototypeFile} returns an
 * opaque handle and the CST is held in a side table. Tests see only offsets,
 * ranges, strings and enums, so they cannot grow a dependency on CST shape.
 */

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  Scalar,
  type Node,
  type Pair,
  type YAMLMap,
} from 'yaml';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Absolute UTF-16 offsets into the parsed (BOM-stripped) text: `[start, valueEnd, nodeEnd]`. */
export type NodeRange = readonly [start: number, valueEnd: number, nodeEnd: number];

export interface TextPosition {
  /** 0-based line. */
  readonly line: number;
  /** 0-based UTF-16 column. */
  readonly character: number;
}

export interface PrototypeParseError {
  readonly ok: false;
  readonly hadBom: boolean;
  /** `yaml`@eemeli parse-error messages, in source order. Never empty. */
  readonly errors: readonly string[];
}

/** Opaque handle to a successfully parsed prototype file. The CST lives elsewhere. */
export interface PrototypeFile {
  readonly ok: true;
  readonly hadBom: boolean;
  /** The text that was actually parsed: the input minus any leading U+FEFF. */
  readonly text: string;
  /** Number of YAML documents in the stream. A prototype file is normally 1. */
  readonly documentCount: number;
  /** Number of prototypes: length of the first document's top-level block sequence. */
  readonly entityCount: number;
}

export type ParseResult = PrototypeFile | PrototypeParseError;

/** Address of a single field, mirroring `prototype/prototype-surgical-edits`. */
export interface FieldAddress {
  /** Positional index into the document's top-level prototype sequence. */
  readonly entityIndex: number;
  /**
   * Value of a component's `type:` key (never a list index — the engine keeps it
   * unique). Omit to address a field on the prototype map itself (e.g. `parent`).
   */
  readonly component?: string;
  /** Key chain from the container down to the field, any depth. May be empty. */
  readonly fieldPath: readonly string[];
}

export interface ResolvedField {
  /** Full node range `[start, valueEnd, nodeEnd]`. */
  readonly range: NodeRange;
  /** `[start, valueEnd]` — value text only: no trailing whitespace, comment or tag. */
  readonly valueRange: readonly [number, number];
  readonly kind: 'scalar' | 'block-scalar' | 'map' | 'seq' | 'alias' | 'null';
  /** Anchor name when the value carries `&name`; the `&name` marker is outside `valueRange`. */
  readonly anchor?: string;
  /** Target name when the value is `*name`. */
  readonly alias?: string;
  /** Verbatim tag when present, e.g. `!type:PhysShapeAabb`; the tag is outside `valueRange`. */
  readonly tag?: string;
}

export interface MissingField {
  /**
   * Tail of `fieldPath` that is absent from the text.
   * `length === 1` — only the leaf key is missing (materialise one key);
   * `length > 1` — an intermediate container chain is missing too.
   */
  readonly missingPath: readonly string[];
  /** Range of the deepest map that does exist in the text — the anchor for a materialising edit. */
  readonly containerRange: NodeRange;
}

export type FieldResolution =
  | { readonly outcome: 'entity-not-found' }
  | { readonly outcome: 'component-not-found' }
  | { readonly outcome: 'resolved'; readonly field: ResolvedField }
  | { readonly outcome: 'missing'; readonly missing: MissingField };

export type CursorToken =
  | { readonly kind: 'key'; readonly name: string }
  | { readonly kind: 'value' }
  /** On the `type:` value slot of a `components:` entry (the component-name completion point). */
  | { readonly kind: 'component-type'; readonly text: string | null }
  | { readonly kind: 'none' };

export interface CursorContext {
  /** Index of the prototype the offset falls in, or `null` if it is between/outside prototypes. */
  readonly entityIndex: number | null;
  /** That prototype's top-level `type:` value (e.g. `entity`, `jobIcon`), or `null`. */
  readonly prototypeType: string | null;
  /** Enclosing component's `type:` value when the offset is inside `components:`, else `null`. */
  readonly component: string | null;
  /** Key chain to the field under the offset, including the field itself. Empty when on none. */
  readonly fieldPath: readonly string[];
  readonly token: CursorToken;
  /** Set when the value node under the offset carries `&name`. */
  readonly anchor?: string;
  /** Set when the value node under the offset is `*name`. */
  readonly alias?: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Internals {
  readonly text: string;
  readonly root: Node | null;
  readonly lineCounter: LineCounter;
}

const internals = new WeakMap<PrototypeFile, Internals>();

const BOM = 0xfeff;

export function parsePrototypeFile(rawText: string): ParseResult {
  const hadBom = rawText.charCodeAt(0) === BOM;
  const text = hadBom ? rawText.slice(1) : rawText;

  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, {
    lineCounter,
    keepSourceTokens: true,
    strict: false,
  });

  const errors = docs.flatMap((doc) => doc.errors).map((err) => err.message);
  if (errors.length > 0) {
    return { ok: false, hadBom, errors };
  }

  const root = docs[0]?.contents ?? null;
  const entityCount = isSeq(root) ? root.items.length : 0;

  const file: PrototypeFile = {
    ok: true,
    hadBom,
    text,
    documentCount: docs.length,
    entityCount,
  };
  internals.set(file, { text, root, lineCounter });
  return file;
}

function must(file: PrototypeFile): Internals {
  const found = internals.get(file);
  if (!found) {
    throw new Error('PrototypeFile was not produced by parsePrototypeFile()');
  }
  return found;
}

/** Convert an absolute offset into a 0-based `{ line, character }`. */
export function positionAt(file: PrototypeFile, offset: number): TextPosition {
  const { line, col } = must(file).lineCounter.linePos(offset);
  return { line: line - 1, character: col - 1 };
}

// ---------------------------------------------------------------------------
// AST helpers (module-private — never surfaced)
// ---------------------------------------------------------------------------

const EMPTY_RANGE: NodeRange = [0, 0, 0];

function rangeOf(node: Node | null | undefined): NodeRange {
  const range = node?.range;
  return range ? [range[0], range[1], range[2]] : EMPTY_RANGE;
}

/** String form of a scalar key or value; `undefined` for non-scalars and `null` scalars. */
function scalarString(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  const value = (node as Scalar).value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function findPair(map: YAMLMap, key: string): Pair | null {
  for (const pair of map.items) {
    if (scalarString(pair.key) === key) return pair as Pair;
  }
  return null;
}

function mapGet(map: YAMLMap, key: string): Node | null {
  return (findPair(map, key)?.value as Node | undefined) ?? null;
}

function findComponent(entity: YAMLMap, type: string): YAMLMap | null {
  const components = mapGet(entity, 'components');
  if (!isSeq(components)) return null;
  for (const item of components.items) {
    if (isMap(item) && scalarString(mapGet(item, 'type')) === type) return item;
  }
  return null;
}

interface Descent {
  readonly container: Node;
  readonly pair: Pair | null;
  readonly missingPath: string[];
}

/**
 * Walk `fieldPath` from `container`, stopping at the first key absent from the
 * text — mirrors `findField` in `prototype/prototype-surgical-edits/lib/model.mjs`.
 * `missingPath` is the whole absent tail, so its length classifies the edit.
 */
function findField(container: Node, fieldPath: readonly string[]): Descent {
  let node: Node = container;
  for (let i = 0; i < fieldPath.length - 1; i++) {
    if (!isMap(node)) {
      return { container: node, pair: null, missingPath: fieldPath.slice(i) };
    }
    const pair = findPair(node, fieldPath[i]);
    if (!pair || pair.value == null) {
      return { container: node, pair: null, missingPath: fieldPath.slice(i) };
    }
    node = pair.value as Node;
  }

  if (fieldPath.length === 0) {
    return { container: node, pair: null, missingPath: [] };
  }

  const last = fieldPath[fieldPath.length - 1];
  if (!isMap(node)) {
    return { container: node, pair: null, missingPath: [last] };
  }
  const pair = findPair(node, last);
  return { container: node, pair, missingPath: pair ? [] : [last] };
}

function anchorOf(node: Node): { anchor?: string } {
  const anchor = (node as { anchor?: unknown }).anchor;
  return typeof anchor === 'string' ? { anchor } : {};
}

function tagOf(node: Node): { tag?: string } {
  const tag = (node as { tag?: unknown }).tag;
  return typeof tag === 'string' && tag.startsWith('!') ? { tag } : {};
}

function describeValue(value: Node | null): ResolvedField {
  if (value == null) {
    return { range: EMPTY_RANGE, valueRange: [0, 0], kind: 'null' };
  }

  const range = rangeOf(value);
  const common = { range, valueRange: [range[0], range[1]] as [number, number], ...tagOf(value) };

  if (isAlias(value)) {
    return { ...common, kind: 'alias', alias: value.source };
  }
  if (isMap(value)) {
    return { ...common, kind: 'map', ...anchorOf(value) };
  }
  if (isSeq(value)) {
    return { ...common, kind: 'seq', ...anchorOf(value) };
  }
  if (isScalar(value)) {
    const block = value.type === Scalar.BLOCK_LITERAL || value.type === Scalar.BLOCK_FOLDED;
    const kind = block ? 'block-scalar' : value.value === null ? 'null' : 'scalar';
    return { ...common, kind, ...anchorOf(value) };
  }
  return { ...common, kind: 'null', ...anchorOf(value) };
}

// ---------------------------------------------------------------------------
// path -> range
// ---------------------------------------------------------------------------

export function resolveField(file: PrototypeFile, address: FieldAddress): FieldResolution {
  const { root } = must(file);
  if (!isSeq(root)) return { outcome: 'entity-not-found' };

  const entity = root.items[address.entityIndex];
  if (!isMap(entity)) return { outcome: 'entity-not-found' };

  let container: YAMLMap = entity;
  if (address.component !== undefined) {
    const component = findComponent(entity, address.component);
    if (!component) return { outcome: 'component-not-found' };
    container = component;
  }

  const descent = findField(container, address.fieldPath);
  if (descent.missingPath.length > 0) {
    return {
      outcome: 'missing',
      missing: {
        missingPath: descent.missingPath,
        containerRange: rangeOf(descent.container),
      },
    };
  }

  const value = descent.pair ? ((descent.pair.value as Node | undefined) ?? null) : container;
  return { outcome: 'resolved', field: describeValue(value) };
}

// ---------------------------------------------------------------------------
// offset -> context
// ---------------------------------------------------------------------------

const NOWHERE: CursorContext = {
  entityIndex: null,
  prototypeType: null,
  component: null,
  fieldPath: [],
  token: { kind: 'none' },
};

/** True when `offset` falls within `node`'s full range `[start, nodeEnd)`. */
function spans(node: unknown, offset: number): node is Node {
  const range = (node as Node | null | undefined)?.range;
  return !!range && offset >= range[0] && offset < range[2];
}

function onComponentTypeSlot(typePair: Pair, offset: number): boolean {
  const keyRange = (typePair.key as Node | null)?.range;
  if (!keyRange || offset < keyRange[0]) return false;
  const valueRange = (typePair.value as Node | null)?.range;
  return valueRange ? offset <= valueRange[2] : true;
}

function aliasAnchorOf(node: Node | null): { anchor?: string; alias?: string } {
  if (!node) return {};
  if (isAlias(node)) return { alias: node.source };
  return anchorOf(node);
}

interface DescendResult {
  chain: string[];
  token: CursorToken;
  node: Node | null;
}

const NO_DESCENT: DescendResult = { chain: [], token: { kind: 'none' }, node: null };

/** Find the deepest key/value in `map` that `offset` sits on, building the key chain. */
function descend(map: YAMLMap, offset: number): DescendResult {
  for (const pair of map.items) {
    const keyName = scalarString(pair.key);
    if (keyName === undefined) continue;

    const keyRange = (pair.key as Node).range;
    if (keyRange && offset >= keyRange[0] && offset <= keyRange[1]) {
      return {
        chain: [keyName],
        token: { kind: 'key', name: keyName },
        node: (pair.value as Node | undefined) ?? null,
      };
    }

    const value = (pair.value as Node | undefined) ?? null;
    if (!spans(value, offset)) continue;

    if (isMap(value)) {
      const sub = descend(value, offset);
      if (sub.token.kind === 'none') {
        return { chain: [keyName], token: { kind: 'value' }, node: value };
      }
      sub.chain.unshift(keyName);
      return sub;
    }
    return { chain: [keyName], token: { kind: 'value' }, node: value };
  }
  return { ...NO_DESCENT, chain: [] };
}

export function cursorContextAt(file: PrototypeFile, offset: number): CursorContext {
  const { root } = must(file);
  if (!isSeq(root)) return NOWHERE;

  const entityIndex = root.items.findIndex((item) => spans(item, offset));
  if (entityIndex < 0) return NOWHERE;

  const entity = root.items[entityIndex];
  const prototypeType = isMap(entity) ? scalarString(mapGet(entity, 'type')) ?? null : null;
  const shell = { entityIndex, prototypeType };

  if (!isMap(entity)) {
    return { ...shell, component: null, fieldPath: [], token: { kind: 'none' } };
  }

  const componentsSeq = findPair(entity, 'components')?.value ?? null;
  if (isSeq(componentsSeq) && spans(componentsSeq, offset)) {
    const componentItem = componentsSeq.items.find((item) => spans(item, offset));
    if (!isMap(componentItem)) {
      return { ...shell, component: null, fieldPath: ['components'], token: { kind: 'none' } };
    }

    const typePair = findPair(componentItem, 'type');
    const component = typePair ? scalarString(typePair.value) ?? null : null;

    if (typePair && onComponentTypeSlot(typePair, offset)) {
      return { ...shell, component, fieldPath: [], token: { kind: 'component-type', text: component } };
    }

    const inner = descend(componentItem, offset);
    return {
      ...shell,
      component,
      fieldPath: inner.chain,
      token: inner.token,
      ...aliasAnchorOf(inner.node),
    };
  }

  const inner = descend(entity, offset);
  return {
    ...shell,
    component: null,
    fieldPath: inner.chain,
    token: inner.token,
    ...aliasAnchorOf(inner.node),
  };
}
