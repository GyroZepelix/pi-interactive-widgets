# Manual eval: widget usage (AC07)

One real-model run that checks whether the agent uses `show_widget` only when it helps, reads the widget guide, asks decisions through text or `ask_user_question`, and uses `check_widget` when you report a visual problem. Pass: at least 12 of 14 prompts correct, with every miss recorded.

## Setup

1. Use tmux with Ghostty as the client terminal (the supported setup). chrome-headless-shell must be installed (see README).
2. Start Pi with this extension in a fresh session, from an empty scratch folder so no project files or project instructions influence the agent:

   ```sh
   mkdir -p /tmp/piw-eval && cd /tmp/piw-eval
   pi -e /Users/dgjalic/Documents/1-Projects/10-software-development/50-pi-extensions/pi-interactive-widgets/src/index.ts
   ```

   If this package is also installed globally (`pi install`), remove it first so the extension is not loaded twice.
3. Use your normal real model and your usual extensions (`ask_user_question` must be available). Switch Pi to fullscreen mode if it is not already (`/settings`, TUI mode).
4. Paste the prompts below one at a time, in order, in the same session. Wait for each answer to finish. When the agent asks you something, answer briefly (any reasonable answer) and then continue with the next prompt.
5. For each prompt, note whether the agent behaved as expected. A widget is visible as an image in the transcript; a guide read shows as a `read` call on `.../guide/widgets.md`.

## Prompts and expected behavior

### P01 (no widget: approval)

```text
I want you to delete every *.log file in this folder. Get my approval before you do anything.
```

Expected: asks for approval in text or with `ask_user_question`. No widget.

### P02 (widget: design variants)

```text
Show me three spacing scales for a settings sidebar side by side: tight, normal, and airy.
```

Expected: renders a widget with the three variants. The guide (`guide/widgets.md`) is read before this first widget or right after it (before any further widget).

### P03 (no widget: pick one of three)

```text
For a small single-user CLI tool, should local storage be Postgres, SQLite, or DynamoDB? Let me decide.
```

Expected: short comparison in text, then the choice through `ask_user_question` or a plain text question. No widget.

### P04 (widget: data shape)

```text
What does a log-normal latency distribution with a median of 120 ms and a p99 of 900 ms look like, compared with a normal distribution with the same median?
```

Expected: renders a chart widget comparing the two curves.

### P05 (no widget: error explanation)

```text
Why do I get "TypeError: Cannot read properties of undefined (reading 'map')" in a React component, and how do I fix it?
```

Expected: explanation in text with a code example. No widget.

### P06 (widget: stepping through state)

```text
Walk me through what an interactive rebase does to a branch with four commits when I squash the middle two. Step by step.
```

Expected: renders a widget that steps through the commit graph (for example Next and Back buttons).

### P07 (no widget: code)

```text
Write a TypeScript debounce function with proper types.
```

Expected: a code block. No widget.

### P08 (widget: concept with motion)

```text
Explain how consistent hashing moves keys when a new node joins the ring.
```

Expected: renders an animated or steppable ring widget, with a short text explanation.

### P09 (no widget: command)

```text
What is the command to list the 10 largest files under the current directory?
```

Expected: a command in a code block. No widget.

### P10 (widget: show, then ask)

```text
I can't decide between a card layout and a table layout for showing six project stats. Show me both, then let me choose.
```

Expected: renders one widget with both layouts (labeled, without choice buttons in the widget), then asks which one through `ask_user_question` (or a plain text question).

### P11 (no widget: static architecture)

```text
Draw the architecture of a web app with a load balancer, two app servers, Redis, and Postgres.
```

Expected: a Mermaid or D2 diagram or a text diagram. No widget.

### P12 (widget: inherently visual input)

```text
Let me pick an accent color for my terminal theme visually, then tell me which color I picked.
```

Expected: renders a color-picking widget; after you pick a color (click it in fullscreen mode), the agent names the picked color. A widget here is correct because the choice is visual.

### P13 (check_widget: user reports a problem)

```text
In the spacing-scale widget from earlier, the airy column looks cut off on the right. Can you check it?
```

Expected: calls `check_widget` with the id of the P02 widget (not a blind re-render first), reports what the report and image show, and acts on it: fixes and re-shows the widget if there is a problem, or says it found none and asks what you see.

### P14 (check_widget: user reports a problem)

```text
The latency chart widget looks empty to me. What is wrong with it?
```

Expected: calls `check_widget` with the id of the P04 widget, reports the findings (JS errors, blocked requests, layout), and fixes and re-shows the widget if needed.

## Reporting results

Reply with one line per prompt plus two summary lines, for example:

```text
P01 ok
P02 ok (guide read before the widget)
P03 miss: rendered a widget with three buttons
...
P14 ok
guide: read before first widget | read right after first widget | never
guide reads: 1 (or the number of times the agent read guide/widgets.md)
```

Use `ok` when the behavior matches the expectation and `miss: <what happened>` otherwise. Add anything else you noticed (broken widgets, slow renders) at the end.
