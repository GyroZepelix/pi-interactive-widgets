// Model-facing text: the minimal show_widget description (RQ01), the always-on rubric (RQ02), and check_widget.
import { GUIDE_PATH } from "./guide.js";

/** Minimal tool description (RQ01); the full authoring guide lives in guide/widgets.md. */
export const DESCRIPTION = [
	"Render an interactive HTML widget inline in the user's terminal transcript (headless Chromium).",
	"Pass exactly one of `html` (a body fragment or full document; inline <style> and <script> work) or `path` (an .html entry file; its folder and subfolders are served).",
	"The page has a fixed viewport of `cols` x `rows` terminal cells (about 8x17 CSS px per cell) and no page scrolling.",
	"Use click-triggered UI instead of hover.",
	"Bridge: `window.pi.send(json)` queues data for the user's next message; `window.pi.submit(json)` from a click delivers it now.",
	"Network: scripts, styles, and fonts only from major CDNs; fetch only to the widget's own origin.",
	`Before your first widget in a session, read the guide: ${GUIDE_PATH}`,
].join(" ");

/** Always-on when-to-use rubric (RQ02), appended to the system prompt Guidelines while show_widget is active. */
export const GUIDELINES = [
	"show_widget: use a widget only when the user asks for one, or when (1) something is better seen than read (design: palettes, spacing, layout variants; data shapes: curves, distributions, breakdowns), (2) stepping through state or time helps (state machines, rebases, races, algorithms), or (3) the user asks to explain a concept with motion, growth, or spatial structure.",
	"show_widget: widgets are mainly visual displays. Ask decisions and questions in normal text or with ask_user_question (keyboard); collect input in a widget only when the choice is inherently visual (color picker, dragging visual items into order, picking a point or region).",
	"show_widget is not for approvals or choosing among options, and never for forms, code, commands, error explanations, or static architecture: use text, ask_user_question, or Mermaid/D2 instead.",
	"show_widget: read the widget guide (path in the tool description) before your first widget in a session. Use check_widget only on demand: when the user reports a visual problem or a result lists load errors, not after every render.",
];

export const CHECK_DESCRIPTION = [
	"Inspect a widget you rendered with show_widget, by the id it returned.",
	"Returns one PNG image (long edge at most 1000 px; a fresh capture of an open widget, the last still of a closed one) and a text report: state, viewport, JS errors and blocked requests since the last load, document scroll size versus viewport, and elements that overflow the viewport or are clipped by an overflow: hidden ancestor.",
	"Use it on demand, when the user reports a visual problem or show_widget listed load errors, not after every render.",
	"It never wakes, focuses, revives, or resizes the widget.",
].join(" ");

/** show_image description: sources, formats, size, and the local-address rule. */
export const IMAGE_DESCRIPTION = [
	"Show an existing image inline in the user's terminal transcript.",
	"`source` is a file path (relative to the working directory) or an http/https URL; PNG, JPEG, GIF (first frame), WebP, and SVG, at most 20 MB, detected from the content.",
	"The image keeps its aspect ratio, fits the terminal width, is at most `rows` cells tall (default 24), and is never enlarged beyond its natural size.",
	"URLs to localhost or private addresses are refused unless the user allowed the host in the extension config.",
	"The result reports the source, pixel size, and cells used; you do not see the image.",
].join(" ");

/** Always-on show_image guideline (one bullet). */
export const IMAGE_GUIDELINES = ["show_image: use show_image to show an existing image file or URL; do not build an `<img>` widget."];
