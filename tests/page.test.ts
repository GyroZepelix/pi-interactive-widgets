import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BrowserHost, BrowserMissingError, findChromeHeadlessShell } from "../src/browser.js";
import { baseCss, wrapDocument } from "../src/page.js";

describe("wrapDocument", () => {
	it("wraps fragments in the shell", () => {
		const doc = wrapDocument("<p>hi</p>", "T<1>");
		assert.match(doc, /^<!doctype html><html><head><meta charset="utf-8"><title>T&#60;1&#62;<\/title><\/head><body><p>hi<\/p><\/body><\/html>$/);
	});
	it("serves full documents as written", () => {
		for (const d of ["<!DOCTYPE html><p>x</p>", "  <html><body></body></html>", "<!-- c --><!doctype html>x"]) assert.equal(wrapDocument(d), d);
	});
});

describe("baseCss", () => {
	it("layers base rules and injects valid theme variables only", () => {
		const css = baseCss({ "--pi-bg": "#101010", "--bad;": "x", "--pi-x": "red; } body { color: red" });
		assert.match(css, /^@layer pi-base \{/);
		assert.match(css, /color-scheme: dark; --pi-bg: #101010;/);
		assert.doesNotMatch(css, /--bad|--pi-x/);
		assert.match(css, /select \{ appearance: base-select; \}/);
	});
	it("RQ05: a transparent page leaves the body background unset unless the theme sets --pi-bg", () => {
		assert.match(baseCss({}, true), /body \{ background: var\(--pi-bg, transparent\);/);
		assert.match(baseCss({}), /body \{ background: var\(--pi-bg, #1e1e2e\);/);
	});
});

describe("findChromeHeadlessShell", () => {
	const dir = mkdtempSync(join(tmpdir(), "piw-cache-"));
	after(() => rmSync(dir, { recursive: true, force: true }));
	const make = (version: string): string => {
		const d = join(dir, "chrome-headless-shell", `mac_arm-${version}`, "chrome-headless-shell-mac-arm64");
		mkdirSync(d, { recursive: true });
		writeFileSync(join(d, "chrome-headless-shell"), "");
		return join(d, "chrome-headless-shell");
	};
	it("returns undefined without a cache", () => assert.equal(findChromeHeadlessShell(join(dir, "none")), undefined));
	it("picks the newest version numerically", () => {
		make("99.0.1000.1");
		const newest = make("156.0.8078.47");
		make("156.0.999.9");
		mkdirSync(join(dir, "chrome-headless-shell", "mac_arm-200.0.0.0"), { recursive: true }); // no binary inside
		assert.equal(findChromeHeadlessShell(dir), newest);
	});
	it("reports a missing binary with the install command", async () => {
		const host = new BrowserHost({ cacheDir: join(dir, "none") });
		await assert.rejects(host.newPage(), (e: unknown) => e instanceof BrowserMissingError && /npx @puppeteer\/browsers install chrome-headless-shell/.test(e.message));
		assert.equal(host.pageCount, 0);
		const bad = new BrowserHost({ chromePath: join(dir, "missing-binary") });
		await assert.rejects(bad.newPage(), BrowserMissingError);
	});
});
