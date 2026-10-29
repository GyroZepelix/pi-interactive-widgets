// E2E harness: real Pi in a temporary visible tmux split of the attached client's current window, with isolated Pi
// state (temporary PI_CODING_AGENT_DIR, no session file), `PI_WIDGETS_DEV=1`, and the scripted faux model from
// ./probe-extension.ts. Page effects are read from the extension's dev log. The split is always closed afterwards.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capturePane, closeSplit, openSplit, sendLiteral, sgr, sleep, type Split, tmux, tmuxLines } from "../../scripts/perf/lib.js";
import { PLACEHOLDER } from "../../src/kitty.js";

export const ROOT = resolve(import.meta.dirname, "../..");
export { sleep };

export type DevEvent = { t: number; ev: string; id?: string; [k: string]: unknown };
export type Turn = { t: number; messages: { role: string; text: string; customType?: string; toolName?: string }[] };

export interface StartOptions {
	tuiMode?: "fullscreen" | "regular";
	/** Raw config file content (written to the isolated agent dir). */
	config?: string;
	env?: Record<string, string>;
	unsetEnv?: string[];
	/** Reuse an agent dir from an earlier session (resume tests); it is kept on close. */
	agentDir?: string;
	/** Save the session (no `--no-session`); with `continue` Pi continues the most recent one (`-c`). */
	persist?: boolean;
	continue?: boolean;
	/** Open Pi in a new detached window with this name (manual checks) instead of a split of the current window. */
	window?: string;
	/** Pane size to request (default 80x24). */
	cols?: number;
	rows?: number;
}

function descendants(root: number): number[] {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
		.trim()
		.split("\n")
		.map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
	const set = new Set([root]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [pid, ppid] of rows) if (!set.has(pid) && set.has(ppid)) set.add(pid), (grew = true);
	}
	return [...set];
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function chromePids(pids: Iterable<number>): number[] {
	const list = [...pids];
	if (!list.length) return [];
	let out = "";
	try {
		out = execFileSync("ps", ["-o", "pid=,command=", "-p", list.join(",")], { encoding: "utf8" });
	} catch {
		return [];
	}
	return out
		.trim()
		.split("\n")
		.filter((l) => /chrome-headless-shell/.test(l))
		.map((l) => Number(l.trim().split(/\s+/)[0]));
}

/** A new detached window in the attached client's session; it closes with its last pane. */
function openWindow(name: string, command: string): Split {
	const client = tmux("list-clients", "-F", "#{client_name}").split("\n")[0];
	if (!client) throw new Error("no attached tmux client");
	const session = tmux("display", "-p", "-c", client, "#{session_id}");
	const [pane, tty] = tmux("new-window", "-d", "-t", `${session}:`, "-n", name, "-c", ROOT, "-P", "-F", "#{pane_id} #{pane_tty}", command).split(" ") as [string, string];
	return { pane, tty };
}

const pause = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

export class PiSession {
	readonly split: Split;
	readonly agentDir: string;
	readonly devLogPath: string;
	readonly turnsPath: string;
	readonly panePid: number;
	/** Every process seen under the split (Pi, its children, the browser tree). */
	readonly seen = new Set<number>();

	private readonly keepAgentDir: boolean;

	private constructor(split: Split, agentDir: string, keepAgentDir: boolean) {
		this.split = split;
		this.agentDir = agentDir;
		this.keepAgentDir = keepAgentDir;
		this.devLogPath = join(agentDir, "dev.log");
		this.turnsPath = join(agentDir, "turns.log");
		this.panePid = Number(tmux("display", "-p", "-t", split.pane, "#{pane_pid}"));
		this.track();
	}

	static async start(opts: StartOptions = {}): Promise<PiSession> {
		const agentDir = opts.agentDir ?? mkdtempSync(join(tmpdir(), "piw-e2e-"));
		// The user's halfPage bindings (AC05 checks ctrl+u and ctrl+d while a widget is focused).
		writeFileSync(join(agentDir, "keybindings.json"), JSON.stringify({ "tui.altScreen.halfPageUp": "ctrl+u", "tui.altScreen.halfPageDown": "ctrl+d" }));
		if (opts.config !== undefined) {
			mkdirSync(join(agentDir, "extensions", "pi-interactive-widgets"), { recursive: true });
			writeFileSync(join(agentDir, "extensions", "pi-interactive-widgets", "config.json"), opts.config);
		}
		const env: Record<string, string> = {
			PI_WIDGETS_DEV: "1",
			PI_WIDGETS_DEV_LOG: join(agentDir, "dev.log"),
			PI_WIDGETS_E2E_TURNS: join(agentDir, "turns.log"),
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			...opts.env,
		};
		const session = opts.persist ? ["--session-dir", join(agentDir, "sessions"), ...(opts.continue ? ["-c"] : [])] : ["--no-session"];
		const args = ["-ne", "-ns", "-np", "-nc", ...session, "-e", "./src/index.ts", "-e", "./tests/e2e/probe-extension.ts", "--model", "e2e-faux/echo", "--tui-mode", opts.tuiMode ?? "fullscreen"];
		const cmd = `env ${(opts.unsetEnv ?? []).map((k) => `-u ${k} `).join("")}${Object.entries(env)
			.map(([k, v]) => `${k}=${q(v)}`)
			.join(" ")} pi ${args.join(" ")}; c=$?; [ $c -ne 0 ] && sleep 30`;
		const split = opts.window ? openWindow(opts.window, cmd) : openSplit(cmd, ROOT, { cols: opts.cols ?? 80, rows: opts.rows ?? 24 });
		const s = new PiSession(split, agentDir, opts.agentDir !== undefined);
		await s.waitEvent((e) => e.ev === "session_start", 20_000, "session_start");
		if (!(opts.unsetEnv ?? []).includes("TMUX")) await s.waitEvent((e) => e.ev === "tui", 10_000, "TUI capture");
		await sleep(500);
		return s;
	}

	track(): void {
		for (const p of descendants(this.panePid)) this.seen.add(p);
	}

	events(): DevEvent[] {
		if (!existsSync(this.devLogPath)) return [];
		return readFileSync(this.devLogPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as DevEvent);
	}

	turns(): Turn[] {
		if (!existsSync(this.turnsPath)) return [];
		return readFileSync(this.turnsPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Turn);
	}

	async waitEvent(pred: (e: DevEvent) => boolean, timeoutMs: number, what: string): Promise<DevEvent> {
		return this.waitFor(() => this.events().find(pred), timeoutMs, what);
	}

	async waitFor<T>(fn: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
		const end = Date.now() + timeoutMs;
		for (;;) {
			const v = fn();
			if (v !== undefined && v !== false) return v;
			if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n--- pane ---\n${this.capture()}\n--- dev log tail ---\n${this.events().slice(-8).map((e) => JSON.stringify(e).slice(0, 300)).join("\n")}`);
			await sleep(50);
		}
	}

	/** Visible pane text without placeholder diacritics. */
	capture(): string {
		return capturePane(this.split.pane).replace(/[\u0300-\u036f\u0483-\u0487\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u06d6-\u06ed\u0730-\u074a\u07eb-\u07f3\u0816-\u082d\u0951-\u0954\u0f82-\u0f87\u135d-\u135f\u17dd\u193a\u1a17\u1a75-\u1a7c\u1b6b-\u1b73\u1cd0-\u1ce0\u1dc0-\u1dff\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\ua66f-\ua67d\ua6f0\ua6f1\ua8e0-\ua8e5]/g, "");
	}

	/** Both double-buffer ids of a widget image (RQ04), from the dev log's `spareId` next to `imageId`. */
	imageIds(imageId: number): number[] {
		const spare = this.events().find((e) => Number(e.imageId) === imageId && e.spareId !== undefined)?.spareId;
		return spare === undefined ? [imageId] : [imageId, Number(spare)];
	}

	/** Pane position (0-based) of an image's placeholder grid, found by the color of either of its buffer ids. */
	locate(imageId: number): { row: number; col: number; rows: number } | undefined {
		let raw = "";
		try {
			raw = tmuxLines("capture-pane", "-p", "-e", "-t", this.split.pane);
		} catch {
			return undefined;
		}
		const rgb = (id: number): string => `${(id >> 16) & 255}[;:]${(id >> 8) & 255}[;:]${id & 255}`;
		const color = new RegExp(`38[;:]2[;:]+(?:${this.imageIds(imageId).map(rgb).join("|")})m`);
		let row = -1;
		let col = -1;
		let rows = 0;
		// tmux emits a color only where it changes, so continuation rows of the grid may carry no color of their own.
		const lines = raw.split("\n");
		const other = /38[;:]2[;:]/;
		let open = false;
		lines.forEach((line, i) => {
			const at = line.indexOf(PLACEHOLDER);
			const own = at >= 0 && color.test(line);
			const continued = open && at >= 0 && !other.test(line.slice(0, at + 1));
			if (own || continued) {
				if (row < 0) {
					row = i;
					col = [...line.slice(0, at).replace(/\x1b\[[0-9;:]*m/g, "")].length;
				}
				rows++;
				open = true;
			} else open = false;
		});
		return row < 0 ? undefined : { row, col, rows };
	}

	async waitLocate(imageId: number, rows: number): Promise<{ row: number; col: number; rows: number }> {
		return this.waitFor(() => {
			const g = this.locate(imageId);
			return g && g.rows === rows ? g : undefined;
		}, 5_000, `placeholder grid of image ${imageId}`);
	}

	/** Each input write is followed by a short pause so a lone Escape is not merged with the next sequence. */
	type(text: string): void {
		sendLiteral(this.split.pane, text);
		pause(60);
	}

	key(...names: string[]): void {
		tmux("send-keys", "-t", this.split.pane, ...names);
		pause(60);
	}

	async command(line: string): Promise<void> {
		this.type(line);
		await sleep(200);
		this.key("Enter");
	}

	/** SGR mouse at 0-based pane cell coordinates. */
	press(x: number, y: number): string {
		return sgr(0, x + 1, y + 1) + sgr(0, x + 1, y + 1, true);
	}

	/** PID of the Pi process (the node process running Pi's CLI) in this split. */
	piPid(): number | undefined {
		const pids = descendants(this.panePid).filter((p) => p !== this.panePid);
		if (!pids.length) return undefined;
		let out = "";
		try {
			out = execFileSync("ps", ["-o", "pid=,command=", "-p", pids.join(",")], { encoding: "utf8" });
		} catch {
			return undefined;
		}
		const line = out
			.trim()
			.split("\n")
			// Pi sets its process title to "pi"; the parent is the pane's shell.
			.find((l) => /^\s*\d+\s+(pi\b|node\b.*\bpi\b|.*cli\.js)/.test(l) && !/chrome-headless-shell/.test(l));
		return line ? Number(line.trim().split(/\s+/)[0]) : undefined;
	}

	/** Narrows this split by opening a dummy pane beside it (only panes this run started change size). */
	narrow(cols: number): Split {
		const width = Number(tmux("display", "-p", "-t", this.split.pane, "#{pane_width}"));
		const out = tmux("split-window", "-h", "-d", "-t", this.split.pane, "-l", String(Math.max(2, width - cols - 1)), "-P", "-F", "#{pane_id} #{pane_tty}", "sleep 3600");
		const [pane, tty] = out.split(" ") as [string, string];
		return { pane, tty };
	}

	/** Closes the split and returns every process it started that is still alive after 5 s. */
	async close(): Promise<number[]> {
		this.track();
		closeSplit(this.split);
		const end = Date.now() + 5_000;
		let left = [...this.seen].filter(alive);
		while (left.length && Date.now() < end) {
			await sleep(100);
			left = left.filter(alive);
		}
		if (!this.keepAgentDir) rmSync(this.agentDir, { recursive: true, force: true });
		return left;
	}
}

/** Pane cell at the center of target `i` of a 6x3 grid fixture laid over `cols` x `rows` cells. */
export function gridTarget(i: number, grid: { row: number; col: number }, cols: number, rows: number): { x: number; y: number } {
	return { x: grid.col + Math.floor(((i % 6) + 0.5) * (cols / 6)), y: grid.row + Math.floor((Math.floor(i / 6) + 0.5) * (rows / 3)) };
}
