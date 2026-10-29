// Standalone pipeline harness: renders one live widget into the current tmux pane as kitty placeholders and
// forwards SGR mouse input from the pane to the page. Run it in a VISIBLE pane (hidden windows drop passthrough):
//
//   tmux split-window -v -d -c "$PWD" 'npm run harness -- --control /tmp/piw-harness.sock'
//
// Options: --path <file.html> (default tests/fixtures/grid.html) | --html <markup>, --cols 90, --rows 18, --fps 10,
// --dpr 2, --cell 16x34 (device px; default from tmux), --control <unix socket>, --id-min/--id-max (test range).
// Keys: q or Ctrl+C quits. Control socket (HTTP): GET /stats, GET /hits, POST /hits/reset, POST /scale?cols=N
// (no cols = full size), POST /freeze, POST /thaw, POST /counters/reset, POST /quit.
// On exit the harness deletes every image id it used and closes its browser. No frame is written to disk.
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BrowserHost } from "../src/browser.js";
import { cssCellSize, detectEnvironment, tmuxCellSize, tmuxDisplay } from "../src/env.js";
import { type CellBox, fitCells, ImageIdAllocator, KittyImage } from "../src/kitty.js";
import { WidgetPage, type WidgetSource } from "../src/page.js";

/** Dedicated harness image-id range; every id used is deleted on exit. */
const HARNESS_ID_RANGE = { min: 0xa1d000, max: 0xa1dfff };
/** Pane row and column (1-based) of the grid's top-left cell; row 1 is the title line. */
const GRID_ORIGIN = { row: 2, col: 1 };

const { values: args } = parseArgs({
	options: {
		path: { type: "string" },
		html: { type: "string" },
		cols: { type: "string", default: "90" },
		rows: { type: "string", default: "18" },
		fps: { type: "string", default: "10" },
		dpr: { type: "string", default: "2" },
		cell: { type: "string" },
		control: { type: "string" },
		"id-min": { type: "string", default: String(HARNESS_ID_RANGE.min) },
		"id-max": { type: "string", default: String(HARNESS_ID_RANGE.max) },
	},
});

const out = process.stdout;
const env = detectEnvironment();
if (!out.isTTY || !process.stdin.isTTY) fail("the harness needs a terminal pane");
if (!env.supported) fail(`unsupported terminal (${env.kind}${env.clientTerm ? `, client ${env.clientTerm}` : ""})`);

const cols = Number(args.cols);
const rows = Number(args.rows);
const dpr = Number(args.dpr);
const fps = Number(args.fps);
const cell = parseCell(args.cell) ?? (env.tmux ? tmuxCellSize(tmuxDisplay()) : undefined) ?? fail("cell size unknown; pass --cell WxH");
const css = cssCellSize(cell, dpr);
const source: WidgetSource = args.html !== undefined ? { html: args.html } : { path: resolve(args.path ?? "tests/fixtures/grid.html") };

const ids = new ImageIdAllocator({ min: Number(args["id-min"]), max: Number(args["id-max"]) });
// Double-buffered like the extension (RQ04): a new frame goes to the spare id and the rows switch to it.
const image = new KittyImage([ids.next(), ids.next()], { tmux: env.tmux }, (d) => void out.write(d), { onSwitch: () => drawRows() });
let box: CellBox = { cols, rows, scale: 1 };
const stats = { frames: 0, sent: 0, skipped: 0, bytes: 0 };
let page: WidgetPage | undefined;
let host: BrowserHost | undefined;
let server: Server | undefined;
let quitting = false;
let failure: string | undefined;

function fail(msg: string): never {
	process.stderr.write(`harness: ${msg}\n`);
	process.exit(1);
}

function parseCell(s: string | undefined): { width: number; height: number } | undefined {
	const m = s ? /^(\d+)x(\d+)$/.exec(s) : null;
	return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

function draw(): void {
	const title = `harness i=0x${image.ids[0].toString(16)}/0x${image.ids[1].toString(16)} ${cols}x${rows} cells, shown ${box.cols}x${box.rows} (scale ${box.scale.toFixed(3)}), q quits`;
	out.write(`\x1b[H\x1b[2J\x1b[1m${title.slice(0, Math.max(0, (out.columns ?? 80) - 1))}\x1b[22m${rowsText()}`);
}

function rowsText(): string {
	let s = "";
	for (const [i, line] of image.lines(box.cols, box.rows).entries()) s += `\x1b[${GRID_ORIGIN.row + i};${GRID_ORIGIN.col}H${line}`;
	return s;
}

/** Rewrites only the placeholder rows (the double-buffer switch after a new frame). */
function drawRows(): void {
	out.write(rowsText());
}

function onFrame(data: string): void {
	stats.frames++;
	if (image.send(data, box.cols, box.rows)) {
		stats.sent++;
		stats.bytes += data.length;
	} else stats.skipped++;
}

// ---- input: SGR mouse from the pane to CSS pixels ----

let chain: Promise<unknown> = Promise.resolve();
let pressed = 0;
let pending = "";

function toCss(x: number, y: number): { x: number; y: number } | undefined {
	const gx = x - GRID_ORIGIN.col;
	const gy = y - GRID_ORIGIN.row;
	if (!pressed && (gx < 0 || gy < 0 || gx >= box.cols || gy >= box.rows)) return undefined;
	// The terminal fits the image into the cell box preserving aspect ratio and centers it vertically.
	const offY = (box.rows * css.height - rows * css.height * box.scale) / 2;
	const cx = ((gx + 0.5) * css.width) / box.scale;
	const cy = ((gy + 0.5) * css.height - offY) / box.scale;
	const clamp = (v: number, max: number): number => Math.min(max - 1, Math.max(0, v));
	return { x: clamp(cx, cols * css.width), y: clamp(cy, rows * css.height) };
}

function onMouse(b: number, x: number, y: number, release: boolean): void {
	const p = toCss(x, y);
	const w = page;
	if (!p || !w) return;
	const code = b & 3;
	const button = code === 0 ? "left" : code === 1 ? "middle" : code === 2 ? "right" : "none";
	const bit = code === 0 ? 1 : code === 1 ? 4 : code === 2 ? 2 : 0;
	let run: () => Promise<void>;
	if (b & 64) {
		const d = 40;
		const [dx, dy] = code === 0 ? [0, -d] : code === 1 ? [0, d] : code === 2 ? [-d, 0] : [d, 0];
		run = () => w.wheel({ x: p.x, y: p.y, deltaX: dx, deltaY: dy });
	} else if (b & 32) {
		run = () => w.mouse({ type: "mouseMoved", x: p.x, y: p.y, buttons: pressed });
	} else if (release) {
		pressed &= ~bit;
		const buttons = pressed;
		run = () => w.mouse({ type: "mouseReleased", x: p.x, y: p.y, button, buttons });
	} else {
		pressed |= bit;
		const buttons = pressed;
		run = () => w.mouse({ type: "mousePressed", x: p.x, y: p.y, button, buttons });
	}
	chain = chain.then(run).catch(() => {});
}

function onInput(chunk: Buffer): void {
	pending += chunk.toString("latin1");
	const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
	let consumed = 0;
	for (const m of pending.matchAll(re)) {
		const before = pending.slice(consumed, m.index);
		if (/[q\x03]/.test(before)) return void quit(0);
		onMouse(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === "m");
		consumed = (m.index ?? 0) + m[0].length;
	}
	const rest = pending.slice(consumed);
	if (/^[^\x1b]*[q\x03]/.test(rest)) return void quit(0);
	const esc = rest.lastIndexOf("\x1b");
	// Keep a trailing partial sequence; drop anything else.
	pending = esc >= 0 && /^\x1b(\[(<[\d;]*)?)?$/.test(rest.slice(esc)) ? rest.slice(esc) : "";
}

// ---- control socket ----

async function control(method: string, url: URL): Promise<unknown> {
	const w = page;
	if (!w) throw new Error("not ready");
	const route = `${method} ${url.pathname}`;
	switch (route) {
		case "GET /stats":
			return {
				pid: process.pid,
				browserPid: host?.pid,
				imageId: image.ids[0],
				imageIds: image.ids,
				env,
				cell,
				cssCell: css,
				cols,
				rows,
				box,
				origin: GRID_ORIGIN,
				state: w.closed ? "closed" : w.frozen ? "frozen" : "live",
				...stats,
				errors: w.errors,
			};
		case "GET /hits":
			return w.page.evaluate("window.__hits ?? null");
		case "POST /hits/reset":
			return w.page.evaluate("window.__hits = []");
		case "POST /counters/reset":
			Object.assign(stats, { frames: 0, sent: 0, skipped: 0, bytes: 0 });
			return stats;
		case "POST /scale": {
			const want = url.searchParams.get("cols");
			box = want ? fitCells(cols, rows, Number(want)) : { cols, rows, scale: 1 };
			image.resend(box.cols, box.rows);
			draw();
			return box;
		}
		case "POST /freeze":
			await w.freeze();
			return { state: "frozen" };
		case "POST /thaw":
			await w.thaw();
			return { state: "live" };
		case "POST /quit":
			setImmediate(() => void quit(0));
			return { quitting: true };
		default:
			throw new Error(`unknown route ${route}`);
	}
}

function listen(path: string): Promise<Server> {
	rmSync(path, { force: true });
	const s = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://harness");
		control(req.method ?? "GET", url).then(
			(body) => {
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(body ?? null));
			},
			(err: unknown) => {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
			},
		);
	});
	return new Promise((r) => s.listen(path, () => r(s)));
}

// ---- lifecycle ----

async function quit(code: number): Promise<void> {
	if (quitting) return;
	quitting = true;
	try {
		await page?.close();
		await host?.close();
	} catch {}
	try {
		for (const id of ids.allocated) new KittyImage(id, { tmux: env.tmux }, (d) => void out.write(d)).delete();
		out.write("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l");
	} catch {}
	if (failure) process.stderr.write(`harness: ${failure}\n`);
	server?.close();
	if (args.control) rmSync(args.control, { force: true });
	process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => void quit(0));

async function main(): Promise<void> {
	out.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
	process.stdin.setRawMode(true);
	process.stdin.on("data", onInput);
	draw();
	host = new BrowserHost({ dpr });
	page = await WidgetPage.open(host, {
		source,
		cssWidth: cols * css.width,
		cssHeight: rows * css.height,
		title: "harness",
		transparent: true,
		maxFps: fps,
		onFrame: (f) => onFrame(f.data),
	});
	if (args.control) server = await listen(args.control);
}

main().catch(async (err: unknown) => {
	failure = err instanceof Error ? err.message : String(err);
	await quit(1);
});
