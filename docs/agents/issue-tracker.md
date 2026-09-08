# Issue tracker: GitHub via MCP

Issues and specs for this repo live as GitHub issues in **`crystallpunk-14/SS14Editor`**.

> **The `gh` CLI is not installed on this machine.** Do not reach for it. All issue operations go through the **GitHub MCP server** (`mcp__github__*` tools). Pass `owner: "crystallpunk-14"`, `repo: "SS14Editor"` explicitly on every call.

> **Two repos are named `SS14Editor`.** `crystallpunk-14/SS14Editor` is *this* project. [`TheShuEd/SS14Editor`](https://github.com/TheShuEd/SS14Editor) is the **predecessor** — a separate, older editor kept only as a reference. Always qualify which one you mean.

## Conventions

- **Create an issue**: `mcp__github__issue_write` with `method: "create"`, plus `title`, `body`, `labels`.
- **Read an issue**: `mcp__github__issue_read`.
- **List issues**: `mcp__github__list_issues`, with `labels`, `state`, and `fields` filters. Pass `fields` to trim the response — omitting `body` drops the bulk of it.
- **Comment**: `mcp__github__issue_write` / `mcp__github__add_issue_comment`.
- **Apply labels / close**: `mcp__github__issue_write` with `method: "update"`, passing `labels` or `state`.

**Labels must already exist.** Unlike the REST API, the MCP server validates label names and refuses unknown ones rather than creating them on the fly. If a label is missing, ask the user to create it — you have no tool that can.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `crystallpunk-14/SS14Editor`.

## When a skill says "fetch the relevant ticket"

`mcp__github__issue_read` for the issue, plus its comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue whose **child** issues are its tickets.

- **Map**: one issue labelled `wayfinder:map`, holding the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body.
- **Child ticket**: create with `mcp__github__issue_write` passing **`parent_issue_number`** — this creates the issue and attaches it to the map in a single operation. To re-parent an existing issue, use `mcp__github__sub_issue_write` with `method: "add"`. Labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`.
- **Blocking**: **no MCP tool exposes GitHub's native issue dependencies.** Use the documented fallback — a `Blocked by: #<n>, #<n>` line as the **first line of the child's body**, above the `## Question` heading. A ticket is unblocked when every issue named there is closed. This is a body convention, so it is invisible to GitHub's UI: read the body, don't trust the sub-issue panel.
- **Frontier query**: list the map's open children, drop any whose `Blocked by:` line names an open issue, drop any with an assignee. First in creation order wins.
- **Claim**: `mcp__github__issue_write` with `method: "update"` and `assignees`, as the session's **first** write, before any work.
- **Resolve**: comment the answer, close the issue, then append a one-line gist plus link to the map's Decisions-so-far.

## Access notes

The repo is public and owned by the `crystallpunk-14` org. Reads succeed with any token because the repo is public; **writes need the token to have the repo in scope and `Issues: Read and write`**. A `403 Resource not accessible by personal access token` on a write means the token lacks that permission — not that the repo or issues are missing.
