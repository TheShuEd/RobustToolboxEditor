# TypeScript YAML libraries with stable node positions (#3)

Research ticket: [`crystallpunk-14/SS14Editor#3`](https://github.com/crystallpunk-14/SS14Editor/issues/3)
(child of the map, [#1](https://github.com/crystallpunk-14/SS14Editor/issues/1)).
Date: 2026-09-08. Branch: `research/ts-yaml-node-positions`.

## Question

Which TypeScript YAML library gives **stable node positions** precise enough for
pointwise text edits, and survives everything that actually occurs in SS14
prototype files (RobustToolbox engine)?

Candidates: `yaml` (eemeli, incl. its CST layer), `tree-sitter-yaml`,
`yaml-ast-parser`.

**Hard constraint from the project map:** no re-serialization. The tool never
reads YAML into an object graph and prints it back. It makes pointwise text edits
over character/line ranges. The library is needed purely as a **source of stable
node positions**. The predecessor `TheShuEd/SS14Editor` sank because it
re-serialized and then needed ~1079 lines of hand-rolled round-trip repair with
sentinels.

### What the parser must survive

- `!type:X` polymorphic subtype tags — very common, many distinct values.
- Anchors (`&name`) and aliases (`*name`).
- Comments: trailing a key line, and standalone comment lines.
- Top level being a **sequence of maps** (`- type: ...`), not a single root map.
  Multi-document files (`---`) also occur.

### What the library must be able to do

1. Give the **exact text range of a specific scalar value** identified by a
   structural path (e.g. `[3].components[1].state`), as char offsets or
   line+col.
2. Let the caller compute an **insertion point for a new key in a map** and a
   **new element in a sequence**, with **correct indentation** derived from
   surrounding nodes.
3. **Survive repeated edits to the same document** without cumulative position
   drift — via re-parse-after-each-edit, or incremental parse.

## Method and sources

Primary sources only:

- `yaml` official docs at <https://eemeli.org/yaml/> and the source/tests in
  <https://github.com/eemeli/yaml> (branch `main`; type defs in
  `src/parse/cst.ts`, `src/nodes/types.ts`, `src/nodes/Scalar.ts`,
  `src/doc/Document.ts`; docs in `docs/03_options.md`, `docs/05_content_nodes.md`,
  `docs/07_parsing_yaml.md`, `docs/08_errors.md`).
- `tree-sitter-yaml`: <https://github.com/ikatyang/tree-sitter-yaml> and the
  maintained fork <https://github.com/tree-sitter-grammars/tree-sitter-yaml>
  (`grammar.js`, `src/node-types.json`, `test/corpus/`, release list);
  <https://github.com/tree-sitter/node-tree-sitter>;
  `web-tree-sitter` / `@vscode/tree-sitter-wasm` on npm; tree-sitter
  `lib/binding_web/README.md`.
- `yaml-ast-parser`: <https://github.com/mulesoft-labs/yaml-ast-parser> and its
  npm page.
- Reference implementation for our exact use case:
  `redhat-developer/yaml-language-server`
  (`src/languageservice/parser/yamlParser07.ts`, `.../yaml-documents.ts`).
- YAML 1.1 vs 1.2 spec where it bears on tags/anchors.

---

## Candidate 1 — `yaml` (eemeli)

npm `yaml`, latest stable **2.8.4** (2026-05-02); a `3.0.0` prerelease also exists
(`main` branch now declares `engines.node` `^20.19 || ^22.12 || >=24`, so pin the
2.8.x line for the VS Code extension host for now). Pure JavaScript, **zero
runtime dependencies** (`package.json` has no `dependencies` field), ships ESM +
type declarations. Passes the full `yaml-test-suite`. It is explicitly designed to
"parse, modify, and write YAML comments and blank lines" — round-trip fidelity is
a first-class goal, not an afterthought. Source: <https://eemeli.org/yaml/>,
`package.json`.

The library exposes **three layers**: `parse`/`stringify`;
`parseDocument`/`parseAllDocuments` (Document + AST with metadata); and the
low-level **Lexer → Parser → Composer** pipeline whose Parser emits the **CST
(Concrete Syntax Tree)**. Source: `docs/07_parsing_yaml.md`,
<https://eemeli.org/yaml/>.

### 1a. Ranges on the AST (Document / Node)

Every parsed node carries `range` typed as
`export type Range = [start: number, valueEnd: number, nodeEnd: number]`
(`src/nodes/types.ts`). Docs (`docs/05_content_nodes.md`):

> The `[start, value-end, node-end]` character offsets for the part of the source
> parsed into this node (undefined if not parsed). The `value-end` and `node-end`
> positions are themselves not included in their respective ranges.

- `start` … `valueEnd` is the scalar's own text (what we want for
  "range of this scalar value").
- `valueEnd` … `nodeEnd` covers trailing whitespace/comment/newline that the
  composer associates with the node.
- `range` exists on `Scalar`, `YAMLMap`, `YAMLSeq`, `Alias`, and `Document`
  (`Document.ts` documents the same three-element range for the whole doc). Per
  the type defs `Pair` itself is not a `NodeBase` and has no `range`, but its
  `.key` and `.value` nodes each do — enough to locate a key token and its value
  token independently.

`NodeBase` (`src/nodes/types.ts`) also carries `comment?: string | null` ("a
comment on or immediately after this node"), `commentBefore?: string | null` ("a
comment before this node"), `spaceBefore?: boolean`, `tag?: string`, and
`srcToken?: Token` — "the CST token that was composed into this node", populated
when `keepSourceTokens: true` is passed (`docs/03_options.md`). `Scalar` adds
`source?: string` (verbatim source slice), `type` (PLAIN / QUOTE_SINGLE /
QUOTE_DOUBLE / BLOCK_LITERAL / BLOCK_FOLDED), and `anchor?: string`
(`src/nodes/Scalar.ts`).

**Offset → line/col:** `LineCounter` — construct one, feed it to the parser, then
`lineCounter.linePos(offset)` "performs a binary search and returns the 1-indexed
`{ line, col }` position" (`docs/07_parsing_yaml.md`). Straightforward to convert
to a 0-indexed VS Code `Position`/`Range`.

### 1b. Locating a node by structural path

`Document` and every collection implement `getIn(path, keepScalar?)` /
`hasIn(path)` (<https://eemeli.org/yaml/> "Collections"; `Document.ts`):

> `getIn(path, keepScalar?)`: Returns value at `path`, or `undefined` if not
> found. By default unwraps scalar values from their surrounding node; to disable
> set `keep` to `true`.

So `doc.getIn([3, 'components', 1, 'state'], true)` returns the **`Scalar` node**,
and `.range` gives the value's exact `[start, valueEnd]`. Numeric path segments
index a `YAMLSeq`; a top-level sequence-of-maps is just `doc.contents` being a
`YAMLSeq` — no special handling. For the **key** token rather than the value, walk
one level up (`doc.getIn([3, 'components', 1], true)` → `YAMLMap`, then find the
`Pair` whose `key.value === 'state'` and read `pair.key.range`).

### 1c. The CST layer (recommended primitive for pointwise edits)

The Parser yields CST tokens; **every token interface carries `offset: number`**
(start index in the source) plus `source: string` (the verbatim slice, whitespace
and newlines included) and `indent: number` (`src/parse/cst.ts`,
<https://eemeli.org/yaml/> "CST Parser").

Token vocabulary (`src/parse/cst.ts`):

- **`SourceToken.type`** values include `'space'`, `'newline'`, `'comment'`,
  `'anchor'`, `'tag'`, `'seq-item-ind'`, `'explicit-key-ind'`,
  `'map-value-ind'` (the `:`), `'flow-map-start'` / `'flow-map-end'` /
  `'flow-seq-start'` / `'flow-seq-end'`, `'comma'`, `'block-scalar-header'`.
- **`FlowScalar.type`**: `'alias'`, `'scalar'`, `'single-quoted-scalar'`,
  `'double-quoted-scalar'`.
- **`BlockScalar`** (literal `|` / folded `>`), **`BlockMap`**, **`BlockSequence`**,
  **`FlowCollection`**, **`Document`** (with `start` / `value` / `end` token
  arrays), **`Directive`**, **`ErrorToken`**.

Collection items (`BlockMap.items[n]`, `BlockSequence.items[n]`) have the shape
(<https://eemeli.org/yaml/> "CST Parser"):

- **`start`** — "source tokens before the key or value, possibly including its
  anchor or tag" (and comments / blank lines / indentation `space`).
- **`key`** — the key token (or `null`).
- **`sep`** — "source tokens between the key and the value, which should include
  the `:` map value indicator if `value` is set".
- **`value`** — the value token.
- each item also carries its own `offset` and `indent`.

So for our four hazards:

| Hazard | How it appears in the CST | Effect on ranges |
| --- | --- | --- |
| `!type:Foo` tag | a `SourceToken` `{type:'tag', source:'!type:Foo', offset}` in the item's `start` array | none — it is a sibling token, the value scalar token keeps its own clean `offset`/`source` |
| `&anchor` | `SourceToken` `{type:'anchor', source:'&anchor'}` in `start` | none |
| `*alias` | `FlowScalar` `{type:'alias', source:'*anchor'}` as the `value` | alias has its own `offset`/`source`; nothing to resolve for a text edit |
| trailing `# comment` on a key line | `SourceToken` `{type:'comment', source:'# ...'}` in the item's `sep` or `end` | none — comment is a distinct token, never merged into the value |
| standalone comment line | `{type:'comment'}` + `{type:'newline'}` in the next item's `start` (or the collection's `end`) | none |
| top-level `- a:` sequence of maps | root CST token is a `BlockSequence`; each item's `value` is a `BlockMap` | none |
| `---` multi-doc | `new Parser().parse()` emits multiple `Document` tokens; `Composer` yields multiple `Document`s; or use `parseAllDocuments` at the AST layer | each doc's tokens keep absolute offsets into the whole string |

Nothing in the lexer/parser *fails* on an unknown local tag — tags are opaque
source tokens at the CST layer. At the **AST/compose** layer an unrecognised tag
such as `!type:Foo` yields a **`YAMLWarning` (`TAG_RESOLVE_FAILED`)** in
`doc.warnings`, **not** an error, and composition still completes with the scalar
kept as a string and `.tag` set (`docs/08_errors.md`:
"A `YAMLWarning` is … a spec-mandated warning about … a fallback resolution being
used for a node with an unavailable tag"). Passing `strict: false` and/or the
project's known tags via `customTags` suppresses the warning; `yaml-language-server`
does exactly this (see below). For a pure-position use case we can also just stay
at the CST layer and ignore tag resolution entirely.

### 1d. Insertion offset + indentation from CST tokens

- **New sequence item.** Take the parent `BlockSequence`. Insertion offset =
  `nodeEnd` of the last item (end of its `value.source` plus any `end` tokens),
  i.e. just before the newline that terminates that line, or immediately after it.
  Indentation = the last item's `indent` (or the `seq-item-ind` token's column).
  Build the new line as `"\n" + " ".repeat(indent) + "- " + text`.
- **New map key.** Take the parent `BlockMap`. Insertion offset = end of the last
  `Pair`'s value region. Indentation = that pair's `key.offset` column (equivalently
  item `indent`). New line: `"\n" + " ".repeat(indent) + key + ": " + value`.
- Helpers exist: `CST.createScalarToken(value, {indent, type, ...})` "generates a
  new scalar token … handling proper indentation"; `CST.setScalarValue(token,
  value)` rewrites a scalar in place "while attempting to preserve associated
  comments"; `CST.visit(cst, (item, path) => …)` walks depth-first with
  `path` = array of `['key'|'value', number]` tuples and supports
  insert/remove during traversal (splice into `parent.items`, return the adjusted
  index); `CST.stringify(cst)` re-emits — but "applies no validation whatsoever,
  and simply concatenates the sources in their logical order"
  (<https://eemeli.org/yaml/> "Working with CST Tokens").

For this project we do **not** use `CST.stringify` to write the file back (that
would be re-serialization). We use the CST purely to compute `{offset, indent}`
and then emit a `vscode.TextEdit` / `WorkspaceEdit` over the original document.
The CST is the position oracle; VS Code applies the text change.

### 1e. Repeated edits / position drift

There is no incremental parser; the model is **re-parse after each applied edit**.
Because `yaml` is pure JS with no shared mutable global state and parsing a
typical prototype file (a few KB to low tens of KB) is sub-millisecond to low
single-digit ms, re-parsing after every committed edit is cheap and the offsets
are always fresh and absolute — **zero cumulative drift by construction**. This is
the same strategy `yaml-language-server` uses on every `didChange`.

### 1f. Bundling into a VS Code extension / webview

Pure ESM JavaScript, no native addon, no `.node` binary, no `postinstall` build,
no wasm. Bundles cleanly with esbuild/webpack into both the extension host and a
webview script. `LineCounter`, `Parser`, `Composer`, `CST` are all named exports.
Nothing platform-specific. This is the lowest-risk option for Marketplace
distribution.

### 1g. Third-party confirmation

`redhat-developer/yaml-language-server` migrated **from `yaml-ast-parser` to
`eemeli/yaml` in its v1.0.0** and every version since parses with it
(README: "Starting from version 1.0.0 [it] uses eemeli/yaml as the … parser").
Its `yamlParser07.ts` constructs options
`{ strict: false, customTags: …, version: …, keepSourceTokens: true }`, runs
`new Parser(lineCounter.addNewLine)` → `new Composer().compose(tokens, true,
text.length)`, iterates the resulting documents for multi-doc support, and maps
`node.range` offsets to LSP positions via a `LineCounter`/`TextBuffer`. That is
almost exactly our requirement set, in a mature, widely deployed extension.

---

## Candidate 2 — `tree-sitter-yaml`

Two repos:

- **`ikatyang/tree-sitter-yaml`** — the original. **Last commit 2021-05-11, last
  release `0.5.0` (2021-04-18).** Effectively unmaintained; incompatible with
  modern `tree-sitter` CLI (repo issue #18). npm `tree-sitter-yaml`, ~167
  weekly downloads.
- **`tree-sitter-grammars/tree-sitter-yaml`** — the maintained fork under the
  `tree-sitter-grammars` org. Active: releases `0.7.0` (2024-12), `0.7.1`
  (2025-05), **`0.7.2` (2025-10-07)**. npm
  `@tree-sitter-grammars/tree-sitter-yaml`. Use this one if any.

### 2a. Native module vs `web-tree-sitter` (wasm) in a VS Code extension

This is the decisive problem. Two ways to run tree-sitter in Node/Electron:

- **`node-tree-sitter`** (native N-API addon) + the grammar's compiled `.node`
  binary. The grammar's `.node` and the `tree-sitter` runtime must be built
  against **the exact Electron/Node ABI that the user's VS Code ships**. VS Code
  bumps Electron (and therefore the module ABI) roughly every ~2 months; a
  binary built for one release throws `NODE_MODULE_VERSION` mismatch on another
  (`node-tree-sitter` issue #169, "Node module version mismatch when integrating
  tree-sitter with VS Code extension"). Options are all painful: ship prebuilds
  for every {platform × arch × ABI} and gamble on coverage, run `electron-rebuild`
  in a `postinstall` (needs a compiler toolchain on the user's machine —
  unacceptable for a Marketplace extension), or vendor binaries. This is why
  first-party VS Code language features do **not** consume `node-tree-sitter`.
- **`web-tree-sitter`** (wasm). VS Code itself went this route and publishes
  `@vscode/tree-sitter-wasm`. Per the tree-sitter `binding_web` README, wasm
  grammars "don't have to be built for the user's architecture, nor rebuilt when
  the version of Electron changes" — at a **performance cost** ("executing .wasm
  … in Node.js is considerably slower than … Node.js bindings"). You bundle
  `tree-sitter.wasm` + `tree-sitter-yaml.wasm` as extension assets and load them
  at runtime; portability across platforms and VS Code versions is then a
  non-issue. For Electron use the `web-tree-sitter.cjs` build, not the ESM one.

Net: a tree-sitter approach is only viable here via **wasm**, adding a
`web-tree-sitter` runtime dependency, a wasm asset, an async init step, and a
grammar `.wasm` that we must build/track ourselves (the fork ships C sources and
bindings, not a published `.wasm`).

### 2b. Grammar coverage of `!type:` tags and anchors

`src/node-types.json` (fork) has named nodes `tag`, `anchor` (wrapping
`anchor_name`), `alias` (wrapping `alias_name`), and `comment`
(`{"type":"comment","named":true,"extra":true}` — comments are *extra* nodes, so
they float in the tree rather than being structural children; you must walk to
collect them). `grammar.js` delegates tag scanning to an external scanner
(`_r_tag` / `_br_tag` / `_b_tag`), which implements the YAML tag productions.
Test corpus shows `!local &anchor value` parsing to
`(flow_node (tag) (anchor (anchor_name)) (plain_scalar …))` — tag and anchor are
clean sibling nodes, good for our purposes.

**Residual doubt:** the corpus does not contain a shorthand tag with a **colon in
the suffix** (`!type:Foo`). Per YAML 1.2 `ns-tag-char` excludes only `!` and the
flow indicators `,[]{}` — `:` is allowed — so `!type:Foo` *should* scan as one
`tag` node, but this must be checked on the actual grammar
(playground / a corpus test) before relying on it. The fork also has open bugs
filing **`ERROR` nodes on valid-but-unusual input** (e.g. issue #39 multiline
single-quoted scalars without indentation, issue #43 dedented flow closing).

### 2c. Node ranges

`SyntaxNode` exposes `startIndex` / `endIndex` (byte offsets) and
`startPosition` / `endPosition` (`{row, column}`), directly usable to build a VS
Code `Range`. Ranges are precise and always present, including on `ERROR` nodes —
tree-sitter never throws, it localises damage into an `ERROR` subtree while
siblings keep valid ranges. That containment is the one genuine advantage over
`yaml` for pathological input.

### 2d. Incremental `edit()`

`tree.edit(editDescriptor)` + `parser.parse(newText, oldTree)` re-parses only the
changed region — "much faster than the first parse". But the caller must hand
tree-sitter a **correct** `{startIndex, oldEndIndex, newEndIndex, startPosition,
oldEndPosition, newEndPosition}` for every edit; an off-by-one in that descriptor
silently corrupts every downstream offset with no error. Given prototype files
are small, the re-parse-from-scratch story (as with `yaml`) is fast enough that
incremental parsing buys little and adds a foot-gun. If used, positions stay
trustworthy **only** if the edit descriptors are exact.

### 2e. Verdict on tree-sitter

Strong parser, but the packaging story (native ABI churn vs. a self-built wasm
grammar + `web-tree-sitter` runtime + async init), the comment-as-extra-node
model, the unverified `!type:Foo` scan, and known `ERROR`-node bugs make it
**heavier and riskier than `yaml`** for v1, with no offsetting benefit for a
pointwise-edit tool that already re-parses cheaply.

---

## Candidate 3 — `yaml-ast-parser`

- A **fork of `js-yaml`** that emits an AST instead of plain objects, with
  `!include` support for RAML.
- **`mulesoft-labs/yaml-ast-parser` was archived 2024-01-20 (read-only).** npm
  `yaml-ast-parser` latest `0.0.43`, **last published ~7 years ago** (2018); npm
  shows it as deprecated and points users elsewhere. `@stoplight/yaml-ast-parser`
  is a separately maintained hard-fork but is aimed at Stoplight's own tooling
  and is not materially better for us.
- **Superseded for our exact use case:** `yaml-language-server` *was* built on
  `yaml-ast-parser` and deliberately **replaced it with `eemeli/yaml` at v1.0.0**.
  That migration is the single clearest signal in this whole investigation.
- **Range fidelity:** `YAMLNode` exposes `startPosition` / `endPosition` as
  absolute char offsets — usable, but coarser than `yaml`'s CST (it is an AST, so
  there is no token-level access to the `:` indicator, indentation whitespace, or
  blank lines; deriving an insertion indent means re-deriving column from the
  offset yourself).
- **Comments:** as a `js-yaml` derivative it **discards comments** — there is no
  comment node in the AST. For a tool that must not disturb trailing/standalone
  comments this is a real hazard: safe *reads* of scalar ranges are fine, but
  computing insertion points near comments is blind.
- Pure JS, no native deps (that part is fine).

**Verdict:** do not adopt. Unmaintained, deprecated, comment-blind, and already
abandoned by the reference project in favour of `yaml`.

---

## Cross-cutting: repeated edits without position drift

| Library | Model | Drift risk |
| --- | --- | --- |
| `yaml` | re-parse after each applied edit; offsets are absolute; ~ms cost on prototype-sized files | none by construction |
| `tree-sitter-yaml` | incremental `edit()` + `parse(oldTree)`, or re-parse | none if re-parsing; **descriptor errors silently corrupt offsets** if using `edit()` |
| `yaml-ast-parser` | re-parse only | none by construction, but comment-blind insertion points |

For all three the safe pattern is: apply one `TextEdit`, let VS Code update the
buffer, re-parse, recompute. `yaml` makes that pattern cheapest and least
error-prone.

---

## Recommendation

**Use `yaml` (eemeli), pinned to the 2.8.x line, for v1 — working primarily
through its CST layer (`new Parser()` / `new Composer()`), with `LineCounter` for
offset→line/col and `parseDocument`/`getIn` as a convenience for path lookup.**

### Load-bearing reasons

1. **Positions are first-class and absolute.** Every AST node has
   `range: [start, valueEnd, nodeEnd]` (char offsets); every CST token has
   `offset` + verbatim `source` + `indent`. `LineCounter.linePos(offset)` gives
   `{line, col}` for a VS Code `Range`. No resolution step, no drift.
2. **The CST models exactly what a pointwise editor needs.** Tags, anchors,
   aliases and comments are all *distinct sibling tokens* (`type:'tag'`,
   `'anchor'`, `'alias'`, `'comment'`) — they never contaminate a value token's
   range. Collection items expose `start` / `key` / `sep` / `value` plus per-item
   `offset` and `indent`, which is enough to compute an insertion offset and the
   correct indent for a new map key or sequence item without guessing.
3. **Survives every SS14 hazard.** `!type:X` is at worst a `YAMLWarning` at the
   compose layer (and nothing at the CST layer); `strict:false` + `customTags`
   silences it. Top-level sequence-of-maps is just `contents` being a `YAMLSeq`.
   Multi-doc: `parseAllDocuments` / multiple `Document` tokens, offsets stay
   absolute into the whole string.
4. **Bundling is trivial and Marketplace-safe.** Pure ESM, zero dependencies, no
   native addon, no wasm, no `postinstall`. Works in the extension host and in a
   webview. No Electron-ABI exposure.
5. **Proven on the same problem.** `redhat-developer/yaml-language-server` uses
   precisely this library and configuration (`keepSourceTokens:true`,
   `strict:false`, `customTags`, `LineCounter`, `node.range` → LSP positions)
   after explicitly migrating off `yaml-ast-parser`.
6. **No re-serialization required.** The CST is used only as a position/indent
   oracle; the actual change is a `vscode.TextEdit` over the original text. This
   is the architectural opposite of what sank `TheShuEd/SS14Editor`.

### Trade-offs accepted

- **No incremental parser.** We re-parse the whole document after each applied
  edit. On prototype-sized files this is sub-ms to low-ms and removes a whole
  class of bug; it is not a real cost here.
- **Malformed input is not damage-contained the way tree-sitter contains it.** If
  a prototype file is genuinely broken, `yaml` reports errors in `doc.errors` and
  some ranges may be missing, whereas tree-sitter would still hand back a partial
  tree with an `ERROR` subtree. Mitigation: gate the inspector on
  `doc.errors.length === 0` and fall back to read-only/plain-text editing.
- **CST insertion is hand-rolled.** `CST.createScalarToken` helps, but computing
  the exact insertion offset for a new key/item (and whether it goes before or
  after a trailing comment) is our code to write and test. It is far less code
  than a round-trip repair layer, but it is not free.
- **v3 is coming.** The `main` branch targets `yaml@3` with a newer Node engine
  range. Pin `^2.8` now; revisit when `3.x` is stable and the extension's
  minimum VS Code / Node baseline allows it. The CST API has been stable across
  the 2.x line and is not expected to break in 3.x.

### Rejected

- **`tree-sitter-yaml`** — only shippable via a self-built `.wasm` grammar +
  `web-tree-sitter` runtime + async init (native `node-tree-sitter` is
  unshippable on the Marketplace due to Electron-ABI churn,
  `node-tree-sitter#169`). Comments are *extra* nodes you must walk for; the
  maintained fork has open `ERROR`-node bugs on valid input; and `!type:Foo`
  single-token scanning is plausible-but-unverified. More moving parts, more
  risk, no benefit for a tool that already re-parses cheaply. Keep it on the
  shelf as a fallback if damage-containment on broken files becomes a hard
  requirement.
- **`yaml-ast-parser`** — archived (2024-01), npm-deprecated, last real release
  2018, discards comments, and already abandoned by `yaml-language-server` in
  favour of `yaml`. No path to adoption.

### Residual unknowns

1. **`!type:Foo` at the CST layer.** Confirmed conceptually (tag is an opaque
   `type:'tag'` source token; `:` is a legal `ns-tag-char`), but not yet run
   against `yaml@2.8.x` with a real SS14 prototype file. Quick spike:
   parse a known prototype, assert the value scalar token's `source`/`offset`
   excludes the tag and the tag token's `source === '!type:Foo'`.
2. **Anchor/alias inside SS14 prototypes** — how often, and whether the inspector
   should edit a value that is under an anchor (edit propagates to aliases only
   if the consumer re-resolves; a text edit does not). Needs a product decision,
   not more research.
3. **Insertion semantics around comments** — when adding a key to a map whose
   last line has a trailing `# comment`, or where the map is followed by a
   standalone comment block, where exactly does the new line go? Needs test
   fixtures drawn from real prototype files.
4. **Block scalars (`|`, `>`) holding prototype values** (e.g. multi-line
   descriptions) — CST `BlockScalar` has `offset` + `source` + a
   `block-scalar-header`; confirm the value range we hand to VS Code excludes the
   header and indentation as intended.
5. **Very large merged prototype files** (if any SS14 fork ships one multi-MB
   YAML) — re-parse-per-edit latency should be measured; if it bites, switch that
   path to debounced re-parse or reconsider tree-sitter incremental.
6. **`yaml@3` migration** — track the stable release and re-confirm the CST API
   surface before bumping.
