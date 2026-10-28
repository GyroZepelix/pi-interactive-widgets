// Kitty transport unit tests: placeholder grid, chunking, tmux wrapping, deletes, ids, scaled sends.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHUNK_SIZE,
	DIACRITICS,
	deleteCommand,
	fitCells,
	ImageIdAllocator,
	KittyImage,
	MAX_CELLS,
	PLACEHOLDER,
	placeholderLines,
	uploadCommand,
	wrapTmux,
} from "../src/kitty.js";

const ESC = "\x1b";
const cp = (s: string | undefined): number => s?.codePointAt(0) ?? -1;

/** Splits plain (unwrapped) output into APC commands: [keys, payload]. */
function apcs(out: string): [string, string][] {
	const re = /\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\/g;
	const found: [string, string][] = [];
	let consumed = 0;
	for (const m of out.matchAll(re)) {
		assert.equal(m.index, consumed, "commands are contiguous");
		consumed += m[0].length;
		found.push([m[1] ?? "", m[2] ?? ""]);
	}
	assert.equal(consumed, out.length, "no stray bytes");
	return found;
}

/** Undoes tmux DCS wrapping, asserting every wrapped command is well formed. */
function unwrapTmux(out: string): string {
	const re = /\x1bPtmux;((?:\x1b\x1b|[^\x1b])*)\x1b\\/g;
	let consumed = 0;
	let inner = "";
	for (const m of out.matchAll(re)) {
		assert.equal(m.index, consumed, "wrapped commands are contiguous");
		consumed += m[0].length;
		const body = m[1] ?? "";
		assert.doesNotMatch(body.replaceAll(ESC + ESC, ""), /\x1b/, "every inner ESC is doubled");
		inner += body.replaceAll(ESC + ESC, ESC);
	}
	assert.equal(consumed, out.length, "everything is wrapped");
	return inner;
}

const b64 = (n: number): string => "A".repeat(n);

describe("diacritics table", () => {
	it("has 256 distinct entries matching kitty's rowcolumn-diacritics.txt", () => {
		assert.equal(DIACRITICS.length, MAX_CELLS);
		assert.equal(new Set(DIACRITICS).size, 256);
		assert.equal(cp(DIACRITICS[0]), 0x0305);
		assert.equal(cp(DIACRITICS[1]), 0x030d);
		assert.equal(cp(DIACRITICS[16]), 0x035b);
		assert.equal(cp(DIACRITICS[100]), 0x07eb);
		assert.equal(cp(DIACRITICS[255]), 0xa8e5);
	});
});

describe("placeholder grid", () => {
	it("encodes row and column diacritics and the 24-bit id in the foreground color", () => {
		const id = 0x12abcd;
		const lines = placeholderLines(id, 5, 3);
		assert.equal(lines.length, 3);
		for (const [y, line] of lines.entries()) {
			assert.ok(line.startsWith(`${ESC}[38;2;18;171;205m`), "id as RGB 0x12 0xab 0xcd");
			assert.ok(line.endsWith(`${ESC}[39m`), "foreground reset");
			const body = [...line.slice(`${ESC}[38;2;18;171;205m`.length, -`${ESC}[39m`.length)];
			assert.equal(body.length, 5 * 3, "three code points per cell");
			for (let x = 0; x < 5; x++) {
				assert.equal(body[x * 3], PLACEHOLDER);
				assert.equal(cp(body[x * 3]), 0x10eeee);
				assert.equal(body[x * 3 + 1], DIACRITICS[y], `row ${y}`);
				assert.equal(body[x * 3 + 2], DIACRITICS[x], `column ${x}`);
			}
		}
	});

	it("supports 256 cells per axis and rejects more, bad ids, and empty grids", () => {
		const lines = placeholderLines(1, 256, 256);
		assert.equal(lines.length, 256);
		assert.equal([...(lines[255] ?? "")].filter((c) => c === PLACEHOLDER).length, 256);
		assert.ok(lines[255]?.includes(PLACEHOLDER + DIACRITICS[255] + DIACRITICS[255]));
		assert.throws(() => placeholderLines(1, 257, 1), RangeError);
		assert.throws(() => placeholderLines(1, 1, 257), RangeError);
		assert.throws(() => placeholderLines(1, 0, 1), RangeError);
		assert.throws(() => placeholderLines(0, 1, 1), RangeError);
		assert.throws(() => placeholderLines(0x1000000, 1, 1), RangeError);
	});
});

describe("upload", () => {
	it("chunks base64 at 4096 bytes with m=1 until the last chunk, keys only on the first", () => {
		const data = b64(CHUNK_SIZE * 2 + 10);
		const cmds = apcs(uploadCommand(4242, data, 90, 18, { tmux: false }));
		assert.equal(cmds.length, 3);
		assert.equal(cmds[0]?.[0], "a=T,t=d,f=100,U=1,i=4242,c=90,r=18,q=2,m=1");
		assert.equal(cmds[1]?.[0], "m=1");
		assert.equal(cmds[2]?.[0], "m=0");
		for (const [, payload] of cmds) assert.ok(payload.length <= CHUNK_SIZE);
		assert.equal(cmds.map(([, p]) => p).join(""), data, "payload reassembles exactly");
	});

	it("uses a single m=0 command for small frames and exact multiples end with m=0", () => {
		const one = apcs(uploadCommand(7, b64(100), 2, 1, { tmux: false }));
		assert.deepEqual(one.map(([k]) => k), ["a=T,t=d,f=100,U=1,i=7,c=2,r=1,q=2,m=0"]);
		const exact = apcs(uploadCommand(7, b64(CHUNK_SIZE * 2), 2, 1, { tmux: false }));
		assert.deepEqual(exact.map(([k]) => k.replace(/^.*,m=/, "m=")), ["m=1", "m=0"]);
		assert.equal(exact[1]?.[1].length, CHUNK_SIZE);
	});

	it("wraps every chunk in tmux passthrough with every ESC doubled", () => {
		const data = b64(CHUNK_SIZE + 1);
		const plain = uploadCommand(99, data, 10, 4, { tmux: false });
		const wrapped = uploadCommand(99, data, 10, 4, { tmux: true });
		assert.equal(wrapped.match(/\x1bPtmux;/g)?.length, 2, "one passthrough per chunk");
		assert.equal(unwrapTmux(wrapped), plain);
		assert.equal(wrapTmux(`${ESC}_Ga=d${ESC}\\`), `${ESC}Ptmux;${ESC}${ESC}_Ga=d${ESC}${ESC}\\${ESC}\\`);
	});

	it("deletes with a=d,d=I and q=2", () => {
		assert.deepEqual(apcs(deleteCommand(5, { tmux: false })), [["a=d,d=I,i=5,q=2", ""]]);
		assert.deepEqual(apcs(unwrapTmux(deleteCommand(5, { tmux: true }))), [["a=d,d=I,i=5,q=2", ""]]);
	});
});

describe("KittyImage", () => {
	it("writes one string per frame, skips identical frames, and re-sends scaled with the requested cells", () => {
		const writes: string[] = [];
		const img = new KittyImage(321, { tmux: true }, (d) => writes.push(d));
		assert.equal(img.resend(10, 2), false, "nothing to re-send yet");
		assert.equal(img.send(b64(9000), 90, 18), true);
		assert.equal(img.send(b64(9000), 90, 18), false, "identical frame skipped");
		assert.equal(img.send(b64(9001), 90, 18), true);
		assert.equal(writes.length, 2, "one write per sent frame");
		assert.match(writes[1] ?? "", /^\x1bPtmux;\x1b\x1b_Ga=T,t=d,f=100,U=1,i=321,c=90,r=18,q=2,m=1;/);

		const fit = fitCells(90, 18, 45);
		assert.equal(img.resend(fit.cols, fit.rows), true);
		assert.equal(writes.length, 3);
		const cmds = apcs(unwrapTmux(writes[2] ?? ""));
		assert.match(cmds[0]?.[0] ?? "", /,c=45,r=9,q=2,/);
		assert.equal(cmds.map(([, p]) => p).join(""), b64(9001), "same frame re-sent");
		assert.equal(img.send(b64(9001), 45, 9), false, "same frame at the scaled size is skipped");
		assert.equal(img.send(b64(9001), 90, 18), true, "restoring full size re-sends");
		assert.equal(img.lines(45, 9).length, 9);

		img.delete();
		assert.deepEqual(apcs(unwrapTmux(writes.at(-1) ?? "")), [["a=d,d=I,i=321,q=2", ""]]);
	});
});

describe("fitCells", () => {
	it("keeps full size when it fits and scales by width otherwise", () => {
		assert.deepEqual(fitCells(90, 18, 90), { cols: 90, rows: 18, scale: 1 });
		assert.deepEqual(fitCells(90, 18, 200), { cols: 90, rows: 18, scale: 1 });
		assert.deepEqual(fitCells(90, 18, 45), { cols: 45, rows: 9, scale: 0.5 });
		const f = fitCells(100, 20, 63);
		assert.equal(f.cols, 63);
		assert.equal(f.rows, 13, "rows round up so width limits the fit");
		assert.equal(f.scale, 0.63);
		assert.deepEqual(fitCells(10, 3, 0), { cols: 1, rows: 1, scale: 0.1 });
	});
});

describe("ImageIdAllocator", () => {
	it("returns random ids within the range and never reuses one", () => {
		const a = new ImageIdAllocator({ min: 0xa1d000, max: 0xa1d0ff });
		const ids = Array.from({ length: 256 }, () => a.next());
		assert.equal(new Set(ids).size, 256);
		for (const id of ids) assert.ok(id >= 0xa1d000 && id <= 0xa1d0ff);
		assert.throws(() => a.next(), /exhausted/);
		assert.equal(a.allocated.length, 256);
		assert.throws(() => new ImageIdAllocator({ min: 0, max: 5 }), RangeError);
		assert.throws(() => new ImageIdAllocator({ min: 9, max: 5 }), RangeError);
	});
});
