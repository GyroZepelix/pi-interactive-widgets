// Network policy for widget pages: CSP builder, host allowlist, and local-address classification (RQ09).
import { isIP } from "node:net";

export const CDN_HOSTS: readonly string[] = [
	"cdnjs.cloudflare.com",
	"cdn.jsdelivr.net",
	"unpkg.com",
	"esm.sh",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
];

export interface NetworkPolicy {
	/** Lift the CDN allowlist; local addresses stay blocked unless listed. */
	open: boolean;
	/** Extra hosts: `example.com`, `*.example.com`, or `host:port`. Listed hosts bypass local-address blocking. */
	allowHosts: readonly string[];
}

export const DEFAULT_POLICY: NetworkPolicy = { open: false, allowHosts: [] };

export type RequestVerdict = { allow: true } | { allow: false; reason: string };

const HOST_ENTRY = /^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;

/** Keeps only syntactically valid allowHosts entries (lowercased), so nothing else can reach the CSP header. */
export function normalizeAllowHosts(entries: readonly string[]): string[] {
	const out: string[] = [];
	for (const raw of entries) {
		const e = raw.trim().toLowerCase();
		if (e && HOST_ENTRY.test(e) && !out.includes(e)) out.push(e);
	}
	return out;
}

function sources(host: string): string {
	return [`https://${host}`, `http://${host}`, `wss://${host}`, `ws://${host}`].join(" ");
}

/** Builds the Content-Security-Policy header sent with every widget-origin response. */
export function buildCsp(policy: NetworkPolicy): string {
	const extra = normalizeAllowHosts(policy.allowHosts).map(sources).join(" ");
	const cdn = CDN_HOSTS.map((h) => `https://${h}`).join(" ");
	const fixed = ["frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "worker-src 'self' blob:"];
	if (policy.open) {
		const any = "'self' https: http: data: blob:";
		return [
			`default-src ${any}`,
			`script-src ${any} 'unsafe-inline' 'unsafe-eval'`,
			`style-src ${any} 'unsafe-inline'`,
			`font-src ${any}`,
			`img-src ${any}`,
			`media-src ${any}`,
			`connect-src 'self' https: http: wss: ws: data: blob:`,
			...fixed,
		].join("; ");
	}
	const plus = extra ? ` ${extra}` : "";
	return [
		`default-src 'self' data: blob:${plus}`,
		`script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${cdn}${plus}`,
		`style-src 'self' 'unsafe-inline' ${cdn}${plus}`,
		`font-src 'self' data: ${cdn}${plus}`,
		`img-src 'self' data: blob:${plus}`,
		`media-src 'self' data: blob:${plus}`,
		`connect-src 'self'${plus}`,
		...fixed,
	].join("; ");
}

function ipv4Octets(host: string): number[] | undefined {
	if (isIP(host) !== 4) return undefined;
	return host.split(".").map(Number);
}

function isLocalIpv4(o: number[]): boolean {
	const [a = 0, b = 0] = o;
	return (
		a === 0 || // this network
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) || // CGNAT, Tailscale
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224 // multicast and reserved
	);
}

function isLocalIpv6(host: string): boolean {
	const h = host.toLowerCase();
	if (h === "::" || h === "::1") return true;
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
	if (mapped?.[1]) {
		const o = ipv4Octets(mapped[1]);
		return o ? isLocalIpv4(o) : true;
	}
	if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true; // mapped IPv4 in hex form, treat as local
	const first = Number.parseInt(h.split(":")[0] || "0", 16);
	return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

/** True for localhost, private, link-local, CGNAT/Tailscale, `*.local`, and `*.ts.net` hosts. Expects a URL-parsed hostname. */
export function isLocalHost(hostname: string): boolean {
	let h = hostname.toLowerCase().replace(/\.$/, "");
	if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	if (h.endsWith(".local") || h.endsWith(".ts.net") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
	const v4 = ipv4Octets(h);
	if (v4) return isLocalIpv4(v4);
	if (isIP(h) === 6) return isLocalIpv6(h);
	return !h.includes("."); // single-label names resolve through local search domains
}

/** Matches a normalized allowHosts entry against a URL host (hostname plus optional explicit port). */
export function hostListed(entries: readonly string[], url: URL): boolean {
	const host = url.hostname.toLowerCase();
	const port = url.port || (url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80");
	for (const e of normalizeAllowHosts(entries)) {
		const m = /^(.*?)(?::(\d+))?$/.exec(e);
		const name = m?.[1] ?? e;
		const p = m?.[2];
		if (p && p !== port) continue;
		if (name.startsWith("*.") ? host.endsWith(name.slice(1)) : host === name) return true;
	}
	return false;
}

/** Decides a request to a host other than the widget origin. CSP remains the first layer; this is the network layer. */
export function checkRequest(rawUrl: string, policy: NetworkPolicy): RequestVerdict {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { allow: false, reason: "invalid url" };
	}
	if (url.protocol === "data:" || url.protocol === "blob:") return { allow: true };
	if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return { allow: false, reason: `scheme ${url.protocol} not allowed` };
	if (hostListed(policy.allowHosts, url)) return { allow: true };
	if (isLocalHost(url.hostname)) return { allow: false, reason: "local address blocked" };
	if (policy.open) return { allow: true };
	if (CDN_HOSTS.includes(url.hostname.toLowerCase())) return { allow: true };
	return { allow: false, reason: "host not in allowlist" };
}
