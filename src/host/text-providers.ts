import * as vscode from 'vscode';

import { completionsAt, type CompletionCandidate, type SchemaRoot } from '../core';
import type { ForkStatusController } from './fork-status-controller';
import type { SchemaController } from './schema-controller';

/**
 * The language-feature providers that read the prototype schema (spec #20,
 * "Текстовые провайдеры"; issue #27 ships the first — completion).
 *
 * All of them share one registration and one document selector: YAML files under
 * `Resources/Prototypes/**` of the recognised fork, and only while a schema is
 * loaded. {@link SchemaController.onDidChange} fires on every fork- and
 * schema-status change, so this controller re-evaluates the selector then —
 * bringing the providers up when a fork's schema loads and tearing them down
 * when it stops being a recognised, freshly-built fork. Until then the providers
 * are simply not registered, so they stay silent (issue #27 acceptance
 * criterion: "до готовности схемы провайдер молчит").
 *
 * Hover and go-to-definition (later tickets) register alongside completion here,
 * on the same {@link selectorFor} selector.
 */
export class TextProviderController implements vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  /** Fork root the current registration is scoped to — so an unchanged status is a no-op. */
  private registeredRoot: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly forkStatus: ForkStatusController,
    private readonly schema: SchemaController,
  ) {
    this.disposables.push(this.schema.onDidChange(() => this.sync()));
    this.sync();
  }

  private sync(): void {
    const root = this.forkStatus.recognizedRoot();
    const wantedRoot = root && this.schema.schema !== null ? root.uri.toString() : undefined;

    // Leave an existing registration (and any open completion session) alone
    // when nothing that shapes it has changed.
    if (wantedRoot === this.registeredRoot) return;

    this.registration?.dispose();
    this.registration = undefined;
    this.registeredRoot = wantedRoot;
    if (!root || wantedRoot === undefined) return;

    this.registration = vscode.languages.registerCompletionItemProvider(
      selectorFor(root.uri),
      new PrototypeCompletionProvider(() => this.schema.schema),
      ' ',
      ':',
    );
  }

  dispose(): void {
    this.registration?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

/** YAML prototype files of one fork — the selector every schema-aware provider shares. */
export function selectorFor(forkRoot: vscode.Uri): vscode.DocumentSelector {
  return {
    language: 'yaml',
    scheme: 'file',
    pattern: new vscode.RelativePattern(forkRoot, 'Resources/Prototypes/**/*.{yml,yaml}'),
  };
}

/**
 * Thin adapter: hand the document text and caret offset to the core, wrap each
 * candidate in a `CompletionItem`. All parsing, cursor-context and candidate
 * logic is in the pure core ({@link completionsAt}); nothing YAML- or
 * schema-specific lives here.
 */
export class PrototypeCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getSchema: () => SchemaRoot | null) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const schema = this.getSchema();
    if (!schema) return undefined;

    // `document.getText()` is already BOM-free (VS Code strips it from the
    // model) and `offsetAt` counts over that same text, so offsets line up with
    // what the core parses.
    const candidates = completionsAt(document.getText(), document.offsetAt(position), schema);
    return candidates.map(toCompletionItem);
  }
}

const KIND: Record<CompletionCandidate['kind'], vscode.CompletionItemKind> = {
  prototype: vscode.CompletionItemKind.Struct,
  component: vscode.CompletionItemKind.Class,
  field: vscode.CompletionItemKind.Field,
  value: vscode.CompletionItemKind.EnumMember,
};

function toCompletionItem(candidate: CompletionCandidate): vscode.CompletionItem {
  const item = new vscode.CompletionItem(candidate.label, KIND[candidate.kind]);
  if (candidate.detail) item.detail = candidate.detail;
  // Set only where the core had to synthesize the `type:` key the caret needs;
  // `filterText` keeps the bare name matching what the author actually types.
  if (candidate.insertText) {
    item.insertText = candidate.insertText;
    item.filterText = candidate.label;
  }
  return item;
}
