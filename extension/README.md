# SS14 Prototype Editor

VS Code extension for editing SS14 (RobustToolbox) YAML prototypes with schema
awareness. This package is the extension itself; see the repo root `CONTEXT.md`
and `docs/` for the domain model and design decisions, and issue
[#20](https://github.com/crystallpunk-14/SS14Editor/issues/20) for the v1 spec.

## Status

Issue [#21](https://github.com/crystallpunk-14/SS14Editor/issues/21) — the
skeleton — plus issue
[#23](https://github.com/crystallpunk-14/SS14Editor/issues/23): the extension
contributes its own **SS14 Editor** activity-bar container holding an
**Inspector** webview view. That panel now runs fork detection on the workspace
root and reports either "SS14 fork recognized" or the single concrete reason it
is not (no `RobustToolbox` submodule, no `Content.Server` / `Content.Client` /
`Resources/Prototypes`, no DLLs in `bin/Content.*`, or a stale build). No editing
behaviour yet; later tickets build on this shell.

## Layout

| Path          | Layer                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `src/core/`   | Pure TypeScript. **No `vscode` import** — the single test seam (lint-enforced). Fork detection lives here, over a `ForkFs` directory abstraction. |
| `src/host/`   | Thin VS Code adapter: activation, view registration, the real-FS `ForkFs`, `WorkspaceEdit`. |
| `src/webview/`| Inspector UI bundle. ESM, loaded from one `<script type="module">`.         |
| `src/shared/` | Types shared by host and webview (the message protocol).                    |
| `media/`      | Static assets shipped in the `.vsix` (the activity-bar icon).               |

`esbuild.mjs` produces three independent bundles: `dist/extension.js` (host,
CommonJS), `dist/webview/main.js` (webview, ESM), and `out/test/smoke/` (the
activation test).

## Commands

```sh
npm install
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (incl. the core/vscode import boundary)
npm run test:core     # vitest — fast, no VS Code
npm run test:smoke    # @vscode/test-electron activation smoke test
npm run build         # esbuild: host + webview + smoke bundles
npm run package       # build + vsce package -> ss14editor.vsix
```

## Schema extractor

The v1 spec pairs this extension with a vendored C# CLI that extracts the schema
from a fork's compiled DLLs. Its `dotnet publish` step slots into CI ahead of the
bundle step (see `.github/workflows/ci.yml`); it does not exist yet.
