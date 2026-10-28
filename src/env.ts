// Environment detection: tmux client terminal, plain Ghostty, and the tmux cell size (RQ14).
import { execFileSync } from "node:child_process";

export type EnvKind = "tmux-ghostty" | "tmux-kitty" | "tmux-other" | "ghostty" | "unsupported";

export interface Environment {
	kind: EnvKind;
	supported: boolean;
	/** Graphics commands need DCS passthrough wrapping. */
	tmux: boolean;
	/** tmux client terminal name, when under tmux. */
	clientTerm?: string | undefined;
}

/** Runs `tmux display -p <format>` and returns trimmed stdout; throws when tmux is unavailable. */
export type TmuxQuery = (format: string) => string;

export const UNSUPPORTED_NOTICE = "[widgets need tmux + Ghostty]";

/** Queries the tmux client that shows this process's pane. */
export function tmuxDisplay(env: NodeJS.ProcessEnv = process.env): TmuxQuery {
	return (format) => {
		const target = env.TMUX_PANE ? ["-t", env.TMUX_PANE] : [];
		return execFileSync("tmux", ["display", "-p", ...target, format], { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
	};
}

/** Classifies the terminal: under tmux by the client terminal (Ghostty or kitty), otherwise plain Ghostty only. */
export function detectEnvironment(env: NodeJS.ProcessEnv = process.env, query: TmuxQuery = tmuxDisplay(env)): Environment {
	if (env.TMUX) {
		let clientTerm = "";
		try {
			clientTerm = query("#{client_termname}");
		} catch {}
		const kind: EnvKind = /ghostty/i.test(clientTerm) ? "tmux-ghostty" : /kitty/i.test(clientTerm) ? "tmux-kitty" : "tmux-other";
		return { kind, supported: kind !== "tmux-other", tmux: true, clientTerm };
	}
	if (env.TERM_PROGRAM?.toLowerCase() === "ghostty") return { kind: "ghostty", supported: true, tmux: false };
	return { kind: "unsupported", supported: false, tmux: false };
}

/**
 * Pi's own multiplexer condition (pi-tui 1.4.0 `tui-alt-screen.js`): under tmux, Zellij, or screen Pi enables only
 * button-motion mouse tracking, so hover moves never arrive. Elsewhere it enables all-motion tracking (PD09).
 */
export function pointerMotionReported(env: NodeJS.ProcessEnv = process.env): boolean {
	const term = env.TERM?.toLowerCase() ?? "";
	return !(env.TMUX !== undefined || env.ZELLIJ !== undefined || env.STY !== undefined || term.startsWith("tmux") || term.startsWith("screen"));
}

export interface CellSize {
	/** Device pixels per cell. */
	width: number;
	height: number;
}

/** Cell size in device pixels from the tmux client; undefined when tmux does not report it. */
export function tmuxCellSize(query: TmuxQuery): CellSize | undefined {
	let out: string;
	try {
		out = query("#{client_cell_width} #{client_cell_height}");
	} catch {
		return undefined;
	}
	const [w, h] = out.split(/\s+/).map(Number);
	if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
	return { width: w, height: h };
}

/** CSS pixels per cell at the browser's device pixel ratio. */
export function cssCellSize(cell: CellSize, dpr: number): CellSize {
	return { width: cell.width / dpr, height: cell.height / dpr };
}
