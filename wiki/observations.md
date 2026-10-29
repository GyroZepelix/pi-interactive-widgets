# Observations

Tentative repository-local findings retained for later comparison. This page is used by Dream and memory maintenance, not normal task context.

## Manual visual checks

- **Give user visual checks a dedicated tmux window and pin the pane size** - May matter when asking the user to confirm widget rendering because their window size and pane layout change between question and answer, and temporary `sleep N` panes expire; create a new window with only test panes, set the width with `tmux resize-pane -x`, and confirm width and visibility from the dev log before relying on the answer. Provenance: [02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md).
