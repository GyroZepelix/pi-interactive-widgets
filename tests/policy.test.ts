import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCsp, CDN_HOSTS, checkRequest, hostListed, isLocalHost, normalizeAllowHosts } from "../src/policy.js";

describe("isLocalHost", () => {
	for (const h of [
		"localhost",
		"app.localhost",
		"127.0.0.1",
		"127.8.9.1",
		"0.0.0.0",
		"10.1.2.3",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"100.100.100.100",
		"100.127.255.255",
		"printer.local",
		"box.tail1234.ts.net",
		"intranet",
		"[::1]",
		"::1",
		"[fd7a:115c:a1e0::1]",
		"fe80::1",
		"[::ffff:127.0.0.1]",
		"::ffff:7f00:1",
	]) {
		it(`treats ${h} as local`, () => assert.equal(isLocalHost(h), true));
	}
	for (const h of ["example.com", "cdn.jsdelivr.net", "8.8.8.8", "172.32.0.1", "100.128.0.1", "100.63.255.255", "2606:4700::1111", "[2001:db8::1]"]) {
		it(`treats ${h} as public`, () => assert.equal(isLocalHost(h), false));
	}
	it("relies on WHATWG URL canonicalization for odd IPv4 forms", () => {
		assert.equal(isLocalHost(new URL("http://2130706433/").hostname), true);
		assert.equal(isLocalHost(new URL("http://0x7f.1/").hostname), true);
	});
});

describe("allowHosts", () => {
	it("drops invalid entries that could inject CSP", () => {
		assert.deepEqual(normalizeAllowHosts(["Example.com", "evil.com; script-src *", "*.ok.dev", "h:8080", "", "example.com"]), [
			"example.com",
			"*.ok.dev",
			"h:8080",
		]);
	});
	it("matches hosts, wildcards, and ports", () => {
		assert.equal(hostListed(["api.example.com"], new URL("https://api.example.com/x")), true);
		assert.equal(hostListed(["*.example.com"], new URL("https://a.b.example.com/")), true);
		assert.equal(hostListed(["*.example.com"], new URL("https://example.com/")), false);
		assert.equal(hostListed(["127.0.0.1:5173"], new URL("http://127.0.0.1:5173/")), true);
		assert.equal(hostListed(["127.0.0.1:5173"], new URL("http://127.0.0.1:5174/")), false);
		assert.equal(hostListed(["localhost"], new URL("http://localhost:3000/")), true);
	});
});

describe("checkRequest", () => {
	const closed = { open: false, allowHosts: [] };
	const open = { open: true, allowHosts: [] };
	it("default mode allows only CDN hosts", () => {
		assert.deepEqual(checkRequest("https://cdn.jsdelivr.net/npm/x.js", closed), { allow: true });
		assert.equal(checkRequest("https://example.com/x.js", closed).allow, false);
	});
	it("open mode allows public hosts and blocks local ones", () => {
		assert.deepEqual(checkRequest("https://example.com/", open), { allow: true });
		for (const u of ["http://localhost:8080/", "http://127.0.0.1/", "https://192.168.1.1/", "https://100.100.100.100/", "https://x.ts.net/", "http://nas.local/"]) {
			assert.deepEqual(checkRequest(u, open), { allow: false, reason: "local address blocked" }, u);
		}
	});
	it("listed hosts pass even when local", () => {
		assert.deepEqual(checkRequest("http://127.0.0.1:5173/api", { open: true, allowHosts: ["127.0.0.1:5173"] }), { allow: true });
		assert.deepEqual(checkRequest("https://api.example.com/", { open: false, allowHosts: ["api.example.com"] }), { allow: true });
	});
	it("rejects other schemes", () => {
		assert.equal(checkRequest("ftp://example.com/", open).allow, false);
	});
});

describe("buildCsp", () => {
	const directive = (csp: string, name: string): string => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
	it("default policy limits scripts to the CDN allowlist and connect to self", () => {
		const csp = buildCsp({ open: false, allowHosts: [] });
		for (const h of ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "esm.sh"]) assert.match(directive(csp, "script-src"), new RegExp(`https://${h.replace(/\./g, "\\.")}`));
		assert.match(directive(csp, "style-src"), /https:\/\/fonts\.googleapis\.com/);
		assert.match(directive(csp, "font-src"), /https:\/\/fonts\.gstatic\.com/);
		assert.equal(directive(csp, "connect-src"), "connect-src 'self'");
		assert.equal(directive(csp, "img-src"), "img-src 'self' data: blob:");
		assert.equal(directive(csp, "form-action"), "form-action 'none'");
		assert.equal(directive(csp, "object-src"), "object-src 'none'");
		assert.equal(CDN_HOSTS.length, 6);
	});
	it("adds allowHosts to every fetch directive", () => {
		const csp = buildCsp({ open: false, allowHosts: ["api.example.com"] });
		assert.match(directive(csp, "connect-src"), /https:\/\/api\.example\.com/);
		assert.match(directive(csp, "script-src"), /https:\/\/api\.example\.com/);
	});
	it("open mode lifts the allowlist but keeps form and object restrictions", () => {
		const csp = buildCsp({ open: true, allowHosts: [] });
		assert.match(directive(csp, "connect-src"), /https:/);
		assert.equal(directive(csp, "form-action"), "form-action 'none'");
		assert.equal(directive(csp, "object-src"), "object-src 'none'");
	});
});
