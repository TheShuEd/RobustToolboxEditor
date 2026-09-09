# Comment ownership before the first item of a top-level YAML sequence (`yaml`@eemeli CST/AST)

Research ticket: [`crystallpunk-14/SS14Editor#17`](https://github.com/crystallpunk-14/SS14Editor/issues/17),
a child ticket of the project's wayfinder planning map. Builds directly on
[`crystallpunk-14/SS14Editor#10`](https://github.com/crystallpunk-14/SS14Editor/issues/10) (established the
map first-key rule: a comment before a map's first key belongs to the container,
`mapNode.commentBefore`, not the pair) and
[`crystallpunk-14/SS14Editor#14`](https://github.com/crystallpunk-14/SS14Editor/issues/14) (the
insertion-side companion document, `docs/research/yaml-insertion-near-comments.md`). This document
closes the explicit open item left in `prototype-surgical-edits/lib/edits.mjs`'s old `deleteSeqItem`
comment:

> **НЕ проверено:** комментарий прямо перед САМЫМ первым элементом всей последовательности — в
> наших фикстурах такого случая нет, остаётся открытым вопросом для реализации.

Date: 2026-09-09. Branch: `research/top-level-seq-leading-comment` (worktree of
`prototype/prototype-surgical-edits`).

## Question

Issue #10 proved the rule for a comment preceding the first key of a **map**: it belongs to the
container (`mapNode.commentBefore`), not to the pair. But the SS14 prototype file's document root
(`doc.contents`) is not a map — it is a flat, top-level `YAMLSeq` of `- type: X` entities with **no
wrapping key**, unlike `components:`, which is also a `YAMLSeq` but one nested *inside* a map (opened
by the `components:` key before any of its items are composed).

Does a comment before the very first item of this top-level sequence belong to the container
(mirroring issue #10's map rule) or to the item itself, the way non-first items already do? Neither
ticket #10 nor ticket #14 answered this: their fixture scans never happened to surface a real file
whose very first entity has a leading comment. Nobody had found or tested a real fixture with a
comment before the very first entity of a file before this ticket.

## Method and sources

Primary sources: `yaml` (eemeli) `docs/05_content_nodes.md` (`NodeBase.range`, `.comment`,
`.commentBefore`) — the same primary source used by `docs/research/ts-yaml-node-positions.md` and
`docs/research/yaml-insertion-near-comments.md` — run against `yaml@2.8.x`
(`prototype-surgical-edits/package.json` pins `^2.8`) with `keepSourceTokens: true` and a
`LineCounter`, exactly as `prototype-surgical-edits/lib/model.mjs`'s `loadPrototypeFile` does
(`parseDocument(text, {lineCounter, keepSourceTokens:true, strict:false})`).

New for this ticket: in addition to the Composer/AST layer used by #10 and #14, this investigation
also inspected the **raw CST token stream** directly, via `new Parser().parse(text)` — the `Parser`
class exported from the `yaml` package, a lower layer than (and distinct from) the Composer that
produces `doc`/`doc.contents`. This is a deeper primary-source technique than either prior document
used, and it is what settles *why* the AST-level rule comes out the way it does (see Finding 1).

Fixture search: a full scan of all 2760 `.yml`/`.yaml` files under `Resources/Prototypes/` in the
crystall-edge fork checked out locally at
`C:\Users\edwar\Desktop\ss14 SpriteWork\Local SS14 Client Full\CrystallEdge\crystall-edge\`, using a
bash loop with `awk 'NF{print; exit}'` per file to extract the first non-blank line, filtering for
lines starting with `#`. This yielded 506 of 2760 files (about 18%) whose very first non-blank
content is a comment — far more common than either #10 or #14 anticipated; their fixtures simply
never happened to hit this case. After excluding `Resources/Prototypes/_CE/` (fork-specific,
non-canonical Crystal Edge additions layered on top of upstream/canon SS14 prototypes — the same
canon/fork distinction already visible in `prototype-surgical-edits/README.md`'s sourcing note for
`fixtures/light.yml`, which is drawn from `_CE/Procedural/Demiplane/Modifiers/light.yml`), 445
candidates remained. Two were selected:

- **`fixtures/types.yml`** ← `Actions/types.yml` (upstream/canon, not `_CE`). Copied byte-for-byte,
  verified via matching md5 hash `78986f885fb6d1f9e464d77335aa8162` on both source and copy (also
  cross-checked with `diff`, reporting identical). 43 entities, CRLF line endings, 15892 bytes, no
  BOM — all four numbers reconfirmed directly (`wc -c`, `file`, `grep -c '^- type: entity'`) while
  writing this document. Selected because: substantive comment (not a placeholder), multiple
  entities (allows a non-first-item sanity re-check), and — uniquely valuable — TWO comment groups
  separated by a blank line before the first entity (line 1 `# base actions`, general file header;
  blank line 2; line 3 `# base prototype for all action entities`, entity-specific, no blank line
  before the entity itself; line 4 `- type: entity`, id `BaseAction`).
- **`fixtures/substation.yml`** ← `Entities/Structures/Power/substation.yml` (upstream/canon).
  Copied byte-for-byte, verified via matching md5 hash `4f30cdbdc5a3b359d2ed66b76832d3bc` on both
  sides. Selected as a control/contrast fixture: it independently exhibits the SAME top-level
  phenomenon as `types.yml` (a single-line leading comment before entity 0, `CoreSubstation`) AND,
  in the same file, a comment before the first item of a NESTED sequence (`components:` →
  `Battery`) — letting one file isolate whether the governing variable is "map vs seq" (per issue
  #10's framing) or "nested vs document-root" (this ticket's refinement).

Demo script: `prototype-surgical-edits/demo-toplevel-seq-comment.mjs`. Run:
`node demo-toplevel-seq-comment.mjs` from `prototype-surgical-edits/` (after `npm install`). All
numbers below were re-verified by re-running this script and, for Finding 1, by an independent
one-off `new Parser().parse(text)` inspection, while writing this document.

## Findings

### 1. The raw CST token stream places the leading comment BEFORE the `document` token entirely

Using `new Parser().parse(text)` on `fixtures/types.yml`, the top-level token stream is exactly six
tokens, confirmed by direct inspection:

```
comment offset=0  "# base actions"
newline offset=14 "\r\n"
newline offset=16 "\r\n"
comment offset=18 "# base prototype for all action entities"
newline offset=58 "\r\n"
document offset=60  (the actual document/content token)
```

This proves the comment tokens are NOT part of the document's own CST subtree at all — they precede
it as raw stream-level siblings, a full structural layer above anything the document, its root
collection, or any node within it could claim via their own CST `.start` tokens.

### 2. At the Composer/AST level, ownership falls through to the first item, not any container

On the SAME fixture, via `doc = parseDocument(text, {lineCounter, keepSourceTokens:true,
strict:false})`:

- `doc.commentBefore === null`
- `doc.contents.commentBefore === undefined` — `doc.contents` is the root `YAMLSeq`, with
  `range === [60, 15892, 15892]` — note its range starts EXACTLY at offset 60, i.e. exactly where
  the CST comment prelude ends (Finding 1). The container's own range physically excludes the
  comment; it does not, and structurally cannot, claim it.
- `doc.contents.items[0].commentBefore === " base actions\n\n base prototype for all action
  entities"` — confirmed by direct property inspection — with `items[0].range === [62, 794, 794]`.
  The FIRST ITEM owns the combined text of BOTH comment groups as one string (line breaks
  normalized to `\n`, the blank line preserved as `\n\n` in the middle), despite the fact that the
  first group ("# base actions") reads as a general file-level header, not specifically a comment
  "about" the `BaseAction` entity. The AST does not and cannot distinguish the two groups — they are
  composed into a single `commentBefore` string.

This is the DEFINITIVE ANSWER, stated plainly: for a top-level sequence, a comment before item 0
belongs to **the item itself** (`items[0].commentBefore`), NOT the container
(`doc.contents.commentBefore`) and NOT the Document (`doc.commentBefore`). This is the OPPOSITE of
issue #10's map rule (comment before a map's first key belongs to the container, not the pair).

Compare explicitly against the ALREADY-proven non-first-item rule from #10, confirmed still holding
here: `items[1].commentBefore === " base proto for an action that requires a DoAfter"` (the
`BaseDoAfterAction` entity, range `[850, 967, 967]`) — also owned by the item itself, consistent with
(not contradicting) the general seq rule that non-first items always own their own leading comment.

### 3. Control check: a NESTED sequence's first item behaves like a map, not like a top-level seq

On `fixtures/substation.yml`: the file's OWN top-level leading comment (`# Core logic shared between
regular and wall-mount substation`, before entity 0, `CoreSubstation`) reproduces Finding 2 exactly
— `doc.contents.commentBefore === undefined`, `items[0].commentBefore === " Core logic shared
between regular and wall-mount substation"`, `doc.contents.range === [63, 6733, 6733]`,
`items[0].range === [65, 1738, 1738]`.

But the SAME file's first entity has a `components:` key whose value is a NESTED `YAMLSeq`, and
that nested seq's first item (`Battery`) has ITS OWN preceding comment. Raw text around it:

```
  components:\r\n  # Core power behavior\r\n  - type: Battery\r\n
```

Here:

- `componentsSeq.commentBefore === " Core power behavior"` — the CONTAINER owns it (range
  `[161, 1738, 1738]`)
- `componentsSeq.items[0].commentBefore === undefined` — the first component (`Battery`, range
  `[163, 496, 496]`) does NOT own it

This is exactly issue #10's map rule, reproduced for a nested sequence. It proves the map/seq
distinction issue #10 originally framed the question around was incidental — the REAL governing
variable, confirmed here, is whether the collection is nested inside an already-open parent
structure (map-first-key and nested-seq-first-item both behave the same way: container owns it)
versus sitting at the absolute top of the document with no enclosing structure yet composed
(top-level-seq-first-item: the not-yet-extant container can't claim it, so it falls through to the
first real node).

### 4. The unifying mechanical rule

A comment attaches to whichever collection node is the innermost STILL-OPEN container at the moment
the Composer encounters the comment token. For a nested seq like `components:`, the container node
already exists (instantiated when composing the `components:` key's value began) before the comment
token is reached, so the comment attaches to that container's own `.commentBefore`. At the very top
of a document, there is no open container yet — the parser cannot know whether the document root
will be a seq or a map until the first substantive (non-comment) token appears — so the comment
cannot attach to a container that doesn't exist yet, and the Composer instead attaches it to
whatever node is composed FIRST once the root's shape becomes known (which becomes `items[0]` here,
since the root turns out to be a seq).

### 5. Deletion implication — `deleteSeqItem` had not one but TWO independent bugs for index 0, both now fixed

**(a) Comment orphaning (the ticket's headline concern).** Running the OLD (pre-#17)
`deleteSeqItem(text, doc.contents, 0)` on `fixtures/types.yml` did NOT delete the leading comment —
contrary to a naive worry that a uniform (no index-0 special case) implementation might over-delete
a container's comment along with the first item. Instead it left BOTH comment groups orphaned, now
sitting directly above the new first entity (`BaseDoAfterAction`), which already has its own
separate, correctly-attached comment (`# base proto for an action that requires a DoAfter`) —
producing two adjacent, structurally distinct comments with no separator, semantically
misattributed. Confirmed live: running the naive version leaves the file starting with
`"# base actions\r\n\r\n# base prototype for all action entities\r\n\r\n# base proto for an action
that requires a DoAfter\r\n- type"`. Root cause: `cstItem.start[0]?.offset` for item 0 anchors
exactly at the `- ` marker (offset 60 on this fixture) — precisely where the CST comment prelude
ends (per Finding 1) — so the deletion boundary never reaches back into the comment region
regardless of what `items[0].commentBefore` claims at the AST level. This is a real, reproducible
mismatch between AST-claimed ownership and CST-reachable deletion boundary.

**(b) A SEPARATE, independently-discovered, comment-INDEPENDENT bug**, found via the
`substation.yml` control check: deleting index 0 of ANY indented/nested sequence via the old
anchor-only logic orphans that item's own leading indentation. `cstItem.start[0]?.offset` for item 0
is the offset of the dash character itself (161 for `Battery`), excluding any indentation before it
on the same line — unlike non-first items, whose own `.start` tokens sweep up indentation starting
from the end of the previous sibling. On `fixtures/substation.yml`, deleting `Battery` (the first
component of `components:`, 2-space indented) via the naive logic did not merely double an indent
(as the equivalent map-key bug would) — it produced literally invalid YAML on re-parse:
`YAMLParseError: A block sequence may not be used as an implicit map key at line 8, column 1`,
because the next surviving item's indentation became inconsistent within the block sequence. This
bug pre-existed in the original ticket-#10 `deleteSeqItem` code and is orthogonal to comments
entirely; it was never caught before because the only prior test case for `deleteSeqItem`
(`fixtures/job.yml`, index 1) was a non-first item of a ZERO-indent top-level sequence, where this
class of bug cannot manifest.

**Fix** (already implemented and committed in `prototype-surgical-edits/lib/edits.mjs`):
`deleteSeqItem`, for `index === 0`, now calls a new helper
`firstItemStart(text, anchor, hasOwnCommentBefore)` which (1) ALWAYS resolves to
`lineStart(text, anchor)` first — unconditionally fixing bug (b), the indent-orphan issue, for any
index-0 deletion — then (2) ONLY IF `item.commentBefore` is truthy, additionally walks backward
through the contiguous run of comment-or-blank lines immediately preceding that line — fixing bug
(a), the top-level leading-comment case. `item.commentBefore`'s truthiness is exactly the right
signal to gate step (2): it is false for the nested `Battery` case (so the walk-back never fires
there, correctly leaving `componentsSeq`'s own `# Core power behavior` comment untouched) and true
for the top-level `BaseAction` case (so it does fire, correctly consuming both comment groups). No
`doc`/`doc.contents` parameter needed to be threaded into the function signature — the AST already
exposes the needed ownership signal directly on the item.

Regression check performed: captured full stdout of `demo-hazards.mjs`, `demo-fireaxe.mjs`, and
`demo-comment-insertion.mjs` (the three pre-existing demo scripts from tickets #10/#14) BEFORE and
AFTER the `lib/edits.mjs` change, and diffed them — all three are byte-for-byte IDENTICAL. The only
pre-existing call site of `deleteSeqItem` (`fixtures/job.yml`, index 1, a non-first item) is
untouched by either new code branch, since both are gated on `index === 0`.

`prototype-surgical-edits/demo-toplevel-seq-comment.mjs` walks through all of this live: ownership
determination on `types.yml`; the OLD naive behavior orphaning the comment; the FIXED behavior
correctly removing it; a sanity re-check that deleting a non-first item (index 1) still works per
#10's rule; the `substation.yml` nested-seq contrast, INCLUDING the naive nested deletion actually
throwing the `YAMLParseError` on re-parse (caught in a try/catch and printed) followed by the fixed
version producing a clean, re-parsable diff.

## Recommendation

**Fixed in `prototype-surgical-edits/lib/edits.mjs`.** `deleteSeqItem` now branches only for
`index === 0`, delegating to `firstItemStart`, which unconditionally recovers the item's own
orphaned indentation and additionally walks back through leading comment/blank lines only when the
item actually owns one:

```js
const start = index === 0 ? firstItemStart(text, anchor, Boolean(item.commentBefore)) : anchor;
```

This is a **strict improvement with zero regression risk**: the three pre-existing demo scripts
(`demo-fireaxe.mjs`, `demo-hazards.mjs`, `demo-comment-insertion.mjs`) produce byte-for-byte
identical output before and after the change, because their only `deleteSeqItem` call site
(`fixtures/job.yml`, index 1) is a non-first item untouched by either new branch. On the two new
cases documented here, it produces the semantically correct result: a nested sequence's first item
(`Battery`) is deleted cleanly with no indentation corruption and no re-parse error, and a top-level
sequence's first item (`BaseAction`) takes its full leading comment (both groups) with it, leaving
the new first entity's own, separately-attached comment intact and unduplicated.

**Open design question for a future insertion-side edit class (informative, not a mandate).** No
"insert as new first item" edit class currently exists in `lib/edits.mjs` — classes 2 and 3, from
tickets #10 and #14 (`insertKey`, `insertComponentBlock`), only ever append via
`containerNode.range[2]`. If such a class is designed in the future for a TOP-LEVEL sequence, it
will face a genuine, currently-unresolved product ambiguity that this ticket surfaces but does not
resolve: when inserting a brand-new first entity before the current first one, should the existing
leading comment (which may read as a general file header, as in `types.yml`'s "# base actions")
stay attached to its original entity, move to become associated with the new first entity, or
become an unattached file-level header? The mechanical facts alone (comment lives on
`items[0].commentBefore`) do not settle this — it depends on what the comment is *about*, which the
parser cannot know. This is flagged explicitly as an open design question for whoever eventually
builds that edit class, not something resolved by this research ticket. For NESTED sequences (e.g.
`components:`), by contrast, inserting a new first item is unambiguous and requires no new
reasoning: the container's own comment boundary is structurally separate from any item's range (per
Finding 3), so the existing `containerNode.range[2]`-style insertion patterns already proven in
ticket #14 remain directly applicable with no special-casing needed.
