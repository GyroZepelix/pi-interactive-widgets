// Raw input hook (RQ01, RQ02): one listener at the front of the TUI's internal `inputListeners` Set, ahead of Pi's own
// fullscreen viewport listener, which consumes every mouse sequence before `ctx.ui.onTerminalInput` handlers run.
// This relies on a TypeScript-private pi-tui field (a workaround, not a Pi API): a feature check guards it, the Set is
// rebuilt in place, and no Pi function or file is replaced or patched. Without the field the hook is not installed.

export type RawInputResult = { consume?: boolean; data?: string } | undefined;
export type RawInputListener = (data: string) => RawInputResult;

/** One complete SGR mouse sequence; `x` and `y` are 0-based terminal cells. */
export interface SgrMouse {
	code: number;
	x: number;
	y: number;
	release: boolean;
}

const SGR = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseSgr(data: string): SgrMouse | undefined {
	const m = SGR.exec(data);
	if (!m) return undefined;
	return { code: Number(m[1]), x: Number(m[2]) - 1, y: Number(m[3]) - 1, release: m[4] === "m" };
}

/** SGR modifier bits: shift 4, alt (meta) 8, ctrl 16. */
const MODIFIER_BITS = 4 | 8 | 16;

/** Horizontal wheel: bit 64 with direction 2 (left) or 3 (right), any modifier bits. Returns -1, 1, or 0. */
export function horizontalWheel(code: number): -1 | 0 | 1 {
	const base = code & ~MODIFIER_BITS;
	return base === 66 ? -1 : base === 67 ? 1 : 0;
}

/** A button press: neither motion (32) nor wheel (64) bit, final `M`. */
export function isPress(m: SgrMouse): boolean {
	return !m.release && (m.code & (32 | 64)) === 0;
}

/** CDP modifier mask (Alt 1, Ctrl 2, Shift 8) from SGR modifier bits. */
export function cdpModifiers(code: number): number {
	return (code & 8 ? 1 : 0) | (code & 16 ? 2 : 0) | (code & 4 ? 8 : 0);
}

/** Feature check: the TUI's raw input listeners as a Set (pi-tui 1.4 `TuiBase.inputListeners`), or undefined. */
export function listenerSet(tui: unknown): Set<RawInputListener> | undefined {
	if (!tui || typeof tui !== "object") return undefined;
	let set: unknown;
	try {
		set = (tui as { inputListeners?: unknown }).inputListeners;
	} catch {
		return undefined;
	}
	return set instanceof Set ? (set as Set<RawInputListener>) : undefined;
}

/** Puts `listener` first, keeping every other listener in its original order (rebuilds the Set in place). */
export function installFirst(set: Set<RawInputListener>, listener: RawInputListener): void {
	if (set.values().next().value === listener) return;
	const rest = [...set].filter((l) => l !== listener);
	set.clear();
	set.add(listener);
	for (const l of rest) set.add(l);
}

export class RawInputHook {
	private readonly listener: RawInputListener;
	private set: Set<RawInputListener> | undefined;

	/** `handler` errors are swallowed so Pi's input loop never breaks. */
	constructor(handler: RawInputListener) {
		this.listener = (data) => {
			try {
				return handler(data);
			} catch {
				return undefined;
			}
		};
	}

	get installed(): boolean {
		return this.set !== undefined;
	}

	/**
	 * Installs the listener at the front of the TUI's current Set, or re-applies it after a TUI or renderer change (the
	 * listener leaves the old Set). Returns false and removes it when the feature check fails.
	 */
	apply(tui: unknown): boolean {
		const set = listenerSet(tui);
		if (!set) {
			this.remove();
			return false;
		}
		if (this.set && this.set !== set) this.set.delete(this.listener);
		installFirst(set, this.listener);
		this.set = set;
		return true;
	}

	remove(): void {
		this.set?.delete(this.listener);
		this.set = undefined;
	}
}
