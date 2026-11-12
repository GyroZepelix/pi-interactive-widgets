// Environment detection unit tests (RQ14); tmux is replaced by a fake query.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssCellSize, detectEnvironment, type Environment, passthroughNotice, pointerMotionReported, type TmuxQuery, tmuxCellSize } from "../src/env.js";

const fake =
	(answers: Record<string, string>): TmuxQuery =>
	(format) => {
		const a = answers[format];
		if (a === undefined) throw new Error(`unexpected tmux query ${format}`);
		return a;
	};
const failing: TmuxQuery = () => {
	throw new Error("tmux unavailable");
};
const TMUX = "/private/tmp/tmux-501/default,1,0";

describe("detectEnvironment", () => {
	it("tmux + Ghostty is supported and wrapped", () => {
		const e = detectEnvironment({ TMUX, TERM_PROGRAM: "tmux" }, fake({ "#{client_termname}": "xterm-ghostty" }));
		assert.deepEqual(e, { kind: "tmux-ghostty", supported: true, tmux: true, clientTerm: "xterm-ghostty" });
	});

	it("tmux + kitty is supported", () => {
		const e = detectEnvironment({ TMUX }, fake({ "#{client_termname}": "xterm-kitty" }));
		assert.equal(e.kind, "tmux-kitty");
		assert.equal(e.supported, true);
		assert.equal(e.tmux, true);
	});

	it("tmux + another terminal is unsupported, even when TERM_PROGRAM says Ghostty", () => {
		for (const term of ["xterm-256color", "screen-256color", ""]) {
			const e = detectEnvironment({ TMUX, TERM_PROGRAM: "ghostty" }, fake({ "#{client_termname}": term }));
			assert.equal(e.kind, "tmux-other", term);
			assert.equal(e.supported, false);
		}
		assert.equal(detectEnvironment({ TMUX }, failing).kind, "tmux-other", "a failing tmux query is unsupported");
	});

	it("plain Ghostty without tmux is supported and unwrapped", () => {
		assert.deepEqual(detectEnvironment({ TERM_PROGRAM: "ghostty" }, failing), { kind: "ghostty", supported: true, tmux: false });
	});

	it("anything else is unsupported", () => {
		for (const env of [{}, { TERM_PROGRAM: "iTerm.app" }, { TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-kitty" }]) {
			assert.deepEqual(detectEnvironment(env, failing), { kind: "unsupported", supported: false, tmux: false });
		}
	});
});

describe("cell size", () => {
	it("reads the tmux client cell size in device pixels", () => {
		assert.deepEqual(tmuxCellSize(fake({ "#{client_cell_width} #{client_cell_height}": "16 34" })), { width: 16, height: 34 });
		assert.equal(tmuxCellSize(fake({ "#{client_cell_width} #{client_cell_height}": "0 0" })), undefined);
		assert.equal(tmuxCellSize(fake({ "#{client_cell_width} #{client_cell_height}": " " })), undefined);
		assert.equal(tmuxCellSize(failing), undefined);
	});

	it("converts to CSS pixels at the browser DPR", () => {
		assert.deepEqual(cssCellSize({ width: 16, height: 34 }, 2), { width: 8, height: 17 });
	});
});

describe("pointerMotionReported (Pi's multiplexer condition, PD09)", () => {
	it("is false under tmux, Zellij, or screen, including empty markers and TERM prefixes", () => {
		assert.equal(pointerMotionReported({ TMUX }), false);
		assert.equal(pointerMotionReported({ TMUX: "" }), false);
		assert.equal(pointerMotionReported({ ZELLIJ: "0" }), false);
		assert.equal(pointerMotionReported({ STY: "123.pts" }), false);
		assert.equal(pointerMotionReported({ TERM: "tmux-256color" }), false);
		assert.equal(pointerMotionReported({ TERM: "Screen.xterm-256color" }), false);
	});
	it("is true in a plain terminal", () => {
		assert.equal(pointerMotionReported({ TERM: "xterm-ghostty", TERM_PROGRAM: "ghostty" }), true);
		assert.equal(pointerMotionReported({}), true);
	});
});

describe("passthroughNotice (PD04)", () => {
	const ghostty: Environment = { kind: "tmux-ghostty", supported: true, tmux: true, clientTerm: "xterm-ghostty" };
	const q = (value: string): TmuxQuery => fake({ "#{allow-passthrough}": value });

	it("warns under supported tmux when allow-passthrough is on, naming the tmux.conf fix", () => {
		const n = passthroughNotice(ghostty, q("on"));
		assert.match(n ?? "", /allow-passthrough is "on".*go blank.*set -g allow-passthrough all/);
		assert.ok(passthroughNotice({ ...ghostty, kind: "tmux-kitty" }, q("on\n")));
	});

	it("stays silent for all, off, an unknown value, or a failing query", () => {
		for (const v of ["all", "off", ""]) assert.equal(passthroughNotice(ghostty, q(v)), undefined, v);
		assert.equal(passthroughNotice(ghostty, failing), undefined);
	});

	it("never queries tmux outside a supported tmux session", () => {
		assert.equal(passthroughNotice({ kind: "ghostty", supported: true, tmux: false }, failing), undefined);
		assert.equal(passthroughNotice({ kind: "tmux-other", supported: false, tmux: true }, () => assert.fail("queried")), undefined);
		assert.equal(passthroughNotice({ kind: "ghostty", supported: true, tmux: false }, () => assert.fail("queried")), undefined);
	});
});
