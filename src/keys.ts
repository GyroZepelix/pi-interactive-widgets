// Terminal key data to CDP key events for a focused widget (RQ05). Escape and Ctrl+C are reserved for release.
import { decodeKittyPrintable, parseKey } from "@earendil-works/pi-tui";
import type { KeyInput } from "./page.js";

export type KeyAction = { kind: "release" } | { kind: "keys"; events: KeyInput[] } | { kind: "text"; text: string };

/** CDP modifier bits. */
const MOD = { alt: 1, ctrl: 2, meta: 4, super: 4, shift: 8 } as const;

interface SpecialKey {
	key: string;
	code: string;
	vk: number;
	text?: string;
}

const SPECIAL: Record<string, SpecialKey> = {
	enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
	return: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
	tab: { key: "Tab", code: "Tab", vk: 9 },
	backspace: { key: "Backspace", code: "Backspace", vk: 8 },
	delete: { key: "Delete", code: "Delete", vk: 46 },
	insert: { key: "Insert", code: "Insert", vk: 45 },
	space: { key: " ", code: "Space", vk: 32, text: " " },
	up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
	down: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
	left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
	right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
	home: { key: "Home", code: "Home", vk: 36 },
	end: { key: "End", code: "End", vk: 35 },
	pageup: { key: "PageUp", code: "PageUp", vk: 33 },
	pagedown: { key: "PageDown", code: "PageDown", vk: 34 },
};
for (let i = 1; i <= 12; i++) SPECIAL[`f${i}`] = { key: `F${i}`, code: `F${i}`, vk: 111 + i };

const PASTE = /^\x1b\[200~([\s\S]*?)(?:\x1b\[201~)?$/;

function charInfo(ch: string): { code?: string; vk: number } {
	if (/^[a-z]$/i.test(ch)) return { code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0) };
	if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, vk: ch.charCodeAt(0) };
	if (ch === " ") return { code: "Space", vk: 32 };
	return { vk: 0 };
}

function press(key: string, info: { code?: string | undefined; vk: number }, modifiers: number, text?: string): KeyInput[] {
	const base: KeyInput = { type: "keyUp", key, windowsVirtualKeyCode: info.vk, modifiers };
	if (info.code) base.code = info.code;
	const down: KeyInput = text !== undefined ? { ...base, type: "keyDown", text, unmodifiedText: text } : { ...base, type: "rawKeyDown" };
	return [down, base];
}

/** One printable character as keyDown (with text) and keyUp. */
export function charEvents(ch: string, modifiers = 0): KeyInput[] {
	return press(ch, charInfo(ch), modifiers, ch);
}

function isPrintable(data: string): boolean {
	if (!data || data.includes("\x1b")) return false;
	for (const c of data) {
		const cp = c.codePointAt(0) ?? 0;
		if (cp < 0x20 || cp === 0x7f) return false;
	}
	return true;
}

/** Maps one chunk of terminal input to page key events, plain text, or release. Unknown input maps to undefined. */
export function mapKey(data: string): KeyAction | undefined {
	const paste = PASTE.exec(data);
	if (paste) return paste[1] ? { kind: "text", text: paste[1].replace(/\r\n?/g, "\n") } : undefined;
	const id = parseKey(data);
	if (id === "escape" || id === "ctrl+c") return { kind: "release" };
	const printable = decodeKittyPrintable(data) ?? (isPrintable(data) ? data : undefined);
	if (printable !== undefined) {
		const chars = [...printable];
		return chars.length === 1 ? { kind: "keys", events: charEvents(printable) } : { kind: "text", text: printable };
	}
	if (!id) return undefined;
	const parts = id.split("+");
	const name = parts.pop() ?? "";
	let modifiers = 0;
	for (const p of parts) {
		const bit = MOD[p.toLowerCase() as keyof typeof MOD];
		if (bit === undefined) return undefined;
		modifiers |= bit;
	}
	const special = SPECIAL[name.toLowerCase()];
	if (special) {
		// Text is only produced without ctrl, alt, or meta (Enter and Space with shift still type).
		const text = special.text !== undefined && !(modifiers & (MOD.alt | MOD.ctrl | MOD.meta)) ? special.text : undefined;
		return { kind: "keys", events: press(special.key, special, modifiers, text) };
	}
	if ([...name].length === 1) return { kind: "keys", events: press(name, charInfo(name), modifiers) };
	return undefined;
}
