# Research: CDP drag input and tmux output discards

Verified 2026-11-12 during planning of `261112-2105-widget-drag-input-and-blank-image-after-click-fix`. Load when changing widget mouse input or diagnosing missing kitty images under tmux.

## CDP drags need the held button on mouseMoved

- `Input.dispatchMouseEvent` with `type: "mouseMoved"`, `buttons: 1`, and `button: "none"` does not drag a range input: a press at the start, moves to x=200, and a release left the value at 0. The same sequence with `button: "left"` on each move set it to 50.
- Evidence: throwaway probe (outside the repository) using `BrowserHost` and `WidgetPage` from `src/browser.ts` and `src/page.ts` at commit `757ef52`, with a 400 px `<input type=range>`. At that commit `WidgetPage.mouse` defaults `button` to `"none"` for `mouseMoved`, and `WidgetComponent.handleMouse` sends drags without `button`.

## tmux drops client output when a client cannot keep up

- When a client's pending output reaches `TTY_BLOCK_START` (about `columns * rows * 8` bytes), tmux discards the buffered output and blocks that client (`tty_block_maybe` in `tty.c`). While it is blocked, `tty_add` discards all further output, passthrough included, and the screen text is redrawn later from tmux's grid. Kitty images sent through passthrough in that window are lost for good, while their placeholder text comes back.
- A buffer that holds pending passthrough output (`TTY_NOBLOCK`, set by `tty_cmd_rawstring`) is not drained until it has emptied once. A block therefore starts from large non-passthrough output such as screen redraws.
- Check whether it happened: `tmux list-clients -F '#{client_name} #{client_termname} discarded=#{client_discarded}'`. The count is cumulative per client. On 2026-11-12 the user's Ghostty client showed 0, and a stale second `xterm-256color` client on the same session showed 71919.
- Source: [tmux tty.c (master)](https://raw.githubusercontent.com/tmux/tmux/master/tty.c). The installed tmux is 3.8, and this code was read from master, not from the 3.8 tag.

Follow-up (T03, same day): the blank image was not caused by these discards. The confirmed cause is a different tmux 3.8 path: with `allow-passthrough on`, passthrough is dropped while a pane or window redraw is pending. It is not counted in `client_discarded`. See [Terminal graphics under tmux](../terminal-graphics-tmux.md).

## Pi 1.5.2 under tmux (unchanged from 1.4.0 for this extension)

- `detectCapabilitiesFromEnvironment` in `pi-tui/dist/terminal-image.js` still returns `images: null` when `TMUX` is set, so Pi's own kitty deletes (`deleteAllKittyPlacements` and others in `tui-alt-screen.js`) are not active under tmux.
- `TuiAltScreen` still enables button-motion mouse tracking under tmux, Zellij, and screen. A press followed by motion with a button held reaches components as `drag` and goes to the target that captured the press.
- Evidence: global install `~/.bun/install/global/node_modules/@earendil-works/pi-tui` version 1.5.2. Compared with the repository's 1.4.0 devDependency, `tui-alt-screen.js` changes only word-selection joiners, viewport-input deferral, and kitty draw ordering, and `tui.js` changes only cursor-marker stripping.
