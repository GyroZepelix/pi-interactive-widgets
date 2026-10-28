// Harness acceptance and perf runner for slice 01.02. Opens the harness in a temporary visible split of the attached
// tmux client's current window, drives it, samples CPU with `ps`, and closes the split afterwards.
//
//   npm run perf                 # input, idle (AC01), and active (AC02)
//   npm run perf -- input idle   # selected phases
//
// Prints one JSON summary; exits 1 when an acceptance check fails. No frame is written to disk.
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	call,
	capturePane,
	closeSplit,
	median,
	openSplit,
	type Proc,
	round,
	sampleCpu,
	sendLiteral,
	type Split,
	sgr,
	sleep,
	snapshot,
	tmux,
	tree,
	waitFor,
} from "./lib.js";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURE = (name: string): string => join(ROOT, "tests", "fixtures", name);
const COLS = 90;
/** Every browser-tree PID seen by this run; all must be gone at the end. */
const startedPids = new Set<number>();
const ROWS = 18;

interface Stats {
	pid: number;
	browserPid?: number;
	imageId: number;
	cssCell: { width: number; height: number };
	cols: number;
	rows: number;
	origin: { row: number; col: number };
	state: string;
	frames: number;
	sent: number;
	skipped: number;
	bytes: number;
	errors: string[];
}

interface Harness {
	split: Split;
	sock: string;
	stats: Stats;
	get<T>(path: string): Promise<T>;
	post<T>(path: string): Promise<T>;
}

async function withHarness<T>(fixture: string, fn: (h: Harness) => Promise<T>): Promise<T> {
	const sock = join(tmpdir(), `piw-harness-${process.pid}-${Date.now()}.sock`);
	const cmd = `node --import tsx scripts/harness.ts --path '${fixture}' --cols ${COLS} --rows ${ROWS} --control '${sock}'; c=$?; [ $c -ne 0 ] && sleep 30`;
	const split = openSplit(cmd, ROOT, { cols: COLS + 1, rows: ROWS + 2 });
	let imageId: number | undefined;
	try {
		const stats = await waitFor(
			async () => {
				const s = await call<Stats>(sock, "GET", "/stats");
				return s.frames > 0 ? s : undefined;
			},
			20_000,
			"harness ready",
		).catch((err: unknown) => {
			throw new Error(`${err instanceof Error ? err.message : String(err)}\n${capturePane(split.pane)}`);
		});
		imageId = stats.imageId;
		if (stats.browserPid) for (const p of tree(snapshot(), stats.browserPid)) startedPids.add(p);
		const h: Harness = {
			split,
			sock,
			stats,
			get: (p) => call(sock, "GET", p),
			post: (p) => call(sock, "POST", p),
		};
		return await fn(h);
	} finally {
		await call(sock, "POST", "/quit", 2_000).catch(() => {});
		const end = Date.now() + 5_000;
		while (Date.now() < end && tmux("list-panes", "-a", "-F", "#{pane_id}").split("\n").includes(split.pane)) await sleep(100);
		closeSplit(split, imageId ? [imageId] : []);
	}
}

/** Pane cell (1-based) whose center lies on grid target `i` of the 6x3 grid fixture. */
function targetCell(s: Stats, i: number): { x: number; y: number } {
	const cssW = s.cols * s.cssCell.width;
	const cssH = s.rows * s.cssCell.height;
	const cx = ((i % 6) + 0.5) * (cssW / 6);
	const cy = (Math.floor(i / 6) + 0.5) * (cssH / 3);
	return { x: s.origin.col + Math.floor(cx / s.cssCell.width), y: s.origin.row + Math.floor(cy / s.cssCell.height) };
}

function click(s: Stats, i: number): string {
	const { x, y } = targetCell(s, i);
	return sgr(35, x, y) + sgr(0, x, y) + sgr(0, x, y, true);
}

async function inputPhase(): Promise<Record<string, unknown>> {
	return withHarness(FIXTURE("grid.html"), async (h) => {
		await h.post("/hits/reset");
		const expected18 = Array.from({ length: 18 }, (_, i) => i);
		for (const i of expected18) {
			sendLiteral(h.split.pane, click(h.stats, i));
			await waitFor(async () => ((await h.get<number[]>("/hits")).length > i ? true : undefined), 3_000, `click ${i}`);
		}
		const hits18 = await h.get<number[]>("/hits");
		await h.post("/hits/reset");
		const burst = Array.from({ length: 60 }, (_, i) => (i * 7) % 18);
		sendLiteral(h.split.pane, burst.map((i) => click(h.stats, i)).join(""));
		await waitFor(async () => ((await h.get<number[]>("/hits")).length >= 60 ? true : undefined), 10_000, "60-click burst").catch(() => {});
		await sleep(300);
		const hitsBurst = await h.get<number[]>("/hits");
		const stats = await h.get<Stats>("/stats");
		const ok18 = JSON.stringify(hits18) === JSON.stringify(expected18);
		const okBurst = JSON.stringify(hitsBurst) === JSON.stringify(burst);
		return {
			pass: ok18 && okBurst,
			grid18: { pass: ok18, hits: hits18.length, mismatches: expected18.filter((e, i) => hits18[i] !== e).length },
			burst60: { pass: okBurst, hits: hitsBurst.length, mismatches: burst.filter((e, i) => hitsBurst[i] !== e).length },
			framesSent: stats.sent,
			errors: stats.errors,
		};
	});
}

const browserTree = (h: Harness) => (snap: Map<number, Proc>) => (h.stats.browserPid ? tree(snap, h.stats.browserPid) : []);

async function idlePhase(): Promise<Record<string, unknown>> {
	const unchanged = await withHarness(FIXTURE("static.html"), async (h) => {
		await sleep(1_500);
		await h.post("/counters/reset");
		await sleep(5_000);
		const s = await h.get<Stats>("/stats");
		return { pass: s.frames === 0, windowMs: 5_000, frames: s.frames, sent: s.sent };
	});
	const frozen = await withHarness(FIXTURE("anim.html"), async (h) => {
		await sleep(1_000);
		await h.post("/freeze");
		await sleep(1_000);
		await h.post("/counters/reset");
		const cpu = await sampleCpu({ browser: browserTree(h) }, 10_000);
		const s = await h.get<Stats>("/stats");
		await h.post("/counters/reset");
		await h.post("/thaw");
		const thawed = await waitFor(async () => ((await h.get<Stats>("/stats")).frames > 0 ? true : undefined), 2_000, "frame after thaw").catch(() => false);
		const browser = cpu.browser;
		return {
			pass: !!browser && browser.cpuPercent <= 0.5 && s.frames === 0 && thawed === true,
			windowMs: 10_000,
			browser,
			framesWhileFrozen: s.frames,
			frameAfterThaw: thawed,
		};
	});
	return { pass: unchanged.pass && frozen.pass, unchangedLivePage: unchanged, frozenAnimatingPage: frozen };
}

async function activePhase(): Promise<Record<string, unknown>> {
	const tmuxPid = Number(tmux("display", "-p", "#{pid}"));
	const ghostty = execFileSync("pgrep", ["-x", "ghostty"], { encoding: "utf8" }).trim().split("\n").map(Number).filter(Boolean);
	// AC02 judges the widget's marginal cost: the shared tmux server and Ghostty also carry unrelated load from the
	// user's other sessions, so their no-widget baseline (same window length, taken immediately before the widget
	// starts) is subtracted from them, never below zero. The browser tree and the harness count in full.
	const WINDOW_MS = 10_000;
	const base = await sampleCpu({ tmux: () => [tmuxPid], ghostty: () => ghostty }, WINDOW_MS);
	const baseTmux = base.tmux?.cpuPercent ?? 0;
	const baseGhostty = base.ghostty?.cpuPercent ?? 0;
	return withHarness(FIXTURE("anim.html"), async (h) => {
		await sleep(2_000);
		const runs: Record<string, unknown>[] = [];
		const totals: number[] = [];
		const marginals: number[] = [];
		for (let r = 0; r < 3; r++) {
			await h.post("/counters/reset");
			const cpu = await sampleCpu(
				{
					browser: browserTree(h),
					harness: () => [h.stats.pid],
					tmux: () => [tmuxPid],
					ghostty: () => ghostty,
				},
				WINDOW_MS,
			);
			const s = await h.get<Stats>("/stats");
			const pct = (k: string): number => cpu[k]?.cpuPercent ?? 0;
			const total = round(pct("browser") + pct("harness") + pct("tmux") + pct("ghostty"));
			const marginal = round(pct("browser") + pct("harness") + Math.max(0, pct("tmux") - baseTmux) + Math.max(0, pct("ghostty") - baseGhostty));
			totals.push(total);
			marginals.push(marginal);
			runs.push({
				marginalCpuPercent: marginal,
				totalCpuPercent: total,
				fps: round(s.sent / (WINDOW_MS / 1000), 1),
				avgFrameKb: s.sent ? round(s.bytes / s.sent / 1024, 1) : 0,
				...cpu,
			});
		}
		const medMarginal = round(median(marginals));
		return {
			pass: medMarginal <= 40,
			limitPercent: 40,
			medianMarginalCpuPercent: medMarginal,
			medianTotalCpuPercent: round(median(totals)),
			baseline: { windowMs: WINDOW_MS, tmux: baseTmux, ghostty: baseGhostty },
			runs,
		};
	});
}

const phases: Record<string, () => Promise<Record<string, unknown>>> = { input: inputPhase, idle: idlePhase, active: activePhase };
const selected = process.argv.slice(2).filter((a) => a in phases);
const run = selected.length ? selected : Object.keys(phases);
const result: Record<string, unknown> = {};
let pass = true;
for (const name of run) {
	try {
		const r = await phases[name]!();
		result[name] = r;
		pass &&= r.pass === true;
	} catch (err) {
		result[name] = { pass: false, error: err instanceof Error ? err.message : String(err) };
		pass = false;
	}
}
await sleep(500);
const after = snapshot();
const leftover = [...startedPids].filter((p) => after.has(p));
if (leftover.length) pass = false;
process.stdout.write(`${JSON.stringify({ pass, ...result, browserPidsStarted: startedPids.size, browserPidsLeft: leftover }, null, 2)}\n`);
process.exit(pass ? 0 : 1);
