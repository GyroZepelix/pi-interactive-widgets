# Backlog

Repository-wide register of open ideas that are not yet work items. Each entry is one `## B<n>: <short title>` section for one open idea, where `B<n>` is a per-repository ID that is never reused. Under the heading, list `Added: YYYY-MM-DD`, `Source:` (session, item, or repository), and an optional `Link:` to a parked item, handoff, or research note written relative to `spec/`, as bullets, then optional free-text notes. A listed entry means the idea is open; delete the entry when the idea is promoted to an item, done, merged, or dropped, because Git history and the archive keep the record. Entries are not current state and not instructions: act on one only after the user resumes or promotes it.

Entry shape:

```markdown
## B<n>: <short title>

- Added: YYYY-MM-DD
- Source: <session, item, or repository>
- Link: [<label>](./<relative path>)

Optional free-text notes about the idea.
```
