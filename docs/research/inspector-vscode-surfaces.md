# VS Code API surfaces for the editable inspector

**Ticket:** `wayfinder:research` (#2) — "Which VS Code API surfaces are viable for the editable inspector, and what does each permit?"
**Date:** 2026-09-08
**Status:** complete; ends with a Recommendation section.

## Scope and method

Evaluated four candidate surfaces against the project's hard constraints (recursive-to-arbitrary-depth handler registry; v1 widgets = checkbox / enum dropdown / text / button; the VS Code text editor stays open alongside and is the single source of truth; inspector writes only pointwise range edits, never a re-serialized document; must package as one Marketplace extension with no extra setup):

1. Webview — `WebviewViewProvider` (sidebar/panel view) and `WebviewPanel` (editor tab).
2. Native `TreeView` + `TreeItem` (`checkboxState`, item `command`s, inline actions).
3. `CustomTextEditorProvider`.
4. Combinations.

Primary sources (all first-party):

- VS Code Webview API guide — <https://code.visualstudio.com/api/extension-guides/webview>
- VS Code Tree View API guide — <https://code.visualstudio.com/api/extension-guides/tree-view>
- VS Code Custom Editor API guide — <https://code.visualstudio.com/api/extension-guides/custom-editors>
- VS Code API reference (`vscode.d.ts` rendered) — <https://code.visualstudio.com/api/references/vscode-api>
- VS Code UX guidelines, Webviews — <https://code.visualstudio.com/api/ux-guidelines/webviews>
- VS Code 1.80 release notes (tree checkbox finalization) — <https://code.visualstudio.com/updates/v1_80>
- VS Code 1.72 release notes (proposed tree checkbox) — <https://code.visualstudio.com/updates/v1_72>
- Sample: `microsoft/vscode-extension-samples/webview-view-sample` — <https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample>
- Sample: `microsoft/vscode-extension-samples/custom-editor-sample` (`catScratchEditor.ts`) — <https://raw.githubusercontent.com/microsoft/vscode-extension-samples/main/custom-editor-sample/src/catScratchEditor.ts>
- `microsoft/vscode` issue #116141 "Allow TreeItems to have optional checkboxes" — <https://github.com/microsoft/vscode/issues/116141>
- `microsoft/vscode-webview-ui-toolkit` issue #561 "Sunsetting the Webview UI Toolkit" — <https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561>

---

## 1. Webview — `WebviewViewProvider` and `WebviewPanel`

### What it is

A webview is "an `iframe` within VS Code that your extension controls" that can render "almost any HTML content" (Webview API guide). Two hosting shapes share the same `Webview` object and API:

- **`WebviewPanel`** — occupies an **editor tab**. Created with `window.createWebviewPanel(viewType, title, column, options)`.
- **`WebviewView`** — rendered inside a **sidebar or panel view container**. The extension implements `WebviewViewProvider.resolveWebviewView(webviewView, context, token)` and registers it with `window.registerWebviewViewProvider(viewId, provider)`; the view is declared in `package.json` under `contributes.views.<container>` with `"type": "webview"`. Requires `engines.vscode` >= `^1.49` (webview-view-sample README). Activation event `onView:<viewId>`.

The guide states the panel API "applies to the webviews used in custom editors and webview views as well."

### Interactive widgets available

Unrestricted. Because the body is author-controlled HTML/CSS/JS (JavaScript is off until `WebviewOptions.enableScripts: true`), the surface can render:

| v1 requirement | Webview mechanism |
| --- | --- |
| checkbox (bool) | native `<input type="checkbox">` |
| dropdown (enum) | native `<select>` / custom listbox; no need for `showQuickPick` |
| free text / number | native `<input>` / `<textarea>`, inline, with live validation |
| button | native `<button>` posting a typed message |
| **arbitrarily deep nested collapsible sections** | nested `<details>`/`<div>` rendered by a recursive component tree; no platform depth ceiling |

This is the **only** surface of the four that meets the recursive-depth + text-input + inline-dropdown requirements simultaneously.

Caveat: a webview gets **none** of VS Code's native look for free. The UX guidelines ("Webviews") say to use webviews "only ... when absolutely necessary", to make every element themeable via VS Code CSS custom properties / color tokens, and to meet accessibility requirements (contrast, ARIA, keyboard nav) by hand.

### Active-document / cursor awareness

**None automatically.** The webview is an isolated context; the guide describes no mechanism for a webview to observe the active editor. The extension host must observe and push state over `postMessage`:

- `window.activeTextEditor` — "the one that currently has focus" (may be `undefined`).
- `window.onDidChangeActiveTextEditor: Event<TextEditor | undefined>` — "fires when the active editor has changed."
- `window.onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>` — cursor/selection moves; event carries `textEditor` and `selections`.
- `workspace.onDidChangeTextDocument: Event<TextDocumentChangeEvent>` — document content edits.

Message plumbing (Webview API guide):

- host -> webview: `webview.postMessage(anyJsonSerializable)`; webview receives via `window.addEventListener('message', ...)`.
- webview -> host: `const vscode = acquireVsCodeApi()` (once per session), then `vscode.postMessage(...)`; host receives via `webview.onDidReceiveMessage(...)`.
- webview-local persistence: `vscode.getState()` / `vscode.setState(json)` — "persisted even after the webview content itself is destroyed when a webview panel becomes hidden."

### Receiving external text edits (user hand-edits the YAML)

The host's `workspace.onDidChangeTextDocument` handler (filtered by `e.document.uri`) re-parses and posts a fresh read-model to the webview — exactly the pattern in `catScratchEditor.ts`:

```ts
const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
  if (e.document.uri.toString() === document.uri.toString()) {
    updateWebview();
  }
});
webviewPanel.onDidDispose(() => { changeDocumentSubscription.dispose(); });
```

Reconciliation the inspector must do:

- Recompute source ranges for every `[DataField]` it renders (offsets shift on every external edit). Use a YAML library that exposes a CST / `LineCounter` so ranges are recovered, not guessed.
- Preserve in-progress widget focus / partial input when a refresh arrives (re-render diffing, not blow-away).
- **Echo-race:** the inspector's own `applyEdit` also fires `onDidChangeTextDocument`. Tag or version self-writes and ignore the reflected event, or debounce (`catScratchEditor` debounces `updateWebview`). `TextDocumentChangeEvent.reason` (`Undo` / `Redo` / undefined) helps disambiguate undo/redo from typing.

### Writing edits back

`WorkspaceEdit` + `workspace.applyEdit`, or `TextEditor.edit(editBuilder => ...)` against the visible editor. The inspector emits `edit.replace(uri, scalarRange, serializedScalar)` for the single changed token — it never replaces the whole-document range (the `catScratchEditor` sample does `edit.replace(new vscode.Range(0,0,lineCount,0), JSON.stringify(...))`; that whole-doc re-serialization is precisely what this project forbids and is not required by the API). Applied edits participate in the normal undo stack.

### Marketplace packaging

Beyond `vsce package` you must:

- **Bundle** the webview's front-end (esbuild or vite) to a small set of assets shipped in the `.vsix`; reference them with `webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', ...))`.
- Set `WebviewOptions.localResourceRoots` to just the asset dir (default is extension install dir + workspace; `[]` blocks all local resources).
- Ship a **Content Security Policy** `<meta>` tag: `default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-<random>'` (webview-view-sample uses a 32-char nonce). No inline scripts, HTTPS-only external.
- Decide persistence: `retainContextWhenHidden: true` has "high memory overhead and should only be used when other persistence techniques will not work" (guide + UX guidelines). Preferred: stateless webview + `setState`/`getState`. For a `WebviewPanel` that should survive a window reload, also `registerWebviewPanelSerializer` + `onWebviewPanel:<viewType>` activation.

Lifecycle to design around:

- **`WebviewPanel`**: content is destroyed when the tab is backgrounded (unless `retainContextWhenHidden`); `onDidChangeViewState` (visibility / column moves), `onDidDispose` (closed).
- **`WebviewView`**: collapsing the view or switching sidebar activity **deallocates the webview document**; it is recreated (provider re-resolved / page reloaded) when shown again. `onDidChangeVisibility` + `visible`. Right-click > hide **disposes the view** and fires `onDidDispose`. `WebviewViewResolveContext.state` carries back the last `setState` payload on re-resolve.

Historically fragile things to avoid:

- **`@vscode/webview-ui-toolkit` is dead** — samples repo archived Aug 2024, package deprecated / repo archived Jan 2025 (issue #561, downstream FAST realignment). Do **not** build v1 on it. Use plain elements styled with VS Code theme CSS variables, or a still-maintained lib.
- CSP typos and `vscode-resource:` vs `asWebviewUri` mistakes are the classic "worked locally, broke after a VS Code update" failure; pin to `webview.cspSource` + nonce and never hand-write resource URIs.

---

## 2. Native `TreeView` + `TreeItem`

### What it is

`window.createTreeView(viewId, { treeDataProvider })` or `window.registerTreeDataProvider`. The provider implements:

- `getChildren(element?): ProviderResult<T[]>` — children of `element`, or roots when absent. **Arbitrary nesting depth** is supported by recursion here plus `TreeItem.collapsibleState`.
- `getTreeItem(element): TreeItem | Thenable<TreeItem>` — UI for one node.
- optional `onDidChangeTreeData: Event<T | undefined>` — fire to refresh.

`TreeItem` fields: `label`, `description`, `tooltip`, `iconPath`, `collapsibleState` (`None` / `Collapsed` / `Expanded`), `contextValue` (drives `when` clauses), `command` (executed when the row is clicked), and `checkboxState`.

### Interactive widgets available — and the ceiling

| v1 requirement | TreeView answer |
| --- | --- |
| checkbox (bool) | **Yes, inline.** `TreeItem.checkboxState` = `TreeItemCheckboxState.Unchecked | Checked`. Changes arrive via `TreeView.onDidChangeCheckboxState: Event<TreeCheckboxChangeEvent<T>>` (`{ items: [T, TreeItemCheckboxState][] }`). `TreeViewOptions.manageCheckboxStateManually` controls whether VS Code auto-cascades parent/child. **Finalized in VS Code 1.80 (June 2023)**; existed earlier only as proposed API (proposed since ~1.72, Sept 2022; tracking issue microsoft/vscode#116141). Minimum `engines.vscode` `^1.80.0` to rely on it. |
| dropdown (enum) | **No inline control.** No `<select>` in a tree row, no combobox. Only workaround: give the item a `command` that calls `window.showQuickPick(items, options)` — a **transient modal picker**, not an inline widget, one extra click/keypress per edit. |
| free text / number | **No.** TreeView has **no text input of any kind**. Workaround: `command` -> `window.showInputBox(options)`, again a modal prompt. Renaming-style inline edit is not exposed to extensions. |
| button | Inline command icons via `contributes.menus` `"view/item/context"` with `"group": "inline"` and a `when: viewItem == <contextValue>` clause; and/or the row-level `command`. Icon-only, no arbitrary label widget. |
| **arbitrarily deep nested collapsible sections** | **Yes** — this is the one thing TreeView does natively and well: recursive `getChildren` + `collapsibleState`, unlimited depth, native expand/collapse, keyboard nav, theming, accessibility all free. |

Net: a TreeView can express the **structure** (deep collapsible tree) and the **bool** widget natively, but **cannot** host enum dropdowns or text/number entry inline — those degrade to modal `showQuickPick` / `showInputBox`. That fails the "interactive form widgets" intent for 3 of 4 v1 widget types.

### Active-document / cursor awareness

Full and easy — the provider runs in the extension host, so `window.activeTextEditor`, `window.onDidChangeActiveTextEditor`, `window.onDidChangeTextEditorSelection`, `workspace.onDidChangeTextDocument` are all directly available. No message bridge.

### Receiving external text edits

Trivial. Subscribe to `workspace.onDidChangeTextDocument`, re-parse, call `onDidChangeTreeData.fire()`. The tree holds no authoritative model of its own, so there is **no write/refresh race** and no reconciliation logic beyond "rebuild nodes." Its own edits (checkbox toggles -> `WorkspaceEdit`) also just trigger a refresh; idempotent.

### Marketplace packaging

Cleanest of all four. Pure `vsce package`: no bundled front-end, no CSP, no `localResourceRoots`, no webview assets, no `retainContextWhenHidden` memory cost. Contributes a `views` entry (non-webview) and optional `menus`. Activation `onView:<viewId>`. Nothing here has a history of breaking across VS Code updates; the only version gate is `^1.80.0` for finalized `checkboxState`.

---

## 3. `CustomTextEditorProvider`

### What it is

`window.registerCustomEditorProvider(viewType, provider, options)` with `provider.resolveCustomTextEditor(document: TextDocument, webviewPanel: WebviewPanel, token)`. Declared in `package.json` `contributes.customEditors`: `viewType`, `displayName`, `selector` (glob array), `priority` (`"default"` = always use it for matching files; `"option"` = only via **View: Reopen With**).

`CustomTextEditorProvider` is backed by a standard `TextDocument` (right model for YAML). `CustomEditorProvider` (with a bespoke `CustomDocument`) is for binary formats and is not relevant here.

### Interactive widgets available

**Identical to a Webview** — `resolveCustomTextEditor` hands you a `WebviewPanel`, so all of section 1's widget freedom (checkbox, `<select>`, text input, button, arbitrarily nested collapsible DOM) applies verbatim, along with all of section 1's theming / CSP / bundling burden.

### Active-document / cursor awareness

The **document is bound for you**: `resolveCustomTextEditor` receives the exact `TextDocument` this editor instance represents — no need to track `activeTextEditor`. Cursor/selection inside a custom editor is **not** surfaced as a normal `TextEditor.selection` (the custom editor replaces the text UI), so "where is the user's cursor in the YAML" is only meaningful if a plain text editor for the same doc is also open elsewhere.

### Receiving external text edits

Same pattern as section 1 and the `catScratchEditor` sample: `workspace.onDidChangeTextDocument` filtered by `document.uri.toString()` -> repost state to the webview; dispose the subscription in `webviewPanel.onDidDispose`. One `TextDocument` can back multiple custom-editor `WebviewPanel`s (split view) and they must all stay in sync. Same echo-race between the editor's own `applyEdit` and the change event.

### The constraint conflict

The project requires the **plain VS Code text editor to stay open alongside and never be replaced**. A `CustomTextEditorProvider`:

- With `priority: "default"` it **becomes** the editor for every matching `*.yml` prototype file — it replaces the text editor. Directly violates the constraint.
- With `priority: "option"` the file still opens as plain text by default; the user must **View: Reopen With -> (custom editor)**, which replaces the text view **in that tab**. To see both, the user manually splits and does "Reopen With -> Text Editor" on one pane, or configures `workbench.editorAssociations`. Side-by-side is never the default and is a per-user manual step — friction the "no extra setup" constraint dislikes.

So `CustomTextEditor` buys the automatic document binding but at the cost of tab ownership semantics that fight the "text editor always alongside" rule, while still carrying the full webview packaging load. It is strictly worse than a sidebar `WebviewView` for this feature.

---

## 4. Combinations

- **TreeView (navigation) + WebviewView (editing), same sidebar container.** Tree renders the recursive prototype structure natively (cheap, accessible, deep) and posts the selected node path to a sibling webview; the webview renders only the widgets for the current node/subtree. Splits the depth problem (tree) from the widget problem (webview). Cost: two views to keep in sync, a selection message protocol, and you still ship the webview (so all of section 1's packaging load remains). Reasonable **v2** once the webview exists — the tree adds fast keyboard navigation for very large prototypes.
- **Webview-only (single `WebviewView`).** The webview renders both the recursive collapsible tree and the inline widgets in one DOM. Simplest surface count, one message protocol, total layout control. This is the v1 target.
- **Webview-only (`WebviewPanel` in an editor tab).** Same capability as the view, but it occupies an editor tab next to the text editor rather than the sidebar. Heavier (tab real estate, serializer for reload survival) and reads as "another editor" rather than an inspector. The sidebar `WebviewView` is the better fit for an always-available inspector.
- **CustomTextEditor + manual split.** Covered in section 3 — replaces tab semantics; not recommended.

---

## Special sub-question — how the predecessor's UI-layer collapse is structurally prevented

The predecessor `TheShuEd/SS14Editor` (separate legacy repo, reference only) failed on: 25 ordered `<script>` tags in one `index.html`, no ES modules, a single global mutable `state`, and a 1079-line hand-rolled YAML round-trip. The recommendation below **is** a webview, so this must be addressed concretely.

1. **Bundler produces ES modules, one script tag.** The webview front-end is TypeScript compiled/bundled by **esbuild** (the toolchain VS Code's own `yo code` webpack/esbuild templates use) or vite, output as a single tree-shaken ESM/IIFE bundle loaded by exactly **one** `<script type="module" nonce="...">`. There is no manual script ordering to get wrong; dependency order is the module graph. CSS is one bundled stylesheet under `style-src ${webview.cspSource}`.

2. **Typed, versioned message protocol.** A shared `src/protocol.ts` imported by both the extension host and the webview defines discriminated unions:
   - `HostToWebview = { type: 'load', model: InspectorModel } | { type: 'externalEdit', model: InspectorModel } | { type: 'ack', editId: string } | ...`
   - `WebviewToHost = { type: 'setField', path: FieldPath, value: ScalarValue, sourceRange: Range } | { type: 'invoke', path: FieldPath } | { type: 'ready' } | ...`
   `webview.onDidReceiveMessage` and the webview's `message` listener both `switch (msg.type)` with exhaustiveness checking. No untyped `postMessage` payloads.

3. **Explicit state container, not a global.** The webview holds one store (a small reducer / signals lib / framework store), hydrated from `acquireVsCodeApi().getState()` on load and re-hydrated from a `load` / `externalEdit` message when the view is re-shown (webview docs are deallocated on collapse). No ambient mutable `window.state`. The extension host keeps **no** duplicate model — the `TextDocument` is the source of truth; the host only derives a read-model on demand.

4. **The inspector never round-trips YAML.** The host parses the document **once per change** with a maintained YAML library (`yaml` / `eemeli/yaml`) using its CST + `LineCounter`, producing a read-model where every `[DataField]` carries its exact source `Range`. The webview emits `{ path, newValue, range }` intents; the host turns each into `edit.replace(uri, range, serializeScalar(newValue))` — **only the single scalar token is serialized**, the surrounding document text is untouched. There is no hand-rolled parser and no whole-document re-emit (contrast the `catScratchEditor` sample's `JSON.stringify` over `Range(0,0,lineCount,0)`, which is explicitly *not* adopted).

5. **Component registry mirrors the handler registry.** The v1 renderer is a registry keyed by C# type -> render function/component (Preact/Lit/Svelte, or disciplined vanilla components). `ComponentRegistry` is just another entry that recurses. Unknown type -> `TodoStub` component. Recursion depth = component nesting depth; each component owns its own collapsible block. This is the same shape as the domain requirement, so the UI structure cannot drift into one megafile.

What is *not* enforced by the platform: all five points are team discipline, not VS Code guarantees. The mitigation is that each is a standard, well-trodden pattern with first-party examples (`webview-view-sample` for #1–#3, `custom-editor-sample` for #4's change-subscription plumbing), and CI can lint for "one entry script", "no `any` in protocol", "no document-wide `WorkspaceEdit` range".

---

## Comparison matrix

| Criterion | Webview (`WebviewView` / `WebviewPanel`) | Native `TreeView` | `CustomTextEditorProvider` |
| --- | --- | --- | --- |
| checkbox (bool) inline | yes (HTML) | yes — `checkboxState`, finalized 1.80 | yes (HTML) |
| enum dropdown inline | yes (`<select>`) | **no** — only modal `showQuickPick` | yes (`<select>`) |
| free text / number inline | yes (`<input>`) | **no** — only modal `showInputBox` | yes (`<input>`) |
| button | yes | icon-only, via `view/item/context` `inline` | yes |
| arbitrarily deep nested collapsible | yes (recursive DOM) | yes (recursive `getChildren`) | yes (recursive DOM) |
| native VS Code look / a11y for free | **no** — hand-themed | yes | **no** — hand-themed |
| document/cursor awareness | manual (`onDidChangeActiveTextEditor` etc. + `postMessage`) | direct (host APIs) | document auto-bound; no `TextEditor.selection` |
| external-edit handling | re-parse -> `postMessage`; echo-race to guard | re-parse -> `onDidChangeTreeData.fire()`; no race | re-parse -> `postMessage`; echo-race to guard |
| pointwise range edits | yes (`WorkspaceEdit.replace(range,...)`) | yes | yes (sample does whole-doc; not required) |
| text editor stays alongside | **yes** — sidebar view, never a tab | yes | **no** — owns the tab (`default`) or manual split (`option`) |
| packaging beyond `vsce package` | bundler + CSP + nonce + `localResourceRoots` (+ serializer for panel) | nothing | same as webview |
| update-fragility flags | CSP/resource-URI mistakes; `webview-ui-toolkit` deprecated Jan 2025 — do not use | none material; `^1.80` for checkbox | same as webview |
| min `engines.vscode` | `^1.49` (webview view) | `^1.80` (finalized checkbox) | `^1.55` |

---

## Recommendation

**Use a webview, hosted as a `WebviewViewProvider` in the sidebar (a "webview view"), webview-only for v1.** Add a native `TreeView` later as a pure navigation aid if large prototypes make DOM scrolling slow — it is additive, not a v1 dependency. Do **not** use `CustomTextEditorProvider`.

Load-bearing reasons:

1. **Only the webview can render all four v1 widgets *and* arbitrarily deep nested collapsible sections inline.** `TreeView`'s ceiling is hard: no inline text entry and no inline dropdown — enum and string/number fields would degrade to modal `showQuickPick` / `showInputBox`, which is not an "interactive form widget" and breaks the recursive-inline-editing model. Checkbox-only native editing (finalized VS Code 1.80) covers just one of the four widget types.
2. **A sidebar webview view never occupies an editor tab, so the text editor stays open alongside it unchanged** — satisfying "text is the single source of truth, the editor is never replaced." `CustomTextEditorProvider` fails this: `priority: "default"` replaces the text editor for every prototype file, and `priority: "option"` still requires a manual per-user split to see both, conflicting with the "no extra setup" constraint — all while carrying the identical webview packaging burden.
3. **The recursive handler registry maps directly onto a webview component tree** keyed by C# type (`ComponentRegistry` recurses; unknown type -> TODO stub; each component owns a collapsible block). No other surface lets the render structure match the domain structure this cleanly.
4. **Packaging stays within a normal `vsce package`**: an esbuild-bundled single ESM entry, a static nonce-based CSP, and `localResourceRoots` pointed at `dist/`. No server, no separate install, no localhost, no user steps. The predecessor's UI collapse is structurally prevented by the bundler (ES modules, one script tag), a shared typed message protocol, an explicit webview state store, a component registry, and the fact that the inspector emits only `{path, value, range}` intents that the host turns into single-token `WorkspaceEdit.replace` calls — it never parses or re-serializes YAML itself.

Trade-offs accepted:

- The webview gets no native theming or accessibility for free; every widget must be built on VS Code CSS theme variables and pass contrast / ARIA / keyboard checks by hand. The former convenience layer, `@vscode/webview-ui-toolkit`, is deprecated (repo archived Jan 2025) and must not be adopted; use plain themed elements or a currently-maintained component lib.
- Webview document context is deallocated whenever the view is collapsed or the sidebar switches activity; the webview must be stateless and re-hydrate from the host on `onDidChangeVisibility` / re-resolve. `retainContextWhenHidden` is explicitly avoided for its memory cost.
- Active-editor and cursor awareness is manual wiring: the host subscribes to `window.onDidChangeActiveTextEditor`, `window.onDidChangeTextEditorSelection`, and `workspace.onDidChangeTextDocument`, and pushes derived state over `postMessage`. Self-writes must be tagged/versioned (or debounced) so the reflected `onDidChangeTextDocument` is not processed as an external edit.
- All discipline that prevents the predecessor outcome (bundler, typed protocol, state container, no YAML round-trip) is enforced by the team and CI, not by the platform.

Residual unknowns (candidate follow-up tickets / map "Not yet specified" entries):

- **External-edit reconciliation spec.** Exact behaviour when a hand-edit lands while a widget has focus or partial/invalid input: focus retention, in-flight value handling, and how stale source ranges are recovered. Needs its own design note.
- **Echo-race protocol detail.** The concrete scheme for tagging inspector-originated edits and correlating the reflected `onDidChangeTextDocument` (edit ids? document version watermark? `TextDocumentChangeEvent.reason`?).
- **Enum member source.** Where dropdown options come from for a C# enum `[DataField]` — parsed from C# source, from a generated manifest, or from reflection over a build artifact — is unspecified.
- **Undo/redo grouping.** `WorkspaceEdit` edits join the undo stack, but whether a single widget change is one undo step, and how inspector edits interleave with the user's own text-editor undo history, is unspecified.
- **`engines.vscode` floor for v1.** Only matters if the optional navigation `TreeView` with finalized `checkboxState` ships in v1 (would force `^1.80.0`); the webview-only path only needs `^1.49`.
- **Multi-editor / split behaviour.** Which document the inspector targets when the same prototype file is open in multiple editor groups, or when several prototype files are visible at once, is unspecified.
