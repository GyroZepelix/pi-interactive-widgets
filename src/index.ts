// Pi entry: `show_widget` tool and renderer, `/widgets-refresh`, `/widget-dev` (dev only), session events, and config.
import { resolve } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { BrowserMissingError } from "./browser.js";
import { noticeLine, type RowDetails, WidgetComponent } from "./component.js";
import { configPath, DEFAULT_CONFIG, EXTENSION_NAME, loadConfig } from "./config.js";
import { detectEnvironment, pointerMotionReported } from "./env.js";
import { devLog, type SessionState, timersFromEnv, type Widget, WidgetManager } from "./manager.js";
import type { WidgetSource } from "./page.js";

const TOOL = "show_widget";
const DEV_ENTRY = "pi-interactive-widgets-dev";
const PROBE = "pi-interactive-widgets-probe";

const DESCRIPTION = [
	"Render an interactive HTML widget inline in the user's terminal transcript (real headless Chromium, streamed as terminal graphics).",
	"Pass exactly one of `html` (a body fragment or a full document; inline <style> and <script> work) or `path` (an .html entry file; files in its folder and subfolders are served, nothing outside).",
	"For widgets you will edit and re-show, write them to a scratch folder such as ./.pi-widgets/<name>/index.html and pass `path`.",
	"Each call renders a new widget instance. Size: `cols` x `rows` terminal cells (default min(100, terminal width - 4) x 20, at most 256 each); the result reports the CSS viewport.",
	"Layout: design for that fixed viewport without page scrolling; give growing areas (logs, lists) `min-height: 0` and `overflow: auto` or `hidden` so new content never resizes other elements; size <canvas> backing stores with a ResizeObserver. Dark background; Pi theme colors are available as CSS variables (--pi-accent, --pi-muted, --pi-border, --pi-success, --pi-error, --pi-warning).",
	"Input is cell-precise (about 8x17 CSS px per cell), so make click targets at least about 24 px. Use click-triggered UI instead of hover effects: under tmux the page sees pointer moves only while a button is held, so :hover styles and hover tooltips do not track the pointer. In-page <select> works; avoid native pickers (input type=date, time, color, month, week) and build custom controls instead.",
	"Bridge: in page JS, `window.pi.send(json)` queues data that reaches you with the user's next message after they release the widget; `window.pi.submit(json)` delivers immediately and starts your turn, but only from a user gesture (for example a click handler). Data is JSON-serializable and capped at 64 KB per call.",
	"Network: scripts, styles, and fonts load only from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh, fonts.googleapis.com, and fonts.gstatic.com; fetch, XHR, and WebSocket go only to the widget's own origin (the user can allow more hosts in config). Images from the page itself, data:, and blob:. No WebRTC, popups, form submissions, or navigation away. Blocked requests and JS errors from the initial load are listed in the result.",
	"The user interacts in Pi fullscreen mode: a click wakes and focuses the widget (hover also wakes it outside tmux); Escape or a click elsewhere releases it, and an idle widget pauses on its last frame. In regular mode they see a still image.",
	"Lifecycle: at most 5 widget pages stay open, and a page paused for 30 minutes closes; a closed widget, or one from a resumed session, reopens on click with fresh JS state (inline HTML from this call, path widgets from the current file). Do not rely on page state surviving; send what matters through the bridge.",
].join(" ");

export default function interactiveWidgets(pi: ExtensionAPI): void {
	const state: SessionState = { pi, env: detectEnvironment(), config: DEFAULT_CONFIG, motion: pointerMotionReported(), timers: timersFromEnv() };
	const manager = new WidgetManager(state);
	const dev = process.env.PI_WIDGETS_DEV === "1";
	const entryComponents = new Map<string, WidgetComponent>();

	const interactive = (ctx: ExtensionContext): boolean => ctx.mode === "tui" && ctx.hasUI;

	function unsupportedText(): string {
		const env = state.env;
		return `Widgets are unavailable in this terminal (${env.kind}${env.clientTerm ? `, tmux client ${env.clientTerm}` : ""}): they need tmux with Ghostty (or kitty) as the client terminal, or plain Ghostty. Nothing was rendered; the user sees "${noticeLine("<title>").replace(" <title>", "")}".`;
	}

	function summary(w: Widget): string {
		const d = w.details;
		const lines = [
			`Widget ${d.id} is shown inline: ${d.cols}x${d.rows} cells, CSS viewport ${d.cssWidth}x${d.cssHeight} px (${d.cssCell.width}x${d.cssCell.height} CSS px per cell, device pixel ratio ${state.config.dpr}).`,
		];
		const blocked = w.page?.blocked ?? [];
		lines.push(blocked.length ? `Blocked during load:\n${blocked.map((b) => `- ${b.url} (${b.reason})`).join("\n")}` : "Blocked during load: none.");
		const errors = w.page?.errors ?? [];
		lines.push(errors.length ? `JS errors during load:\n${errors.map((e) => `- ${e}`).join("\n")}` : "JS errors during load: none.");
		lines.push(
			manager.fullscreen
				? `The user can ${state.motion ? "hover or click" : "click"} it in the transcript; Escape releases it. pi.send data arrives with their next message.`
				: "Pi is in regular TUI mode: the user sees a still image and needs fullscreen mode (/settings, TUI mode) to interact.",
		);
		return lines.join("\n");
	}

	function notifyFailure(ctx: ExtensionContext, err: unknown): string {
		const message = err instanceof Error ? err.message : String(err);
		if (err instanceof BrowserMissingError) ctx.ui.notify(`${EXTENSION_NAME}: ${message}`, "error");
		devLog({ ev: "create-failed", message });
		return message;
	}

	pi.registerTool({
		name: TOOL,
		label: "Widget",
		description: DESCRIPTION,
		promptSnippet: "show_widget: render an interactive HTML widget inline in the terminal transcript",
		parameters: Type.Object({
			html: Type.Optional(Type.String({ description: "HTML body fragment or full document (inline <style> and <script> allowed)" })),
			path: Type.Optional(Type.String({ description: "Path to an .html entry file; its folder and subfolders are served" })),
			title: Type.Optional(Type.String({ description: "Short widget title" })),
			cols: Type.Optional(Type.Integer({ minimum: 1, maximum: 256, description: "Width in terminal cells (default min(100, terminal width - 4))" })),
			rows: Type.Optional(Type.Integer({ minimum: 1, maximum: 256, description: "Height in terminal cells (default 20)" })),
		}),
		renderShell: "self",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state.ctx = ctx;
			const hasHtml = typeof params.html === "string" && params.html.length > 0;
			const hasPath = typeof params.path === "string" && params.path.length > 0;
			if (hasHtml === hasPath) throw new Error("show_widget needs exactly one of `html` or `path`.");
			let source: WidgetSource;
			if (hasPath) {
				const path = resolve(ctx.cwd, params.path as string);
				if (!/\.html?$/i.test(path)) throw new Error(`path must be an .html entry file: ${path}`);
				source = { path };
			} else source = { html: params.html as string };
			const title = params.title?.trim() || (hasPath ? (params.path as string) : "widget");
			if (!interactive(ctx)) {
				return { content: [{ type: "text", text: "show_widget needs Pi's interactive terminal UI; nothing was rendered." }], details: { notice: "[widgets need the interactive terminal UI]", title } satisfies RowDetails };
			}
			if (!state.env.supported) {
				return { content: [{ type: "text", text: unsupportedText() }], details: { notice: noticeLine(title), title } satisfies RowDetails };
			}
			let w: Widget;
			try {
				w = await manager.create({ source, title, cols: params.cols, rows: params.rows });
			} catch (err) {
				throw new Error(notifyFailure(ctx, err));
			}
			return { content: [{ type: "text", text: summary(w) }], details: w.details satisfies RowDetails };
		},
		renderCall(args, theme, context) {
			const title = typeof args.title === "string" && args.title ? args.title : "widget";
			const shared = context.state as { done?: boolean };
			return {
				render: (width: number) => (shared.done ? [] : [truncateToWidth(theme.fg("dim", `◆ ${title} · rendering widget...`), width)]),
				invalidate() {},
			};
		},
		renderResult(result, options, theme, context) {
			const shared = context.state as { done?: boolean };
			const details = result.details as RowDetails | undefined;
			if (options.isPartial) return textComponent([]);
			shared.done = true;
			if (!details || !("title" in details)) {
				const text = result.content.find((c) => c.type === "text");
				return textComponent([theme.fg("error", `◆ widget failed: ${text && "text" in text ? text.text : "unknown error"}`)]);
			}
			const last = context.lastComponent;
			if (last instanceof WidgetComponent && sameRow(last.details, details)) return last;
			return new WidgetComponent(details, theme, manager, reviveSource(details, context.args));
		},
	});

	pi.registerCommand("widgets-refresh", {
		description: "Re-send every widget image (after a tmux reattach or when images went blank)",
		handler: async (_args, ctx) => {
			const ids = manager.resendAll("command");
			state.tui?.requestRender();
			if (ctx.hasUI) ctx.ui.notify(`${EXTENSION_NAME}: re-sent ${ids.length} widget image${ids.length === 1 ? "" : "s"}`, "info");
		},
	});

	if (dev) {
		pi.registerCommand("widget-dev", {
			description: "Dev only: render an .html file through the widget pipeline: /widget-dev <file.html> [cols rows]",
			handler: async (args, ctx) => {
				state.ctx = ctx;
				const [file, cols, rows] = args.trim().split(/\s+/);
				if (!file) return ctx.ui.notify("usage: /widget-dev <file.html> [cols rows]", "warning");
				const path = resolve(ctx.cwd, file);
				const title = file;
				if (!state.env.supported) {
					pi.appendEntry<RowDetails>(DEV_ENTRY, { notice: noticeLine(title), title });
					devLog({ ev: "unsupported", text: unsupportedText() });
					return;
				}
				try {
					const w = await manager.create({ source: { path }, title, cols: cols ? Number(cols) : undefined, rows: rows ? Number(rows) : undefined });
					pi.appendEntry<RowDetails>(DEV_ENTRY, w.details);
				} catch (err) {
					const message = notifyFailure(ctx, err);
					if (!(err instanceof BrowserMissingError)) ctx.ui.notify(`${EXTENSION_NAME}: ${message}`, "error");
				}
			},
		});
		pi.registerEntryRenderer<RowDetails>(DEV_ENTRY, (entry, _options, theme) => {
			const d = entry.data;
			if (!d) return undefined;
			const key = "id" in d ? d.id : `notice:${entry.id}`;
			let c = entryComponents.get(key);
			if (!c || !sameRow(c.details, d)) entryComponents.set(key, (c = new WidgetComponent(d, theme, manager)));
			return c;
		});
	}

	pi.on("session_start", async (event, ctx) => {
		state.ctx = ctx;
		state.env = detectEnvironment();
		state.motion = pointerMotionReported();
		state.timers = timersFromEnv();
		const loaded = await loadConfig(configPath(getAgentDir()));
		state.config = loaded.config;
		if (!loaded.ok) {
			devLog({ ev: "config-invalid", reason: loaded.reason });
			if (ctx.hasUI) ctx.ui.notify(`${EXTENSION_NAME}: ${loaded.reason}; using defaults`, "warning");
		}
		devLog({ ev: "session_start", reason: event.reason, env: state.env, motion: state.motion, config: state.config, timers: state.timers });
		if (!interactive(ctx)) return;
		// The TUI (focus, mode, renders) is only reachable through UI factories; capture it with a transient widget.
		ctx.ui.setWidget(PROBE, (tui) => {
			state.tui = tui;
			devLog({ ev: "tui", mode: tui.mode });
			setTimeout(() => ctx.ui.setWidget(PROBE, undefined), 0);
			return { render: () => [], invalidate() {} };
		});
	});

	// Shutdown, reload, and session switches release pages, timers, and the browser (RQ17).
	pi.on("session_shutdown", async (event) => {
		devLog({ ev: "session_shutdown", reason: event.reason });
		entryComponents.clear();
		await manager.shutdown();
	});
}

function textComponent(lines: string[]): Component {
	return { render: (width: number) => lines.map((l) => truncateToWidth(l, width)), invalidate() {} };
}

/** Revive source of a tool row: inline HTML from the persisted tool arguments, or the resolved entry file. */
function reviveSource(details: RowDetails, args: unknown): WidgetSource | undefined {
	if (!("id" in details)) return undefined;
	if (details.source === "path") return details.path ? { path: details.path } : undefined;
	const html = (args as { html?: unknown } | undefined)?.html;
	return typeof html === "string" && html ? { html } : undefined;
}

function sameRow(a: RowDetails, b: RowDetails): boolean {
	return "id" in a && "id" in b ? a.id === b.id : a === b;
}
