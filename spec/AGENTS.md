# Spec Instructions

Protocol version: 2.2.1

## Purpose

`/spec` stores intended change, active planning state, implementation tasks, verification evidence, outcomes, and archived work history.

## Required structure

- `spec/active/<id>/`: every nonterminal initiative or work item.
- `spec/archive/<id>/`: terminal history retained under the same stable ID.
- `spec/templates/`: canonical artifact templates, including same-item revision dossiers.
- `spec/scripts/manage-spec-item.py`: deterministic creation, resolution, current planning transitions, completed archival, supersession, validation, and index maintenance.
- `spec/index.md`: generated routing tables plus human-authored orientation.

## Work-item contract

- Every active item and every newly created item contains `item.yaml` with current integer `schema_version: 2` and required `superseded_by` metadata.
- Archived manifests are immutable historical records. The helper explicitly supports archive schemas 1 and 2 without rewriting either: schema 1 is completed-only and has no `superseded_by`; schema 2 uses the current completed or superseded rules.
- In schema 2, `superseded_by` is `null` for active and completed items. Superseded items name a distinct existing repository-local replacement.
- Quick Plan items contain `plan.md` and start in `planned`.
- Grill With Docs items contain `discovery.md` and start in `discovering`.
- Initial planning transitions `discovering -> ready_for_spec -> planned`; To Spec preserves discovery evidence and creates `plan.md` before the final transition.
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

## Indexing

- `item.yaml` and filesystem location are authoritative for item identity and status.
- Active items use schema 2 and `discovering`, `revision_required`, `ready_for_spec`, or `planned` as their route and artifact guards permit. Schema-1 archives use `completed`; schema-2 archives use `completed` or `superseded`.
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

Cancellation and broader execution-state automation remain unimplemented. Planning skills do not perform terminal mutations.

## Authority

Explicit user instructions and current `AGENTS.md` files outrank accepted plans. Source at `HEAD` is authoritative for current implementation state. When a plan conflicts with source or current repository instructions, record the conflict and resolve it instead of guessing.
