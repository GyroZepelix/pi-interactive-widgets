import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { configPath, DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.js";

const dir = mkdtempSync(join(tmpdir(), "piw-config-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, content: string): string => {
	const p = join(dir, name);
	writeFileSync(p, content);
	return p;
};

describe("config", () => {
	it("lives under the agent dir", () => {
		assert.equal(configPath("/a/agent"), "/a/agent/extensions/pi-interactive-widgets/config.json");
	});
	it("uses the defaults when the file is missing", async () => {
		assert.deepEqual(await loadConfig(join(dir, "missing.json")), { ok: true, config: DEFAULT_CONFIG });
	});
	it("parses every field", async () => {
		const r = await loadConfig(file("full.json", JSON.stringify({ chromePath: "/x/chrome", dpr: 1.5, network: { open: true, allowHosts: ["API.example.com", "127.0.0.1:5173"] } })));
		assert.deepEqual(r, { ok: true, config: { chromePath: "/x/chrome", dpr: 1.5, network: { open: true, allowHosts: ["api.example.com", "127.0.0.1:5173"] } } });
		assert.deepEqual(parseConfig({}), { config: DEFAULT_CONFIG });
	});
	it("reports invalid files and falls back to the defaults", async () => {
		const cases: [string, RegExp][] = [
			["{ nope", /invalid JSON/],
			["[]", /must be a JSON object/],
			['{"dpr":"two"}', /dpr must be a number from 1 to 4/],
			['{"dpr":9}', /dpr must be a number/],
			['{"chromePath":""}', /chromePath must be a non-empty string/],
			['{"network":{"open":"yes"}}', /network.open must be true or false/],
			['{"network":{"allowHosts":"a.com"}}', /allowHosts must be an array of strings/],
			['{"network":{"allowHosts":["evil.com; script-src *"]}}', /invalid network.allowHosts entry/],
			['{"network":{"allow":[]}}', /unknown key network.allow/],
			['{"chrome":"x"}', /unknown key "chrome"/],
		];
		for (const [i, [content, reason]] of cases.entries()) {
			const r = await loadConfig(file(`bad-${i}.json`, content));
			assert.equal(r.ok, false, content);
			assert.deepEqual(r.config, DEFAULT_CONFIG);
			assert.match(r.ok ? "" : r.reason, reason, content);
		}
	});
});
