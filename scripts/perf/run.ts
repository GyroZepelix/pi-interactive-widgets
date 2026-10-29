// Harness acceptance and perf runner (slices 01.02 and 02.02). Opens the harness, or Pi for the disk phase, in a
// temporary visible split of the attached tmux client's current window, drives it, samples CPU with `ps`, and closes
// the split afterwards.
//
//   npm run perf                 # input, idle (AC01), active (AC02), and disk (AC04)
//   npm run perf -- input idle   # selected phases
//
// Prints one JSON summary; exits 1 when an acceptance check fails. No frame is written to disk.
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromePids, PiSession } from "../../tests/e2e/lib.js";
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
	imageIds?: number[];
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
	let imageIds: number[] = [];
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
		imageIds = stats.imageIds ?? [stats.imageId];
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
		closeSplit(split, imageIds);
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

/** Files under `dir` modified after `marker` (find -newer), skipping dependency and VCS folders. */
function newerFiles(dir: string, marker: string, maxDepth?: number): string[] {
	const depth = maxDepth === undefined ? [] : ["-maxdepth", String(maxDepth)];
	try {
		return execFileSync("find", [dir, ...depth, "(", "-name", "node_modules", "-o", "-name", ".git", ")", "-prune", "-o", "-type", "f", "-newer", marker, "-print"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\n")
			.filter(Boolean)
			.filter((f) => f !== marker);
	} catch (err) {
		// find exits non-zero on unreadable entries but still prints what it found.
		const out = (err as { stdout?: string }).stdout ?? "";
		return out.split("\n").filter(Boolean).filter((f) => f !== marker);
	}
}

/** Image file by name or by PNG, JPEG, GIF, or WebP magic bytes. */
function imageLike(file: string): boolean {
	if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file)) return true;
	try {
		if (!statSync(file).isFile()) return false;
		const fd = openSync(file, "r");
		const head = Buffer.alloc(12);
		readSync(fd, head, 0, 12, 0);
		closeSync(fd);
		const hex = head.toString("hex");
		return hex.startsWith("89504e47") || hex.startsWith("ffd8ff") || hex.startsWith("47494638") || (hex.startsWith("52494646") && head.toString("latin1", 8, 12) === "WEBP");
	} catch {
		return false;
	}
}

/**
 * AC04: a 60 s Pi session with an animating widget kept live (focused) writes no frame or still file. Before the live
 * window, three show_image calls (show-image item AC08b) load a PNG file, a JPEG file decoded by Chromium, and a WebP
 * URL from a loopback server listed in allowHosts. New files under the Chromium profile, the isolated agent dir, the
 * repository, and the temp dir are listed; profile writes after the launch settled are reported separately.
 */
async function diskPhase(): Promise<Record<string, unknown>> {
	const SESSION_MS = 60_000;
	const marker = join(tmpdir(), `piw-disk-${process.pid}-start`);
	writeFileSync(marker, "");
	await sleep(1_100); // find -newer has one-second resolution on some file systems
	const webp = readFileSync(FIXTURE("image.webp"));
	let served = 0;
	const server = createServer((_req, res) => {
		served++;
		res.setHeader("Content-Type", "image/webp");
		res.end(webp);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as AddressInfo).port;
	const s = await PiSession.start({ config: JSON.stringify({ network: { allowHosts: [`127.0.0.1:${port}`] } }) });
	try {
		await s.command("/widget-dev tests/fixtures/anim.html 60 10");
		const first = await s.waitEvent((e) => e.ev === "widget", 20_000, "widget");
		s.track();
		// Images decode in the widget's browser, so its profile is the one inspected below.
		const sources = ["tests/fixtures/image.png", "tests/fixtures/image.jpg", `http://127.0.0.1:${port}/image.webp`];
		for (const [i, source] of sources.entries()) {
			await s.command(`e2e-call show_image ${JSON.stringify({ source, title: `disk ${i}`, rows: 6 })}`);
			await s.waitFor(() => s.events().filter((e) => e.ev === "image")[i], 20_000, `show_image ${source}`);
			s.track();
		}
		const shownImages = s.events().filter((e) => e.ev === "image").map((e) => ({ source: e.source, format: e.format, browser: e.browser, cols: e.cols, rows: e.rows }));
		// The image rows pushed the first widget off screen; a second one at the bottom becomes the live widget.
		await s.command("/widget-dev tests/fixtures/anim.html 60 10");
		const w = await s.waitEvent((e) => e.ev === "widget" && e.id !== first.id, 20_000, "second widget");
		const browser = chromePids(s.seen);
		for (const p of browser) startedPids.add(p);
		const args = browser.length ? execFileSync("ps", ["-o", "command=", "-p", browser.join(",")], { encoding: "utf8" }) : "";
		const profile = /--user-data-dir=(\S+)/.exec(args)?.[1];
		await sleep(2_000);
		const settled = join(tmpdir(), `piw-disk-${process.pid}-settled`);
		writeFileSync(settled, "");
		await sleep(1_100);
		const grid = await s.waitLocate(Number(w.imageId), 10);
		s.type(s.press(grid.col + 5, grid.row + 5));
		await s.waitEvent((e) => e.ev === "focus" && e.id === w.id, 5_000, "focus");
		const t0 = Date.now();
		const cpu = await sampleCpu({ browser: (snap) => browser.filter((p) => snap.has(p)) }, SESSION_MS);
		const liveMs = Date.now() - t0;
		const frozeDuring = s.events().some((e) => e.ev === "frozen" && e.id === w.id && e.t >= t0);
		const roots = [profile, s.agentDir, ROOT].filter((d): d is string => !!d);
		const created = [...new Set([...roots.flatMap((d) => newerFiles(d, marker)), ...newerFiles(tmpdir(), marker, 3)])].filter((f) => !f.startsWith(marker.replace(/-start$/, "")));
		const images = created.filter(imageLike);
		const profileAfterLaunch = profile ? newerFiles(profile, settled) : [];
		s.key("Escape");
		const short = (f: string): string => f.replace(tmpdir(), "$TMPDIR").replace(ROOT, "<repo>");
		return {
			pass: images.length === 0 && !frozeDuring && (cpu.browser?.cpuPercent ?? 0) > 1 && shownImages.length === 3 && served === 1,
			sessionMs: liveMs,
			shownImages,
			urlRequests: served,
			animatingBrowserCpuPercent: cpu.browser?.cpuPercent,
			frozeDuringWindow: frozeDuring,
			imageFiles: images.map(short),
			newFiles: created.map(short),
			profileDir: profile ? short(profile) : null,
			// Size and last write relative to the start of the live window, to show whether writes continue.
			profileWritesAfterLaunch: profileAfterLaunch.map((f) => {
				try {
					const st = statSync(f);
					return { file: short(f), bytes: st.size, lastWriteMs: Math.round(st.mtimeMs - t0) };
				} catch {
					return { file: short(f) };
				}
			}),
		};
	} finally {
		server.closeAllConnections();
		await new Promise<void>((r) => server.close(() => r()));
		const left = await s.close();
		for (const p of left) startedPids.add(p);
		for (const f of [marker, join(tmpdir(), `piw-disk-${process.pid}-settled`)]) {
			try {
				execFileSync("rm", ["-f", f]);
			} catch {}
		}
	}
}

const phases: Record<string, () => Promise<Record<string, unknown>>> = { input: inputPhase, idle: idlePhase, active: activePhase, disk: diskPhase };
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
