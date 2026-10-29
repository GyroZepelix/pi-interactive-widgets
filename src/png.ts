// Dependency-free PNG size, decode, box downscale, and encode for `check_widget` images (RQ05). In RAM only.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Size {
	width: number;
	height: number;
}

interface Rgba extends Size {
	/** 4 bytes per pixel, row-major. */
	data: Uint8Array;
}

/** Width and height from a PNG header. */
export function pngSize(png: Buffer): Size {
	if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decodes an 8-bit, non-interlaced grayscale, RGB, or RGBA PNG (what Chromium produces) to RGBA. */
export function decodePng(png: Buffer): Rgba {
	const { width, height } = pngSize(png);
	let depth = 0;
	let color = -1;
	let interlace = 0;
	const idat: Buffer[] = [];
	for (let at = 8; at + 8 <= png.length; ) {
		const len = png.readUInt32BE(at);
		const type = png.toString("latin1", at + 4, at + 8);
		const body = png.subarray(at + 8, at + 8 + len);
		if (type === "IHDR") {
			depth = body[8] ?? 0;
			color = body[9] ?? -1;
			interlace = body[12] ?? 0;
		} else if (type === "IDAT") idat.push(body);
		else if (type === "IEND") break;
		at += 12 + len;
	}
	const channels = CHANNELS[color];
	if (depth !== 8 || !channels || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, color type ${color}, interlace ${interlace})`);
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	if (raw.length < height * (stride + 1)) throw new Error("truncated PNG data");
	const out = new Uint8Array(width * height * 4);
	let prev = new Uint8Array(stride);
	let line = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? (line[i - channels] ?? 0) : 0;
			const b = prev[i] ?? 0;
			const c = i >= channels ? (prev[i - channels] ?? 0) : 0;
			const x = src[i] ?? 0;
			let v: number;
			if (filter === 0) v = x;
			else if (filter === 1) v = x + a;
			else if (filter === 2) v = x + b;
			else if (filter === 3) v = x + ((a + b) >> 1);
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
			} else throw new Error(`bad PNG filter ${filter}`);
			line[i] = v & 255;
		}
		for (let px = 0; px < width; px++) {
			const o = (y * width + px) * 4;
			const s = px * channels;
			if (channels >= 3) {
				out[o] = line[s] ?? 0;
				out[o + 1] = line[s + 1] ?? 0;
				out[o + 2] = line[s + 2] ?? 0;
			} else out[o] = out[o + 1] = out[o + 2] = line[s] ?? 0;
			out[o + 3] = channels === 4 ? (line[s + 3] ?? 255) : channels === 2 ? (line[s + 1] ?? 255) : 255;
		}
		[prev, line] = [line, prev];
	}
	return { width, height, data: out };
}

function chunk(type: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
	return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG (Sub filter on every row). */
export function encodePng(img: Rgba): Buffer {
	const { width, height, data } = img;
	const stride = width * 4;
	const raw = Buffer.alloc(height * (stride + 1));
	for (let y = 0; y < height; y++) {
		const o = y * (stride + 1);
		raw[o] = 1;
		for (let i = 0; i < stride; i++) {
			const v = data[y * stride + i] ?? 0;
			const left = i >= 4 ? (data[y * stride + i - 4] ?? 0) : 0;
			raw[o + 1 + i] = (v - left) & 255;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Area-averaging downscale to `width` x `height` (each at most the source size). */
export function downscale(img: Rgba, width: number, height: number): Rgba {
	const out = new Uint8Array(width * height * 4);
	const sx = img.width / width;
	const sy = img.height / height;
	for (let y = 0; y < height; y++) {
		const y0 = y * sy;
		const y1 = Math.min(img.height, y0 + sy);
		for (let x = 0; x < width; x++) {
			const x0 = x * sx;
			const x1 = Math.min(img.width, x0 + sx);
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let total = 0;
			for (let yy = Math.floor(y0); yy < y1; yy++) {
				const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
				for (let xx = Math.floor(x0); xx < x1; xx++) {
					const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
					const i = (yy * img.width + xx) * 4;
					r += (img.data[i] ?? 0) * w;
					g += (img.data[i + 1] ?? 0) * w;
					b += (img.data[i + 2] ?? 0) * w;
					a += (img.data[i + 3] ?? 0) * w;
					total += w;
				}
			}
			const o = (y * width + x) * 4;
			out[o] = Math.round(r / total);
			out[o + 1] = Math.round(g / total);
			out[o + 2] = Math.round(b / total);
			out[o + 3] = Math.round(a / total);
		}
	}
	return { width, height, data: out };
}

/** Target size with the long edge at most `maxEdge`, keeping the aspect ratio. */
export function fitSize(size: Size, maxEdge: number): Size {
	const long = Math.max(size.width, size.height);
	if (long <= maxEdge) return size;
	const k = maxEdge / long;
	return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

/**
 * Composites a base64 PNG with an alpha channel onto an opaque `#rrggbb` background (transparent widget pages,
 * RQ05), so viewers that show transparency as white or checkered still show the page as the terminal does. PNGs
 * without alpha pass through unchanged.
 */
export function flattenPng(base64: string, background: string): string {
	const png = Buffer.from(base64, "base64");
	pngSize(png);
	const color = png[25];
	if (color !== 4 && color !== 6) return base64;
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background);
	if (!m) throw new Error(`bad background color ${background}`);
	const bg = [m[1], m[2], m[3]].map((h) => Number.parseInt(h ?? "0", 16));
	const img = decodePng(png);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const a = (d[i + 3] ?? 255) / 255;
		for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] ?? 0) * a + (bg[c] ?? 0) * (1 - a));
		d[i + 3] = 255;
	}
	return encodePng(img).toString("base64");
}

/** Returns a base64 PNG whose long edge is at most `maxEdge`; smaller images pass through unchanged. */
export function limitPng(base64: string, maxEdge: number): { data: string } & Size {
	const png = Buffer.from(base64, "base64");
	const size = pngSize(png);
	const target = fitSize(size, maxEdge);
	if (target === size) return { data: base64, ...size };
	const scaled = encodePng(downscale(decodePng(png), target.width, target.height));
	return { data: scaled.toString("base64"), ...target };
}
