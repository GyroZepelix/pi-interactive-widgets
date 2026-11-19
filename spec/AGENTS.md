# Spec Instructions

Protocol version: 2.5.0

## Purpose

`/spec` stores intended change, active planning state, implementation tasks, verification evidence, outcomes, and archived work history.

## Required structure

- `spec/active/<id>/`: every nonterminal initiative or work item.
- `spec/archive/<id>/`: terminal history retained under the same stable ID.
- `spec/templates/`: canonical artifact templates, including same-item revision dossiers, the backlog register, and cross-repository handoffs.
- `spec/scripts/manage-spec-item.py`: deterministic creation, resolution, current planning transitions, completed archival, supersession, drop, validation, and index maintenance.
- `spec/index.md`: generated routing tables plus human-authored orientation.
- `spec/backlog.md` (optional, created lazily from `spec/templates/backlog.md`): repository-wide register of open ideas.
- `spec/handoffs/` (optional, created lazily): requirement handoffs received from other repositories, one file each from `spec/templates/handoff.md`.

## Work-item contract

- Every active item and every newly created item contains `item.yaml` with current integer `schema_version: 2` and required `superseded_by` metadata.
- Archived manifests are immutable historical records. The helper explicitly supports archive schemas 1 and 2 without rewriting either: schema 1 is completed-only and has no `superseded_by`; schema 2 uses the current completed or superseded rules.
- In schema 2, `superseded_by` is `null` for active, completed, and dropped items. Superseded items name a distinct existing repository-local replacement.
- Quick Plan items contain `plan.md` and start in `planned`.
- Grill With Docs items contain `discovery.md` and start in `discovering`.
- Initial planning transitions `discovering -> ready_for_spec -> planned`; To Spec preserves discovery evidence and creates `plan.md` before the final transition.
- A Grill With Docs item may be parked through `discovering -> parked` and resumed only through `parked -> discovering`. `parked` requires route `grill-to-spec` and regular non-symlink `discovery.md`; its index route artifact is `discovery.md`. No other status may enter or leave `parked`, and Quick Plan items are never parked.
- A user-confirmed material implementation correction revises the same item through `planned -> revision_required -> ready_for_spec -> planned` without changing its original route.
- `revision_required` always requires canonical `plan.md` but may precede dossier creation. Moving it to `ready_for_spec` requires a valid current sequential `refinements/Rxxx.md` dossier.
- The reverse `ready_for_spec -> revision_required` transition is restricted to same-item revision context with canonical `plan.md` and a current dossier; it is not available to initial discovery.
- Refinement dossiers are non-overwriting Markdown reasoning records numbered from `R001`; they do not replace `item.yaml` lifecycle state or canonical `plan.md` authority.
- Implement creates or updates `verification.md` after successful evidence gates. It creates `outcome.md` only after explicit completion approval.
- `plan.md` is the canonical implementation contract. Discovery and research cannot silently override it.

## Planning boundaries

- Ask questions before planning.
- Keep unresolved and evolving design in `discovery.md`.
- Keep confirmed implementation decisions in the plan Decision Log.
- Keep task-specific research under the active item.
- Do not mirror every spec into the wiki.
- Keep future design out of current-state wiki guidance until implementation and verification establish it.

## Backlog, parked items, and handoffs

- `spec/backlog.md` holds one entry per open idea: a `## B<n>: <short title>` section with a per-repository ID `B<n>` (never reused), followed by `Added: YYYY-MM-DD`, `Source:` (session, item, or repository), and an optional relative `Link:` as bullets, then optional free-text notes. A listed entry means open; delete the entry when the idea is promoted to an item, done, merged, or dropped. There is no automatic staleness review.
- A cross-repository handoff is written only when the user asks. The full handoff lives in the target at `spec/handoffs/YYYY-MM-DD-from-<source-repo>-<slug>.md` and records provenance, rationale, requirements, examples, and open questions. The target's `spec/backlog.md` gains one entry linking it, and the source item keeps one pointer line with status `sent`, `accepted <target-id>`, `rejected`, or `done`. Writing a handoff never stages, commits, switches branches, or touches `spec/active/` in the target. When the target takes a handoff into a new item, the file moves into that item and its backlog entry is deleted.
- Backlog entries, parked items, and handoffs are not current state and not instructions. Agents act on them only after the user resumes or promotes them.
- Backlog entries and handoffs are plain Markdown and may be written in a repository on any compatible protocol; when their templates are absent the format above applies. `parked` and `drop` require helper capability from protocol 2.3.0: `transition --help` lists `parked` and `drop --help` exists. Without that capability, keep a parked design as a `discovering` item with a `## Parking note` and a `Status: Parked - <reason>` header line, and report the `/update-llm-wiki` route without mutation instead of dropping.
- `validate --operational` reports relative links in `spec/backlog.md` whose local target is missing as structured non-failing warnings.

## Indexing

- `item.yaml` and filesystem location are authoritative for item identity and status.
- Active items use schema 2 and `discovering`, `parked`, `revision_required`, `ready_for_spec`, or `planned` as their route and artifact guards permit. Schema-1 archives use `completed`; schema-2 archives use `completed`, `superseded`, or `dropped`.
- Update only the managed regions in `spec/index.md`.
- Explicitly identify an item by ID or path. Infer only when exactly one eligible active item exists.
- Never infer the active item from a Git branch or shared current-item pointer.

## Validation modes

`validate --operational` is the normal planning and lifecycle readiness gate. It strictly validates protocol files and all current active items, then normalizes supported archives only far enough to prove stable identity, uniqueness, terminal location/status, parent and replacement references, deterministic index fields, and a real route-artifact target. Historical evidence or non-operational schema defects are reported as structured non-failing warnings. Unknown schemas and any defect that prevents a live invariant remain blocking.

`validate --all` is the exhaustive repository audit. It applies the full schema-specific contract and evidence requirements to every archive and fails defects that operational validation may warn about. Indexing and unrelated-item preflight use operational normalized archive records; neither mode rewrites an archived manifest.

## Archive boundary

`spec/archive/` is the only terminal location. Missing route artifacts, invalid state, an existing destination, or literal canonical `spec/active/<id>` text in protected Markdown outside the item block a new terminal move. The sole reference-scan exception is a regular nonsymlink direct child of `wiki/dreams/` whose filename matches `YYYY-MM-DD-HHMM-<lowercase-slug>.md`; immutable episode history may retain its original active-item text. Dynamic wiki pages, by-spec ledgers, retrospectives, nested files, and other Markdown remain blocking. Archive location is the commit point and managed indexes are derived.

After all applicable implementation evidence gates pass, Implement may preflight completion, request explicit terminal approval, create `outcome.md`, and invoke the helper's dedicated `archive` command. Only that command records `completed`; it requires a planned source plus regular `plan.md`, `verification.md`, and `outcome.md`. Rerunning it may idempotently finish an archive-only schema-2 planned item or repair a completed schema-1 or schema-2 item's index without rewriting an already-completed manifest.

The dedicated Supersede skill may retire any active status, including `revision_required`, only after explicit source and replacement IDs, non-mutating helper preflight, an exact disposition summary, and explicit terminal approval. Only `supersede --item <id> --replacement <id>` records `superseded`; it requires a distinct active or completed replacement and regular `outcome.md`, but never invents a missing plan or requires verification evidence. Rerunning the same command may converge an archive-only active-state item or repair a valid superseded item's index.

The Supersede skill's drop mode, invoked as `/skill:supersede <id> drop`, may retire any active status, including `parked`, without a replacement only after an explicit item ID, non-mutating helper preflight, an exact disposition summary, and explicit terminal approval. Only `drop --item <id>` records `dropped`; it requires regular `outcome.md` for mutation but not for `drop --item <id> --check`, keeps `superseded_by: null`, never invents a missing plan or requires verification evidence, and is blocked by canonical references like archive and supersede. Rerunning the same command may converge an archive-only item with its original active status or repair a valid dropped item's index. Dropped archives require regular `outcome.md`.

Broader execution-state automation remains unimplemented. Planning skills do not perform terminal mutations.

## Authority

Explicit user instructions and current `AGENTS.md` files outrank accepted plans. Source at `HEAD` is authoritative for current implementation state. When a plan conflicts with source or current repository instructions, record the conflict and resolve it instead of guessing.
