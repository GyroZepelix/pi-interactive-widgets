// Shared helpers for browser tests (no frame is ever written to disk).
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Width and height from a base64 PNG header, decoding only the first 24 bytes. */
export function pngSize(base64: string): { width: number; height: number } {
	const head = Buffer.from(base64.slice(0, 32), "base64");
	return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** PIDs of a process and all its descendants. */
export function processTree(root: number): number[] {
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
	return [...set].filter((p) => rows.some(([pid]) => pid === p));
}

export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function waitGone(pids: number[], timeoutMs = 5_000): Promise<number[]> {
	const end = Date.now() + timeoutMs;
	let left = pids.filter(alive);
	while (left.length && Date.now() < end) {
		await sleep(50);
		left = left.filter(alive);
	}
	return left;
}

export interface LocalServer {
	port: number;
	hits: { method: string; url: string; headers: IncomingMessage["headers"] }[];
	close(): Promise<void>;
}

/** Loopback HTTP server that records every request and answers with permissive CORS (no local-network opt-in header). */
export async function localServer(): Promise<LocalServer> {
	const hits: LocalServer["hits"] = [];
	const server = createServer((req, res) => {
		hits.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Headers", "*");
		res.end("local");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		port: (server.address() as AddressInfo).port,
		hits,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
}

export async function until(fn: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<boolean> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (await fn()) return true;
		await sleep(25);
	}
	return false;
}
