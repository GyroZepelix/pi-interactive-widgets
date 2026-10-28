// Helpers for driving the harness in a temporary visible tmux split and sampling CPU and footprint with `ps`.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { deleteCommand } from "../../src/kitty.js";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function tmux(...args: string[]): string {
	return execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface Split {
	pane: string;
	tty: string;
}

/**
 * Splits a pane in the attached client's current window so the new pane is visible. Prefers the pane running this
 * script when it is in that window; the split is detached (focus stays) and must be closed with `closeSplit`.
 */
export function openSplit(command: string, cwd: string, need: { cols: number; rows: number }): Split {
	const client = tmux("list-clients", "-F", "#{client_name}").split("\n")[0];
	if (!client) throw new Error("no attached tmux client");
	const clientWindow = tmux("display", "-p", "-c", client, "#{window_id}");
	const own = process.env.TMUX_PANE;
	const target = own && tmux("display", "-p", "-t", own, "#{window_id}") === clientWindow ? own : tmux("display", "-p", "-c", client, "#{pane_id}");
	const [w, h] = tmux("display", "-p", "-t", target, "#{pane_width} #{pane_height}").split(" ").map(Number) as [number, number];
	let dir: "-v" | "-h";
	if (w >= need.cols && Math.floor((h - 1) / 2) >= need.rows) dir = "-v";
	else if (Math.floor((w - 1) / 2) >= need.cols && h >= need.rows) dir = "-h";
	else throw new Error(`pane ${target} (${w}x${h}) too small to split for ${need.cols}x${need.rows}`);
	const out = tmux("split-window", dir, "-d", "-t", target, "-c", cwd, "-P", "-F", "#{pane_id} #{pane_tty}", command);
	const [pane, tty] = out.split(" ") as [string, string];
	return { pane, tty };
}

export function paneAlive(pane: string): boolean {
	try {
		return tmux("display", "-p", "-t", pane, "#{pane_id}") === pane;
	} catch {
		return false;
	}
}

export function capturePane(pane: string): string {
	try {
		return tmux("capture-pane", "-p", "-t", pane);
	} catch {
		return "";
	}
}

/** Kills the split if it is still open; deletes the given image ids through its tty first. */
export function closeSplit(split: Split, imageIds: number[] = []): void {
	if (!paneAlive(split.pane)) return;
	try {
		for (const id of imageIds) writeFileSync(split.tty, deleteCommand(id, { tmux: true }));
	} catch {}
	try {
		tmux("kill-pane", "-t", split.pane);
	} catch {}
}

export function sgr(b: number, x: number, y: number, release = false): string {
	return `\x1b[<${b};${x};${y}${release ? "m" : "M"}`;
}

export function sendLiteral(pane: string, data: string): void {
	tmux("send-keys", "-t", pane, "-l", data);
}

// ---- control socket ----

export function call<T = unknown>(socketPath: string, method: "GET" | "POST", path: string, timeoutMs = 5_000): Promise<T> {
	return new Promise((resolve, reject) => {
		const req = request({ socketPath, method, path, timeout: timeoutMs }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (c: string) => (body += c));
			res.on("end", () => {
				try {
					const parsed = JSON.parse(body) as T & { error?: string };
					if (res.statusCode !== 200) reject(new Error(parsed.error ?? `HTTP ${res.statusCode}`));
					else resolve(parsed);
				} catch (err) {
					reject(err);
				}
			});
		});
		req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
		req.on("error", reject);
		req.end();
	});
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
	const end = Date.now() + timeoutMs;
	for (;;) {
		try {
			const v = await fn();
			if (v !== undefined) return v;
		} catch {}
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await sleep(100);
	}
}

// ---- ps sampling ----

export interface Proc {
	pid: number;
	ppid: number;
	cpuMs: number;
	rssKb: number;
}

function parseTime(t: string): number {
	// macOS `ps -o time`: [[H:]M:]S.cc
	return t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
}

export function snapshot(): Map<number, Proc> {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,rss="], { encoding: "utf8" }).trim().split("\n");
	const map = new Map<number, Proc>();
	for (const row of rows) {
		const [pid, ppid, time, rss] = row.trim().split(/\s+/);
		if (!pid || !ppid || !time || !rss) continue;
		map.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), cpuMs: parseTime(time), rssKb: Number(rss) });
	}
	return map;
}

/** A process and all its descendants present in the snapshot. */
export function tree(snap: Map<number, Proc>, root: number): number[] {
	const set = new Set<number>(snap.has(root) ? [root] : []);
	let grew = true;
	while (grew) {
		grew = false;
		for (const p of snap.values()) if (!set.has(p.pid) && set.has(p.ppid)) set.add(p.pid), (grew = true);
	}
	return [...set];
}

export interface GroupSample {
	cpuPercent: number;
	rssMb: number;
	pids: number;
}

/**
 * CPU of each process group over `ms`, as percent of one core, from `ps` CPU-time deltas. Groups are resolved at the
 * end of the window; processes that started during it count from zero.
 */
export async function sampleCpu(groups: Record<string, (snap: Map<number, Proc>) => number[]>, ms: number): Promise<Record<string, GroupSample>> {
	const before = snapshot();
	const t0 = performance.now();
	await sleep(ms);
	const after = snapshot();
	const wall = performance.now() - t0;
	const result: Record<string, GroupSample> = {};
	for (const [name, pick] of Object.entries(groups)) {
		let cpu = 0;
		let rss = 0;
		const pids = pick(after);
		for (const pid of pids) {
			const a = after.get(pid);
			if (!a) continue;
			cpu += a.cpuMs - (before.get(pid)?.cpuMs ?? 0);
			rss += a.rssKb;
		}
		result[name] = { cpuPercent: round((cpu / wall) * 100), rssMb: round(rss / 1024), pids: pids.length };
	}
	return result;
}

export const round = (n: number, digits = 2): number => Math.round(n * 10 ** digits) / 10 ** digits;

export function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? (s[mid] ?? Number.NaN) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}
