// Widget guide location and read tracking (RQ03, RQ04): a successful `read` of the guide marks it read for the current
// session runtime; compaction and session starts reset the mark.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of `guide/widgets.md` in the package root. */
export const GUIDE_PATH = fileURLToPath(new URL("../guide/widgets.md", import.meta.url));

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** Resolves a `read` path like Pi does: optional leading `@`, `~` expansion, relative to the session cwd. */
export function resolveReadPath(path: string, cwd: string, home = homedir()): string {
	let p = path.trim();
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = resolve(home, p.slice(2));
	return real(resolve(cwd, p));
}

export class GuideTracker {
	readonly path: string;
	private readonly target: string;
	private readonly home: string | undefined;
	private marked = false;

	constructor(path = GUIDE_PATH, home?: string) {
		this.path = path;
		this.target = real(path);
		this.home = home;
	}

	get read(): boolean {
		return this.marked;
	}

	/** Called for every finished `read` call; returns true when it marked the guide as read. */
	onRead(input: unknown, cwd: string, isError: boolean): boolean {
		const path = (input as { path?: unknown } | undefined)?.path;
		if (isError || typeof path !== "string" || !path) return false;
		if (resolveReadPath(path, cwd, this.home) !== this.target) return false;
		this.marked = true;
		return true;
	}

	reset(): void {
		this.marked = false;
	}

	/** Line appended to `show_widget` results while the guide is unread; empty once read. */
	pointer(): string {
		return this.marked ? "" : `Before editing this widget or creating another, read the widget guide: ${this.path}`;
	}
}
