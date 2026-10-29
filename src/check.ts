// `check_widget` (RQ05): the read-only layout probe evaluated in an isolated world, and the text report.
import type { BlockedRequest } from "./page.js";

/** Long edge of `check_widget` images in pixels. */
export const CHECK_MAX_EDGE = 1000;
/** Overflowing or clipped elements listed in the report. */
export const MAX_ISSUES = 10;

export interface LayoutIssue {
	/** Tag plus `#id` or up to two `.class` names. */
	el: string;
	x: number;
	y: number;
	w: number;
	h: number;
	why: string;
}

export interface LayoutProbe {
	viewport: { width: number; height: number };
	scroll: { width: number; height: number };
	issues: LayoutIssue[];
	/** All outermost issues found (the list holds at most MAX_ISSUES). */
	total: number;
}

/**
 * Read-only probe: document scroll size versus viewport, and the outermost elements that leave the viewport (outside
 * any clipping container) or exceed the client box of their nearest `overflow: hidden` or `clip` ancestor. Content in
 * `overflow: auto` or `scroll` containers is treated as intended. No events, no focus or style changes.
 */
export const PROBE_SCRIPT = `(() => {
const max = ${MAX_ISSUES};
const vw = innerWidth, vh = innerHeight;
const de = document.documentElement, body = document.body;
const scroll = { width: Math.max(de.scrollWidth, body ? body.scrollWidth : 0), height: Math.max(de.scrollHeight, body ? body.scrollHeight : 0) };
const label = (el) => {
	let s = el.tagName.toLowerCase();
	if (el.id) return s + "#" + el.id;
	const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
	return cls.length ? s + "." + cls.join(".") : s;
};
const skip = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META|TITLE|HEAD)$/;
const clipper = (el) => {
	for (let a = el.parentElement; a && a !== body && a !== de; a = a.parentElement) {
		const cs = getComputedStyle(a);
		if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return { a, hidden: /^(hidden|clip)$/.test(cs.overflowX) || /^(hidden|clip)$/.test(cs.overflowY) };
	}
	return undefined;
};
const flagged = new Set();
const issues = [];
let total = 0;
const all = body ? body.querySelectorAll("*") : [];
for (let i = 0; i < all.length && i < 5000; i++) {
	const el = all[i];
	if (skip.test(el.tagName)) continue;
	const r = el.getBoundingClientRect();
	if (r.width <= 0 || r.height <= 0) continue;
	let why = "";
	const c = clipper(el);
	if (!c) {
		const out = [];
		if (r.right > vw + 1) out.push("right by " + Math.round(r.right - vw));
		if (r.bottom > vh + 1) out.push("bottom by " + Math.round(r.bottom - vh));
		if (r.left < -1) out.push("left by " + Math.round(-r.left));
		if (r.top < -1) out.push("top by " + Math.round(-r.top));
		if (out.length) why = "beyond the viewport (" + out.join(", ") + " px)";
	} else if (c.hidden) {
		const ar = c.a.getBoundingClientRect();
		const left = ar.left + c.a.clientLeft, top = ar.top + c.a.clientTop;
		const right = left + c.a.clientWidth, bottom = top + c.a.clientHeight;
		if (r.right > right + 1 || r.bottom > bottom + 1 || r.left < left - 1 || r.top < top - 1) why = "clipped by " + label(c.a) + " (overflow: hidden)";
	}
	if (!why) continue;
	const outer = !(el.parentElement && flagged.has(el.parentElement));
	flagged.add(el);
	if (!outer) continue;
	total++;
	if (issues.length < max) issues.push({ el: label(el), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), why });
}
return { viewport: { width: vw, height: vh }, scroll, issues, total };
})()`;

export type CheckState = "live" | "frozen" | "closed";

export interface CheckReport {
	id: string;
	title: string;
	state: CheckState;
	cols: number;
	rows: number;
	cssWidth: number;
	cssHeight: number;
	image?: { source: "fresh capture" | "last still"; width: number; height: number } | undefined;
	/** Page-derived parts; undefined for a closed widget. */
	page?: { errors: readonly string[]; blocked: readonly BlockedRequest[]; probe?: LayoutProbe | undefined; probeError?: string | undefined } | undefined;
}

const STATE_TEXT: Record<CheckState, string> = {
	live: "live (running)",
	frozen: "frozen (paused on its last frame; not woken for this check)",
	closed: "closed (no open page; it reopens with fresh JS state when the user clicks it)",
};

export const CLOSED_NOTE = "closed: not inspected; showing the last still";

/** The text part of a `check_widget` result. */
export function formatCheck(r: CheckReport): string {
	const lines = [`Widget ${r.id} (${r.title}): ${STATE_TEXT[r.state]}; ${r.cols}x${r.rows} cells, CSS viewport ${r.cssWidth}x${r.cssHeight} px.`];
	lines.push(r.image ? `Image: ${r.image.source}, ${r.image.width}x${r.image.height} px PNG.` : "Image: none available.");
	const p = r.page;
	if (!p) {
		lines.push(`JS errors, blocked requests, scroll size, and overflow: ${CLOSED_NOTE}.`);
		return lines.join("\n");
	}
	lines.push(p.errors.length ? `JS errors since the last load:\n${p.errors.map((e) => `- ${e}`).join("\n")}` : "JS errors since the last load: none.");
	lines.push(p.blocked.length ? `Blocked requests since the last load:\n${p.blocked.map((b) => `- ${b.url} (${b.reason})`).join("\n")}` : "Blocked requests since the last load: none.");
	const probe = p.probe;
	if (!probe) {
		lines.push(`Layout: not inspected (${p.probeError ?? "probe failed"}).`);
		return lines.join("\n");
	}
	const { scroll, viewport } = probe;
	const over: string[] = [];
	if (scroll.width > viewport.width) over.push("wider");
	if (scroll.height > viewport.height) over.push("taller");
	lines.push(
		`Document scroll size ${scroll.width}x${scroll.height} px vs viewport ${viewport.width}x${viewport.height} px: ${over.length ? `content is ${over.join(" and ")} than the viewport and cannot be scrolled.` : "fits."}`,
	);
	if (!probe.issues.length) lines.push("Overflowing or clipped elements: none.");
	else {
		const more = probe.total > probe.issues.length ? ` (first ${probe.issues.length} of ${probe.total})` : "";
		lines.push(`Overflowing or clipped elements${more}:\n${probe.issues.map((i) => `- ${i.el} at ${i.x},${i.y} size ${i.w}x${i.h}: ${i.why}`).join("\n")}`);
	}
	return lines.join("\n");
}
