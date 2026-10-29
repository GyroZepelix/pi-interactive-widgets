// Guidance split (RQ01-RQ04) and check_widget report and image helpers (RQ05): no browser or terminal.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { CLOSED_NOTE, type CheckReport, formatCheck } from "../src/check.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { GUIDE_PATH, GuideTracker, resolveReadPath } from "../src/guide.js";
import interactiveWidgets from "../src/index.js";
import { KittyImage } from "../src/kitty.js";
import { type SessionState, Widget, type WidgetDetails, WidgetManager } from "../src/manager.js";
import type { WidgetPage } from "../src/page.js";
import { decodePng, downscale, encodePng, fitSize, limitPng, pngSize } from "../src/png.js";
import { CHECK_DESCRIPTION, DESCRIPTION, GUIDELINES } from "../src/prompts.js";

const ROOT = join(import.meta.dirname, "..");
const tokens = (s: string): number => Math.ceil(s.split(/\s+/).filter(Boolean).length * 1.3);

function solidPng(width: number, height: number, rgba = [10, 20, 30, 255]): string {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
	return encodePng({ width, height, data }).toString("base64");
}

describe("prompts (AC01)", () => {
	it("the show_widget description is at most about 250 tokens and names the guide's absolute path", () => {
		assert.ok(tokens(DESCRIPTION) <= 250, `about ${tokens(DESCRIPTION)} tokens`);
		assert.ok(DESCRIPTION.includes(GUIDE_PATH));
		assert.ok(GUIDE_PATH.startsWith("/") && GUIDE_PATH.endsWith("/guide/widgets.md"));
		for (const s of ["exactly one of `html`", "`path`", "`cols` x `rows`", "8x17 CSS px", "no page scrolling", "instead of hover", "window.pi.send", "window.pi.submit", "Network:"]) assert.ok(DESCRIPTION.includes(s), s);
	});

	it("promptGuidelines hold 4-5 rubric bullets including not for approvals or choosing among options", () => {
		assert.ok(GUIDELINES.length >= 4 && GUIDELINES.length <= 5);
		const all = GUIDELINES.join("\n");
		for (const s of ["not for approvals or choosing among options", "better seen than read", "stepping through state or time", "motion, growth, or spatial structure", "ask_user_question", "inherently visual", "Mermaid/D2", "check_widget"]) assert.ok(all.includes(s), s);
		assert.match(CHECK_DESCRIPTION, /on demand/);
	});

	it("registers show_widget with unchanged name and parameters, plus check_widget({id})", () => {
		const tools: { name: string; parameters: { properties: Record<string, unknown>; required?: string[] }; promptSnippet?: string; promptGuidelines?: string[] }[] = [];
		const events: string[] = [];
		const fake = {
			registerTool: (t: (typeof tools)[number]) => tools.push(t),
			registerCommand() {},
			registerEntryRenderer() {},
			on: (name: string) => events.push(name),
		};
		interactiveWidgets(fake as unknown as Parameters<typeof interactiveWidgets>[0]);
		const show = tools.find((t) => t.name === "show_widget");
		assert.deepEqual(Object.keys(show?.parameters.properties ?? {}).sort(), ["cols", "html", "path", "rows", "title"]);
		assert.equal(show?.parameters.required, undefined);
		assert.deepEqual(show?.promptGuidelines, GUIDELINES);
		assert.equal(show?.promptSnippet?.split("\n").length, 1);
		const check = tools.find((t) => t.name === "check_widget");
		assert.deepEqual(Object.keys(check?.parameters.properties ?? {}), ["id"]);
		assert.deepEqual(check?.parameters.required, ["id"]);
		for (const e of ["tool_result", "session_compact", "session_start"]) assert.ok(events.includes(e), e);
	});
});

describe("guide file (AC02)", () => {
	const guide = readFileSync(GUIDE_PATH, "utf8");
	it("is listed in package.json files and is plain ASCII under about 250 lines", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files: string[] };
		assert.ok(pkg.files.includes("guide"));
		assert.equal(relative(ROOT, GUIDE_PATH), join("guide", "widgets.md"));
		assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(guide), "plain ASCII");
		assert.ok(guide.split("\n").length <= 250);
		assert.equal((guide.match(/^```/gm) ?? []).length % 2, 0, "balanced fences");
	});

	it("covers the topics moved out of the description plus examples and check_widget", () => {
		for (const s of [
			".pi-widgets/<name>/index.html",
			"new widget instance",
			"min(100, terminal width - 4)",
			"min-height: 0",
			"ResizeObserver",
			"--pi-accent",
			"24 px",
			":hover",
			"<select>",
			"input type=date",
			"64 KB",
			"user gesture",
			"cdnjs.cloudflare.com",
			"fonts.gstatic.com",
			"own origin",
			"data:",
			"No WebRTC, popups, form submissions, or navigation",
			"fullscreen mode",
			"At most 5 widget pages",
			"30 minutes",
			"fresh JS state",
			"[untrusted widget data]",
			"### Examples: use a widget",
			"### Examples: do not use a widget",
			"Show, then ask",
			"## check_widget",
			"Not for approvals or choosing among options",
		])
			assert.ok(guide.includes(s), s);
	});
});

describe("read tracking (AC03)", () => {
	const dir = mkdtempSync(join(tmpdir(), "piw-guide-"));
	after(() => rmSync(dir, { recursive: true, force: true }));
	const home = join(dir, "home");
	const pkg = join(home, "pkg");
	mkdirSync(join(pkg, "guide"), { recursive: true });
	mkdirSync(join(dir, "work"));
	const file = join(pkg, "guide", "widgets.md");
	writeFileSync(file, "# guide\n");
	writeFileSync(join(pkg, "guide", "other.md"), "x");
	symlinkSync(pkg, join(dir, "link"));

	for (const [what, path, cwd] of [
		["relative", "guide/widgets.md", pkg],
		["relative from another folder", "../home/pkg/guide/widgets.md", join(dir, "work")],
		["absolute", file, join(dir, "work")],
		["~", "~/pkg/guide/widgets.md", join(dir, "work")],
		["@-prefixed", "@guide/widgets.md", pkg],
		["through a symlink", join(dir, "link", "guide", "widgets.md"), dir],
	] as const) {
		it(`a successful ${what} read marks the guide`, () => {
			const g = new GuideTracker(file, home);
			assert.equal(g.read, false);
			assert.ok(g.pointer().includes(file));
			assert.equal(g.onRead({ path }, cwd, false), true);
			assert.equal(g.read, true);
			assert.equal(g.pointer(), "");
		});
	}

	it("other paths, failed reads, and malformed input do not mark it", () => {
		const g = new GuideTracker(file, home);
		assert.equal(g.onRead({ path: join(pkg, "guide", "other.md") }, pkg, false), false);
		assert.equal(g.onRead({ path: "widgets.md" }, pkg, false), false);
		assert.equal(g.onRead({ path: "guide/widgets.md" }, pkg, true), false, "failed read");
		assert.equal(g.onRead({}, pkg, false), false);
		assert.equal(g.onRead(undefined, pkg, false), false);
		assert.equal(g.read, false);
	});

	it("reset (session_compact, session start) clears the mark and the pointer returns", () => {
		const g = new GuideTracker(file, home);
		g.onRead({ path: file }, pkg, false);
		g.reset();
		assert.equal(g.read, false);
		assert.equal(g.pointer(), `Before editing this widget or creating another, read the widget guide: ${file}`);
	});

	it("resolveReadPath expands ~ and resolves against the cwd", () => {
		assert.equal(resolveReadPath("~/pkg/guide/widgets.md", "/", home), resolveReadPath(file, "/"));
		assert.equal(resolveReadPath("x.md", "/tmp-nonexistent", home), "/tmp-nonexistent/x.md");
	});
});

describe("PNG helpers (RQ05)", () => {
	it("limits the long edge to 1000 px keeping the aspect ratio; smaller images pass through", () => {
		const big = limitPng(solidPng(1600, 680, [200, 100, 50, 255]), 1000);
		assert.deepEqual([big.width, big.height], [1000, 425]);
		assert.deepEqual(pngSize(Buffer.from(big.data, "base64")), { width: 1000, height: 425 });
		const px = decodePng(Buffer.from(big.data, "base64"));
		assert.deepEqual([...px.data.slice(0, 4)], [200, 100, 50, 255]);
		const small = solidPng(300, 200);
		assert.equal(limitPng(small, 1000).data, small);
		assert.deepEqual(fitSize({ width: 400, height: 3000 }, 1000), { width: 133, height: 1000 });
	});

	it("area averaging mixes neighboring pixels", () => {
		const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
		assert.deepEqual([...downscale({ width: 2, height: 1, data }, 1, 1).data], [128, 128, 128, 255]);
	});
});

describe("check_widget report (AC04, AC05)", () => {
	const base: CheckReport = { id: "abc", title: "t", state: "live", cols: 60, rows: 10, cssWidth: 480, cssHeight: 170, image: { source: "fresh capture", width: 960, height: 340 } };

	it("lists overflowing elements and a scroll size larger than the viewport", () => {
		const text = formatCheck({
			...base,
			page: {
				errors: ["ReferenceError: x is not defined"],
				blocked: [{ url: "https://evil.example/x.js", reason: "host not allowed" }],
				probe: { viewport: { width: 480, height: 170 }, scroll: { width: 480, height: 400 }, total: 1, issues: [{ el: "div#tall", x: 0, y: 0, w: 480, h: 400, why: "beyond the viewport (bottom by 230 px)" }] },
			},
		});
		assert.match(text, /^Widget abc \(t\): live/);
		assert.match(text, /Image: fresh capture, 960x340 px PNG\./);
		assert.match(text, /JS errors since the last load:\n- ReferenceError/);
		assert.match(text, /Blocked requests since the last load:\n- https:\/\/evil\.example\/x\.js \(host not allowed\)/);
		assert.match(text, /Document scroll size 480x400 px vs viewport 480x170 px: content is taller than the viewport/);
		assert.match(text, /- div#tall at 0,0 size 480x400: beyond the viewport \(bottom by 230 px\)/);
	});

	it("reports none on a clean page, and the first 10 of more", () => {
		const clean = formatCheck({ ...base, page: { errors: [], blocked: [], probe: { viewport: { width: 480, height: 170 }, scroll: { width: 480, height: 170 }, total: 0, issues: [] } } });
		assert.match(clean, /JS errors since the last load: none\./);
		assert.match(clean, /Blocked requests since the last load: none\./);
		assert.match(clean, /480x170 px vs viewport 480x170 px: fits\./);
		assert.match(clean, /Overflowing or clipped elements: none\./);
		const issues = Array.from({ length: 10 }, (_, i) => ({ el: `div.i${i}`, x: 0, y: 0, w: 1, h: 1, why: "clipped by div.box (overflow: hidden)" }));
		const many = formatCheck({ ...base, page: { errors: [], blocked: [], probe: { viewport: { width: 480, height: 170 }, scroll: { width: 480, height: 170 }, total: 14, issues } } });
		assert.match(many, /\(first 10 of 14\)/);
	});

	it("a closed widget says closed: not inspected; showing the last still", () => {
		const text = formatCheck({ ...base, state: "closed", image: { source: "last still", width: 1000, height: 425 } });
		assert.match(text, /closed \(no open page/);
		assert.match(text, /Image: last still, 1000x425 px PNG\./);
		assert.ok(text.includes(CLOSED_NOTE));
		assert.doesNotMatch(text, /JS errors since/);
	});
});

describe("WidgetManager.check (AC04)", () => {
	function setup() {
		const log: string[] = [];
		const state: SessionState = {
			pi: { sendMessage: () => {} } as unknown as SessionState["pi"],
			env: { kind: "tmux-ghostty", supported: true, tmux: true },
			config: DEFAULT_CONFIG,
			motion: false,
			tui: { mode: "fullscreen", setFocus() {}, requestRender() {} } as unknown as SessionState["tui"],
		};
		const manager = new WidgetManager(state);
		const details: WidgetDetails = { id: "w1", imageId: 1, title: "w1", cols: 100, rows: 20, cssWidth: 800, cssHeight: 340, cssCell: { width: 8, height: 17 }, source: "html" };
		let pageState: "live" | "frozen" | "closed" = "frozen";
		const page = {
			errors: ["boom"],
			blocked: [],
			get frozen() {
				return pageState === "frozen";
			},
			get closed() {
				return pageState === "closed";
			},
			capture: async () => (log.push("capture"), solidPng(1600, 680)),
			inspect: async () => (log.push("inspect"), { viewport: { width: 800, height: 340 }, scroll: { width: 800, height: 340 }, total: 0, issues: [] }),
			thaw: async () => log.push("thaw"),
			freeze: async () => log.push("freeze"),
			close: async () => {
				pageState = "closed";
			},
		};
		const image = new KittyImage(1, { tmux: true }, () => {});
		const w = new Widget(details, page as unknown as WidgetPage, image, { html: "<p>x</p>" });
		manager.widgets.set(w.id, w);
		return { manager, w, page, image, log, setState: (s: typeof pageState) => (pageState = s) };
	}

	it("a frozen widget gets a fresh capture scaled to 1000 px and stays frozen and unfocused", async () => {
		const { manager, w, log } = setup();
		const used = w.lastUsed;
		const r = await manager.check("w1");
		assert.equal(r?.report.state, "frozen");
		assert.deepEqual(r?.report.image, { source: "fresh capture", width: 1000, height: 425 });
		assert.deepEqual(pngSize(Buffer.from(r?.image ?? "", "base64")), { width: 1000, height: 425 });
		assert.deepEqual(r?.report.page?.errors, ["boom"]);
		assert.deepEqual(log, ["capture", "inspect"]);
		assert.equal(w.frozen, true);
		assert.equal(w.focused, false);
		assert.equal(w.lastUsed, used, "LRU order unchanged");
	});

	it("a closed widget returns the RAM still with no page parts and no revive", async () => {
		const { manager, w, image, log, setState } = setup();
		image.send(solidPng(1600, 680), 100, 20);
		setState("closed");
		const revive = manager.revive.bind(manager);
		let revived = 0;
		manager.revive = (...a) => (revived++, revive(...a));
		const r = await manager.check("w1");
		assert.equal(r?.report.state, "closed");
		assert.deepEqual(r?.report.image, { source: "last still", width: 1000, height: 425 });
		assert.equal(r?.report.page, undefined);
		assert.deepEqual(log, []);
		assert.equal(revived, 0);
		assert.equal(w.closed, true);
	});

	it("an unknown id is undefined; a closed widget without a still has no image", async () => {
		const { manager, setState } = setup();
		assert.equal(await manager.check("nope"), undefined);
		setState("closed");
		const r = await manager.check("w1");
		assert.equal(r?.image, undefined);
		assert.match(formatCheck(r?.report as CheckReport), /Image: none available\./);
	});
});
