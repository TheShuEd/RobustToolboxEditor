# Insertion semantics near comments (`yaml`@eemeli CST/AST)

Research ticket: [`crystallpunk-14/SS14Editor#14`](https://github.com/crystallpunk-14/SS14Editor/issues/14)
("Спайк на yaml@2.8.x CST: фикстуры реальных прототипов"), a narrow follow-up spike closing
residual unknown item 3 of
[docs/research/ts-yaml-node-positions.md](./ts-yaml-node-positions.md) (decision
[#3](https://github.com/crystallpunk-14/SS14Editor/issues/3)):

> **Insertion semantics around comments** — when adding a key to a map whose last line has a
> trailing `# comment`, or where the map is followed by a standalone comment block, where
> exactly does the new line go? Needs test fixtures drawn from real prototype files.

Built on top of the three edit classes and tooling proven in
[`crystallpunk-14/SS14Editor#10`](https://github.com/crystallpunk-14/SS14Editor/issues/10)
(`prototype-surgical-edits/`); see that ticket's deletion-side comment findings
(`prototype-surgical-edits/README.md`, section "Удаление ключа/компонента и «прилипшие»
комментарии") for contrast — this document is the insertion-side counterpart that section
explicitly left open.

Date: 2026-09-09. Branch: `worktree-agent-a70f3fe6b724a773f` (worktree of
`prototype/prototype-surgical-edits`).

## Question

Ticket #10 proved two insertion edit classes — class 2 (`insertKey`, materializing an
inherited field into an existing map) and class 3 (`insertComponentBlock`, appending a new
`- type: X` block to `components:`) — both using the same trick: the insertion offset is
`range[2]` ("node-end", the offset where the next real token begins) of the **last existing
item** in the container. That trick was proven correct on `fixtures/fireaxe.yml`, but that
fixture happens to have **no comment adjacent to either insertion point** — it was untested
against comments entirely.

Concretely: when the container's last existing field/component has a trailing `# comment` on
its own line, or is immediately followed by a standalone comment line/block before the
container closes, does `range[2]`-of-last-item ever land **inside or before** that comment?
If so, the established algorithm would splice new content between the last item and its
comment, corrupting nothing syntactically (the file still re-parses) but **misplacing the
comment relative to the content it was written to describe**.

## Method and sources

Same primary sources as `ts-yaml-node-positions.md`: `yaml` (eemeli) `docs/05_content_nodes.md`
(`NodeBase.range`, `.comment`, `.commentBefore`) and `src/nodes/types.ts`, run against
`yaml@2.8.x` (`prototype-surgical-edits/package.json` pins `^2.8`) with `keepSourceTokens: true`
and a `LineCounter`, exactly as `prototype-surgical-edits/lib/model.mjs` already does.

Three real fixture files, found by scanning every `.yml`/`.yaml` file under
`Resources/Prototypes/` in the crystall-edge fork checked out locally at
`C:\Users\edwar\Desktop\ss14 SpriteWork\Local SS14 Client Full\CrystallEdge\crystall-edge\`, for
lines that (a) are a `key: value # comment` immediately followed by a **dedent** (the container
closing), or (b) are a standalone `# comment` line immediately followed by a dedent, with a real
field on the line before it. Copied 1:1 (verified with `md5sum` against the source path) into
`prototype-surgical-edits/fixtures/`:

- **`fixtures/mapping.yml`** ← `Actions/mapping.yml` — trailing same-line comment cases.
- **`fixtures/alert_levels.yml`** ← `AlertLevels/alert_levels.yml` — standalone multi-line
  comment block after the last field of a flat (no-`components:`) map.
- **`fixtures/drinks_bottles_plastic.yml`** ← `Entities/Objects/Consumable/Drinks/drinks_bottles_plastic.yml`
  — standalone one-line comment after the last component of `components:`; the pattern
  (`# TODO new sprite`) recurs **13 times** in this one file (lines 178, 193, 208, 223, 238, 253,
  268, 283, 298, 313, 328, 343, 358 — the last one sitting at end-of-file), so this is not a
  contrived one-off.

Findings were derived empirically: parse each fixture with `loadPrototypeFile`, walk to the
relevant node via `findEntity`/`findComponent`/`findField` (all from `lib/model.mjs`,
unmodified), and print `range`, `.comment`, `.commentBefore` for the field/component/container
nodes plus the raw text around the resulting offset. Demo script:
`prototype-surgical-edits/demo-comment-insertion.mjs`. Run: `node demo-comment-insertion.mjs`
from `prototype-surgical-edits/` (after `npm install`).

## Findings

### 1. Trailing same-line comment — already safe, offsets are provably identical

`fixtures/mapping.yml:17`, entity `BaseMappingDecalAction` (lines 9–17), last component
`WorldTargetAction`, last field `event`:

```yaml
  - type: WorldTargetAction
    event: null # has to be set with SetEvent in DecalPlacementSystem
                                                                        <- blank line 18
- type: entity                                                        <- line 19
```

`pair.value.range = [387, 391, 447]`. `valueEnd` (391) is right after `null`; `nodeEnd` (447)
lands exactly at the start of `- type: entity` on line 19 — i.e. it already extends **past**
the trailing comment and its own line terminator (it stops before the blank line, so the new
content lands directly under the comment, not after the blank separator). This matches
`docs/05_content_nodes.md`: "the `value-end` and `node-end` positions ... `node-end` … covers
trailing whitespace/comment/newline that the composer associates with the node." A trailing
same-line comment is exactly the kind of thing the composer folds into the *value's own*
`nodeEnd` (it also becomes `pair.value.comment === " has to be set with SetEvent in
DecalPlacementSystem"`).

Consequence: for this sub-case, `last.value.range[2]` (what `insertKey`/`insertComponentBlock`
originally used) and `containerNode.range[2]` (the map's or seq's own `range[2]`) are **the same
number** — confirmed by direct equality check in the demo (`naive === fixed` prints `true`,
offset 447 both ways). Also confirmed at true end-of-file: `fixtures/mapping.yml:53`, entity
`BaseMappingEntityAction` (last entity in the file), `event: null # has to be set with SetEvent
in ActionsSystem` is the last line of the file — `range[2] === text.length` (1468), no trailing
newline, and appending there works cleanly (see demo section 2b). **No fix needed for this
sub-case**; the original ticket-#10 algorithm was already correct here, not by luck but because
of how the composer defines a scalar's own `nodeEnd`.

### 2. Standalone comment (own line) — the original algorithm was wrong

`fixtures/alert_levels.yml`, entry `Red` (lines 32–44), a flat map (no nested `components:`):

```yaml
  shuttleTime: 600           <- line 41, last field
  # No reduction in time as we don't have swiping for red alert like in /tg/.   <- 42
  # Shuttle times are intended to create friction,                             <- 43
  # so having a way to brainlessly bypass that would be dumb.                  <- 44
                              <- blank line 45
- type: alertLevel            <- line 46 (next entity, Violet)
```

Here `pair.value.range` for `shuttleTime` is `[1109, 1112, 1114]` — `nodeEnd` (1114) stops
**immediately before** the comment block (`shuttleTime.comment === undefined`). The entire
3-line comment block instead becomes the **containing map's own** `.comment`:
`red.comment === " No reduction in time ... dumb.\r\n"`, and `red.range[2] === 1310`, which
*does* extend past the comment block and the blank line, landing exactly at the start of
`- type: alertLevel` (Violet). So `last.value.range[2]` (1114) and `containerNode.range[2]`
(1310) **diverge** — a real, reproducible 196-byte gap covering exactly the 3 comment lines plus
the blank line.

The original `insertKey` (`insertAt = last.value.range[2]`) would have spliced the new field at
1114 — **between** `shuttleTime` and its own trailing comment block:

```yaml
  shuttleTime: 600
  emergencyLightBlink: true
  # No reduction in time as we don't have swiping for red alert like in /tg/.
  ...
```

The comment — which reads as a note about `shuttleTime` (or the entry as a whole) — now sits
*after* an unrelated new field, misattributed. The file still re-parses cleanly (this is not a
syntax corruption, it is a semantic misplacement) — exactly the ambiguous "does the new content
end up misplaced relative to the comment" failure mode the ticket asked about. Demonstrated
live in `demo-comment-insertion.mjs` section 3 ("НАИВНЫЙ алгоритм").

The same divergence, same magnitude of hazard, reproduces for **class 3** in
`fixtures/drinks_bottles_plastic.yml`, entity `DrinkSugarJug` (lines 164–180):

```yaml
  - type: Label                          <- line 176
    localizedLabel: reagent-name-sugar   <- line 177, last field of last component
  # TODO new sprite                      <- line 178, standalone, attaches to components: itself
                                          <- blank line 179
- type: entity                           <- line 180 (next entity)
```

`componentNode` (the `Label` map) has `range = [4569, 4622, 4622]` and `componentNode.comment
=== undefined`. The comment instead attaches to the **`components:` sequence node itself**:
`componentsSeq.comment === " TODO new sprite\r\n"`, `componentsSeq.range[2] === 4645` (past the
comment and the blank line, at the start of the next entity), while
`items[items.length - 1].range[2] === 4622` (right before the comment). The original
`insertComponentBlock` (`insertAt = items[items.length - 1].range[2]`) would have spliced the
new `- type: Sprite` block at 4622:

```yaml
  - type: Label
    localizedLabel: reagent-name-sugar
  - type: Sprite
    sprite: Objects/Consumable/Drinks/sugarjug.rsi
  # TODO new sprite
```

— landing the new `Sprite` component *before* the comment that specifically says "TODO new
sprite" (see `demo-comment-insertion.mjs` section 4 — the diff is reproduced there verbatim,
including the irony). This is the clean, repeated (13x in one file), real-world instance of
exactly the hazard ticket #14 set out to test.

### Where, structurally, the comment attaches (why `containerNode.range[2]` is the fix)

In both standalone cases the comment is consumed as the `.comment` of whichever collection node
(`YAMLMap` or `YAMLSeq`) is the **innermost still-open container** at the point the comment
token appears, and that container's own `range[2]` (not the last child's) is extended past the
comment and any trailing blank lines up to the next real token. For `Red` that container is the
entry's own map (nothing more deeply nested was open). For `DrinkSugarJug` that container is the
`components:` sequence (the `Label` map had already closed one level up; the comment's own
indent — matching the seq item/dash column, shallower than `Label`'s field column — is
consistent with this). Practically this means: **always take `range[2]` of the container you are
inserting into (the `YAMLMap` for `insertKey`, the `YAMLSeq` for `insertComponentBlock`), never
of the last item inside it.**

This also explains why sub-case 1 (trailing same-line comment) needed no fix: there the comment
is folded into the last *value's* own `nodeEnd` because nothing else is "open" at that point
either — value and container ranges coincide by construction. The general fix subsumes both
cases; it does not need to special-case trailing-vs-standalone.

### Direction of attachment depends on the blank line, confirming and extending ticket #10

Ticket #10 established (deletion side): a comment before the *first* item of a collection
belongs to the container (`commentBefore`); a comment before a *non-first* item is that item's
own leading token. This document adds the insertion-side, dedent-boundary rule, and it is
governed by a different signal — **presence or absence of a blank line separating the comment
from what follows it**, not first/non-first position:

- Comment with a **blank line after it, before the next sibling** → attaches *backward* (becomes
  `.comment` of the preceding container/value) — all three cases above.
- Comment with **no blank line after it, before the next sibling** → attaches *forward*
  (`commentBefore` of what follows), regardless of a blank line *before* the comment. Confirmed
  in the same fixture: `fixtures/mapping.yml:44`, `# these are used for mapping actions yml
  files`, has a blank line before it (line 43) but none after (line 45 is the next entity
  immediately) — and indeed `doc.contents.items[…].commentBefore === " these are used for
  mapping actions yml files"` for `BaseMappingEntityAction`, not attached to the previous entity
  at all.

This is a clean, mechanical rule confirmed on real files, not a guess: check whether a blank
line separates the comment from the *following* content; that alone decides attachment
direction, independent of indentation depth or first/non-first position.

### Sub-cases verified vs. still open

Verified on real fixtures: map + trailing same-line comment; map + standalone comment block;
`components:` sequence + trailing same-line comment; `components:` sequence + standalone
comment (including at true end-of-file, both for the trailing case in `mapping.yml:53` and the
standalone case in `drinks_bottles_plastic.yml:358`). That covers all four combinations named in
the residual unknown (map/seq × trailing/standalone).

Still open (out of scope here, not required by #14): standalone comment *blocks* spanning
multiple lines inside a `components:` sequence (only single-line standalone comments were found
in real `components:` lists during the scan); comment attachment when the insertion container is
itself the very first item of its parent (interacts with the ticket-#10 first-item rule, not
exercised here since all three fixtures insert after a non-first-position or only container).

## Recommendation

**Fixed in `prototype-surgical-edits/lib/edits.mjs`.** Both `insertKey` and
`insertComponentBlock` now compute the insertion offset from the **container's own**
`range[2]` (`containerNode.range[2]` / `componentsSeq.range[2]`) instead of the last
item's/field's `range[2]`:

```js
// insertKey — was: const insertAt = last.value.range[2];
const insertAt = containerNode.range[2];

// insertComponentBlock — was: const insertAt = items[items.length - 1].range[2];
const insertAt = componentsSeq.range[2];
```

This is a **strict improvement with zero regression risk**: on the original no-comment
fixture (`fixtures/fireaxe.yml`, the two insertion points proven in ticket #10), the two
offsets are byte-for-byte identical — checked directly (`last.value.range[2] === 1654 ===
componentNode.range[2]` for the map case; `1336 === 1336` for the seq case) — so
`demo-fireaxe.mjs` and `demo-hazards.mjs` produce **unchanged diffs** after the fix (verified by
re-running both). On the four comment-adjacent cases documented above, it produces the
semantically correct placement: new content lands immediately after the last existing
item/field and *before* any trailing/standalone comment attached to the container, leaving the
comment exactly where it was, on the line(s) it originally occupied.

No CST-level "skip trailing comment tokens" logic is needed — the AST's own container-level
`range[2]` already does that skipping internally; the bug was purely in *which node's* `range[2]`
the ticket-#10 code was reading.
