// Kitty graphics transport: Unicode-placeholder grids, chunked PNG `t=d` uploads, tmux DCS wrapping,
// deletes, image ids, and scaled sends (RQ02 grid, RQ04 transport, RQ12). Frames stay base64 strings in RAM.
import { randomInt } from "node:crypto";

export const PLACEHOLDER = String.fromCodePoint(0x10eeee);

/** First 256 row/column diacritics of kitty's `rowcolumn-diacritics.txt` (index = row or column). */
export const DIACRITICS: readonly string[] = `
0305 030D 030E 0310 0312 033D 033E 033F 0346 034A 034B 034C 0350 0351 0352 0357
035B 0363 0364 0365 0366 0367 0368 0369 036A 036B 036C 036D 036E 036F 0483 0484
0485 0486 0487 0592 0593 0594 0595 0597 0598 0599 059C 059D 059E 059F 05A0 05A1
05A8 05A9 05AB 05AC 05AF 05C4 0610 0611 0612 0613 0614 0615 0616 0617 0657 0658
0659 065A 065B 065D 065E 06D6 06D7 06D8 06D9 06DA 06DB 06DC 06DF 06E0 06E1 06E2
06E4 06E7 06E8 06EB 06EC 0730 0732 0733 0735 0736 073A 073D 073F 0740 0741 0743
0745 0747 0749 074A 07EB 07EC 07ED 07EE 07EF 07F0 07F1 07F3 0816 0817 0818 0819
081B 081C 081D 081E 081F 0820 0821 0822 0823 0825 0826 0827 0829 082A 082B 082C
082D 0951 0953 0954 0F82 0F83 0F86 0F87 135D 135E 135F 17DD 193A 1A17 1A75 1A76
1A77 1A78 1A79 1A7A 1A7B 1A7C 1B6B 1B6D 1B6E 1B6F 1B70 1B71 1B72 1B73 1CD0 1CD1
1CD2 1CDA 1CDB 1CE0 1DC0 1DC1 1DC3 1DC4 1DC5 1DC6 1DC7 1DC8 1DC9 1DCB 1DCC 1DD1
1DD2 1DD3 1DD4 1DD5 1DD6 1DD7 1DD8 1DD9 1DDA 1DDB 1DDC 1DDD 1DDE 1DDF 1DE0 1DE1
1DE2 1DE3 1DE4 1DE5 1DE6 1DFE 20D0 20D1 20D4 20D5 20D6 20D7 20DB 20DC 20E1 20E7
20E9 20F0 2CEF 2CF0 2CF1 2DE0 2DE1 2DE2 2DE3 2DE4 2DE5 2DE6 2DE7 2DE8 2DE9 2DEA
2DEB 2DEC 2DED 2DEE 2DEF 2DF0 2DF1 2DF2 2DF3 2DF4 2DF5 2DF6 2DF7 2DF8 2DF9 2DFA
2DFB 2DFC 2DFD 2DFE 2DFF A66F A67C A67D A6F0 A6F1 A8E0 A8E1 A8E2 A8E3 A8E4 A8E5
`
	.trim()
	.split(/\s+/)
	.map((h) => String.fromCodePoint(Number.parseInt(h, 16)));

/** Maximum placeholder cells per axis. */
export const MAX_CELLS = 256;
/** Largest image id that fits the 24-bit foreground color (no third diacritic). */
export const MAX_IMAGE_ID = 0xffffff;
/** Maximum base64 payload bytes per kitty command. */
export const CHUNK_SIZE = 4096;

const ESC = "\x1b";

function checkId(id: number): void {
	if (!Number.isInteger(id) || id < 1 || id > MAX_IMAGE_ID) throw new RangeError(`image id ${id} outside 1..${MAX_IMAGE_ID}`);
}

function checkCells(cols: number, rows: number): void {
	for (const [name, n] of [
		["cols", cols],
		["rows", rows],
	] as const) {
		if (!Number.isInteger(n) || n < 1 || n > MAX_CELLS) throw new RangeError(`${name} ${n} outside 1..${MAX_CELLS}`);
	}
}

/** One text line per row: placeholder cells with row and column diacritics, image id in the 24-bit foreground. */
export function placeholderLines(imageId: number, cols: number, rows: number): string[] {
	checkId(imageId);
	checkCells(cols, rows);
	const color = `${ESC}[38;2;${(imageId >> 16) & 255};${(imageId >> 8) & 255};${imageId & 255}m`;
	const lines: string[] = [];
	for (let y = 0; y < rows; y++) {
		let s = color;
		const row = PLACEHOLDER + DIACRITICS[y];
		for (let x = 0; x < cols; x++) s += row + DIACRITICS[x];
		lines.push(`${s}${ESC}[39m`);
	}
	return lines;
}

/** Wraps an escape sequence in tmux DCS passthrough, doubling every inner ESC. */
export function wrapTmux(seq: string): string {
	return `${ESC}Ptmux;${seq.replaceAll(ESC, ESC + ESC)}${ESC}\\`;
}

export interface TransportOptions {
	/** Wrap each command in tmux DCS passthrough. */
	tmux: boolean;
}

function command(keys: string, payload: string, opts: TransportOptions): string {
	const apc = `${ESC}_G${keys}${payload ? `;${payload}` : ""}${ESC}\\`;
	return opts.tmux ? wrapTmux(apc) : apc;
}

/**
 * Builds the complete upload of one base64 PNG as a virtual placement for Unicode placeholders.
 * Only the first chunk carries keys; every chunk is at most `CHUNK_SIZE` base64 bytes and wrapped separately.
 */
export function uploadCommand(imageId: number, base64Png: string, cols: number, rows: number, opts: TransportOptions): string {
	checkId(imageId);
	checkCells(cols, rows);
	if (!base64Png) throw new RangeError("empty frame");
	let out = "";
	for (let i = 0; i < base64Png.length; i += CHUNK_SIZE) {
		const more = i + CHUNK_SIZE < base64Png.length ? 1 : 0;
		const keys = i === 0 ? `a=T,t=d,f=100,U=1,i=${imageId},c=${cols},r=${rows},q=2,m=${more}` : `m=${more}`;
		out += command(keys, base64Png.slice(i, i + CHUNK_SIZE), opts);
	}
	return out;
}

/** Deletes an image and its data from terminal memory. */
export function deleteCommand(imageId: number, opts: TransportOptions): string {
	checkId(imageId);
	return command(`a=d,d=I,i=${imageId},q=2`, "", opts);
}

export interface IdRange {
	min: number;
	max: number;
}

/** Random image ids, never reused in this allocator's lifetime (one allocator per process). */
export class ImageIdAllocator {
	readonly range: IdRange;
	private readonly used = new Set<number>();

	constructor(range: IdRange = { min: 1, max: MAX_IMAGE_ID }) {
		checkId(range.min);
		checkId(range.max);
		if (range.min > range.max) throw new RangeError("empty image id range");
		this.range = range;
	}

	/** Every id handed out so far. */
	get allocated(): readonly number[] {
		return [...this.used];
	}

	next(): number {
		const size = this.range.max - this.range.min + 1;
		if (this.used.size >= size) throw new Error("image id range exhausted");
		for (;;) {
			const id = this.range.min + randomInt(size);
			if (!this.used.has(id)) {
				this.used.add(id);
				return id;
			}
		}
	}
}

/** Process-wide allocator for widget image ids. */
export const imageIds = new ImageIdAllocator();

export interface CellBox {
	cols: number;
	rows: number;
	/** Displayed size / page size; 1 means full size. Mouse mapping divides by it. */
	scale: number;
}

/**
 * Cells for a widget sent scaled to fit `maxCols` (RQ12). Width limits the fit: rows round up so the
 * terminal's aspect-preserving fit fills the width exactly, leaving at most half a cell above and below.
 */
export function fitCells(cols: number, rows: number, maxCols: number): CellBox {
	checkCells(cols, rows);
	if (maxCols >= cols) return { cols, rows, scale: 1 };
	const fitCols = Math.max(1, Math.floor(maxCols));
	const scale = fitCols / cols;
	return { cols: fitCols, rows: Math.max(1, Math.min(MAX_CELLS, Math.ceil(rows * scale))), scale };
}

/** Sends frames of one image: skips byte-identical frames at the same size and writes each upload once. */
export class KittyImage {
	readonly id: number;
	private readonly write: (data: string) => void;
	private readonly opts: TransportOptions;
	private last: { data: string; cols: number; rows: number } | undefined;

	constructor(id: number, opts: TransportOptions, write: (data: string) => void = (d) => void process.stdout.write(d)) {
		checkId(id);
		this.id = id;
		this.opts = opts;
		this.write = write;
	}

	/** Uploads the frame at `cols` x `rows` cells; returns false when it was identical to the last upload. */
	send(base64Png: string, cols: number, rows: number): boolean {
		const l = this.last;
		if (l && l.cols === cols && l.rows === rows && l.data === base64Png) return false;
		this.write(uploadCommand(this.id, base64Png, cols, rows, this.opts));
		this.last = { data: base64Png, cols, rows };
		return true;
	}

	/** Re-sends the last frame (scaled send or recovery); returns false when nothing was sent yet. */
	resend(cols: number, rows: number): boolean {
		if (!this.last) return false;
		this.write(uploadCommand(this.id, this.last.data, cols, rows, this.opts));
		this.last = { ...this.last, cols, rows };
		return true;
	}

	lines(cols: number, rows: number): string[] {
		return placeholderLines(this.id, cols, rows);
	}

	delete(): void {
		this.write(deleteCommand(this.id, this.opts));
		this.last = undefined;
	}
}
