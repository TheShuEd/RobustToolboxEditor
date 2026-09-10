/**
 * Autocomplete candidates for prototype YAML (spec #20, "Текстовые провайдеры";
 * issue #27). Pure core: text + offset + schema snapshot in, a list of
 * candidates as plain data out. The host adapter ({@link file://../host/text-providers.ts})
 * wraps each candidate in a `vscode.CompletionItem`; nothing here knows about
 * VS Code.
 *
 * The cursor context is entirely {@link cursorContextAt}'s job (issue #24) — this
 * module never walks the YAML tree itself. From that context it decides which of
 * five lists the caret is asking for:
 *
 *   1. component names   — on the `type:` value slot of a `components:` entry;
 *   2. component fields  — on a key inside a component block;
 *   3. DataDefinition fields — on a key inside a nested `[DataDefinition]` value;
 *   4. prototype fields  — on a key at the top level of the prototype, keyed by
 *      its `[Prototype]` type (`entity` -> `EntityPrototype`, `reagent` ->
 *      `ReagentPrototype`, …);
 *   5. enum values       — on the value slot of an enum-typed field.
 *
 * Cases 2–4 exclude keys already written in the caret's block
 * ({@link CursorContext.containerKeys}). The schema keys prototypes by their
 * YAML `type:` string and components by their registration name, which is what
 * the cursor context hands us.
 *
 * A half-typed key with no colon yet (`swingL`, mid-edit) makes `yaml` reject
 * the whole document — issue #24's "any parse error => invalid as a whole". So
 * before giving up, {@link completionsAt} splices a `:` onto that line and
 * re-parses: the exact case where field completion is most wanted.
 */

import {
  cursorContextAt,
  parsePrototypeFile,
  type CursorContext,
  type PrototypeFile,
} from './prototype-yaml';
import type {
  DataDefinitionMetadata,
  FieldMetadata,
  FieldTypeNode,
  SchemaRoot,
} from './schema-contract';

/** One completion candidate as data: what to show, how to badge it, a short signature. */
export interface CompletionCandidate {
  /** The text inserted / shown — a component name, a field key, or an enum member. */
  readonly label: string;
  readonly kind: 'component' | 'field' | 'enum-value';
  /** Short right-aligned signature: a declared type, a class name, or an enum type. */
  readonly detail?: string;
}

/**
 * Candidates for the caret at `offset` in `text`, given the loaded `schema`.
 * Empty when the caret is not on one of the five completion points, the schema
 * has nothing to offer there, or the text cannot be parsed even after the
 * bare-key recovery below.
 */
export function completionsAt(
  text: string,
  offset: number,
  schema: SchemaRoot,
): CompletionCandidate[] {
  const parsed = parseForCompletion(text, offset);
  if (!parsed) return [];

  const ctx = cursorContextAt(parsed.file, parsed.offset);

  switch (ctx.token.kind) {
    case 'component-type':
      return componentNameCandidates(schema);
    case 'key':
      return fieldKeyCandidates(ctx, schema);
    case 'value':
      return enumValueCandidates(ctx, schema);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// parse, with bare-key recovery
// ---------------------------------------------------------------------------

/**
 * Parse `text`, and if that fails, retry once with a `:` spliced onto the
 * caret's line when it holds nothing but an indented bare word — the shape a
 * field key has the instant before its colon is typed. The returned `offset` is
 * shifted past the inserted colon when the caret was beyond it.
 */
function parseForCompletion(
  text: string,
  offset: number,
): { file: PrototypeFile; offset: number } | null {
  const direct = parsePrototypeFile(text);
  if (direct.ok) return { file: direct, offset };

  const patched = spliceBareKeyColon(text, offset);
  if (!patched) return null;

  const retry = parsePrototypeFile(patched.text);
  return retry.ok ? { file: retry, offset: patched.offset } : null;
}

const BARE_KEY_LINE = /^([ \t]*)([A-Za-z0-9_.-]+)[ \t]*$/;

function spliceBareKeyColon(text: string, offset: number): { text: string; offset: number } | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const nextNewline = text.indexOf('\n', offset);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const match = BARE_KEY_LINE.exec(text.slice(lineStart, lineEnd));
  if (!match) return null;

  const insertAt = lineStart + match[1].length + match[2].length;
  return {
    text: `${text.slice(0, insertAt)}:${text.slice(insertAt)}`,
    offset: offset > insertAt ? offset + 1 : offset,
  };
}

// ---------------------------------------------------------------------------
// 1. component names
// ---------------------------------------------------------------------------

function componentNameCandidates(schema: SchemaRoot): CompletionCandidate[] {
  return Object.values(schema.components)
    .map((component) => ({
      label: component.name,
      kind: 'component' as const,
      detail: shortTypeName(component.className),
    }))
    .sort(byLabel);
}

// ---------------------------------------------------------------------------
// 2–4. field keys (component / nested DataDefinition / prototype)
// ---------------------------------------------------------------------------

function fieldKeyCandidates(ctx: CursorContext, schema: SchemaRoot): CompletionCandidate[] {
  const container = containerFields(ctx, schema);
  if (!container) return [];

  const caretKey = ctx.fieldPath[ctx.fieldPath.length - 1];
  const alreadyPresent = new Set(ctx.containerKeys.filter((key) => key !== caretKey));

  return container.fields
    .filter((field) => !alreadyPresent.has(field.tag))
    .map((field) => ({
      label: field.tag,
      kind: 'field' as const,
      detail: fieldDetail(field),
    }))
    .sort(byLabel);
}

// ---------------------------------------------------------------------------
// 5. enum values
// ---------------------------------------------------------------------------

function enumValueCandidates(ctx: CursorContext, schema: SchemaRoot): CompletionCandidate[] {
  const container = containerFields(ctx, schema);
  if (!container || ctx.fieldPath.length === 0) return [];

  const leafKey = ctx.fieldPath[ctx.fieldPath.length - 1];
  const field = container.fields.find((candidate) => candidate.tag === leafKey);
  if (!field) return [];

  const { values, ref } = enumValuesOf(field, schema);
  const detail = ref ? shortTypeName(ref) : undefined;
  return values.map((value) => ({ label: value, kind: 'enum-value' as const, detail }));
}

// ---------------------------------------------------------------------------
// container resolution — shared by the field-key and enum-value paths
// ---------------------------------------------------------------------------

/**
 * The field list the caret's key chain lands in: a component's own fields, a
 * prototype's `[Prototype]`-type fields, or — for a deeper chain — the fields of
 * the `[DataDefinition]` each step's key is typed as. `null` when the schema
 * does not know the component / prototype type, or a step is not a
 * DataDefinition-typed field (a plain scalar, list or dictionary has no fixed
 * sub-fields to complete).
 */
function containerFields(
  ctx: CursorContext,
  schema: SchemaRoot,
): { fields: readonly FieldMetadata[] } | null {
  const rootFields = rootFieldsFor(ctx, schema);
  if (!rootFields) return null;

  // fieldPath ends with the (possibly partial) key under the caret; the keys
  // before it name the container chain to walk into.
  let fields = rootFields;
  for (const key of ctx.fieldPath.slice(0, -1)) {
    const field = fields.find((candidate) => candidate.tag === key);
    if (!field) return null;
    const definition = dataDefinitionOf(field, schema);
    if (!definition) return null;
    fields = definition.fields;
  }
  return { fields };
}

/**
 * The field list the caret's container chain starts from: a component's fields
 * when inside `components:`, otherwise the prototype's fields keyed by its
 * `type:`. `null` when the schema does not know that component / prototype type.
 */
function rootFieldsFor(ctx: CursorContext, schema: SchemaRoot): readonly FieldMetadata[] | null {
  if (ctx.component !== null) {
    return schema.components[ctx.component]?.fields ?? null;
  }
  if (ctx.prototypeType !== null) {
    return schema.prototypes[ctx.prototypeType]?.fields ?? null;
  }
  return null;
}

/**
 * The `[DataDefinition]` a field (or its list element / dictionary value) is
 * typed as, resolved against `schema.dataDefinitions` by full type name.
 */
function dataDefinitionOf(field: FieldMetadata, schema: SchemaRoot): DataDefinitionMetadata | null {
  const typeName =
    dataDefinitionTypeName(field) ??
    dataDefinitionTypeName(field.element) ??
    dataDefinitionTypeName(field.value);
  if (!typeName) return null;
  return schema.dataDefinitions[typeName] ?? null;
}

function dataDefinitionTypeName(
  node: Pick<FieldTypeNode, 'isDataDefinition' | 'dataDefinitionType'> | undefined,
): string | undefined {
  if (!node) return undefined;
  return node.isDataDefinition && node.dataDefinitionType ? node.dataDefinitionType : undefined;
}

function fieldDetail(field: FieldMetadata): string {
  return field.required ? `${field.type} (required)` : field.type;
}

/**
 * Enum members for a field, whether it carries them inline (`enumValues`), by
 * reference into `schema.enums`, or by reference into `schema.enumConstants`
 * (numeric named constants — the names are what YAML accepts). A list-of-enum
 * field is read through its `element`.
 */
function enumValuesOf(
  field: FieldMetadata,
  schema: SchemaRoot,
): { values: string[]; ref: string | undefined } {
  const inline = field.enumValues ?? field.element?.enumValues;
  if (inline && inline.length > 0) return { values: [...inline], ref: undefined };

  const ref = field.enumRef ?? field.element?.enumRef;
  if (ref) {
    if (schema.enums[ref]) return { values: [...schema.enums[ref]], ref };
    const constants = schema.enumConstants[ref];
    if (constants) return { values: constants.map((entry) => entry.name), ref };
  }
  return { values: [], ref: undefined };
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function byLabel(a: CompletionCandidate, b: CompletionCandidate): number {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** `Content.Shared.Actions.Components.ItemActionIconStyle` -> `ItemActionIconStyle`. */
function shortTypeName(fullName: string): string {
  const lastDot = fullName.lastIndexOf('.');
  return lastDot === -1 ? fullName : fullName.slice(lastDot + 1);
}
