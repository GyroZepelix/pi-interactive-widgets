// Environment detection unit tests (RQ14); tmux is replaced by a fake query.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssCellSize, detectEnvironment, type TmuxQuery, tmuxCellSize } from "../src/env.js";

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
