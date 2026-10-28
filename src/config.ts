// Optional user config at `<agentDir>/extensions/pi-interactive-widgets/config.json` (RQ15).
// A missing file selects the defaults; an invalid file is reported and the defaults apply.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeAllowHosts, type NetworkPolicy } from "./policy.js";

export const EXTENSION_NAME = "pi-interactive-widgets";

export interface WidgetConfig {
	/** Explicit chrome-headless-shell binary; default is the newest cached build. */
	chromePath?: string | undefined;
	/** Device pixel ratio passed to `--force-device-scale-factor`. */
	dpr: number;
	network: NetworkPolicy;
}

export const DEFAULT_CONFIG: WidgetConfig = { dpr: 2, network: { open: false, allowHosts: [] } };

export type ConfigResult = { ok: true; config: WidgetConfig } | { ok: false; config: WidgetConfig; reason: string };

export function configPath(agentDir: string): string {
	return join(agentDir, "extensions", EXTENSION_NAME, "config.json");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
	return Object.keys(obj).filter((k) => !allowed.includes(k));
}

/** Validates parsed JSON; returns the config or the first problem found. */
export function parseConfig(value: unknown): { config: WidgetConfig } | { reason: string } {
	if (!isRecord(value)) return { reason: "must be a JSON object" };
	const extra = unknownKeys(value, ["chromePath", "dpr", "network"]);
	if (extra.length) return { reason: `unknown key ${extra.map((k) => JSON.stringify(k)).join(", ")}` };
	const config: WidgetConfig = { dpr: DEFAULT_CONFIG.dpr, network: { open: false, allowHosts: [] } };
	if (value.chromePath !== undefined) {
		if (typeof value.chromePath !== "string" || !value.chromePath.trim()) return { reason: "chromePath must be a non-empty string" };
		config.chromePath = value.chromePath;
	}
	if (value.dpr !== undefined) {
		if (typeof value.dpr !== "number" || !Number.isFinite(value.dpr) || value.dpr < 1 || value.dpr > 4) return { reason: "dpr must be a number from 1 to 4" };
		config.dpr = value.dpr;
	}
	if (value.network !== undefined) {
		const net = value.network;
		if (!isRecord(net)) return { reason: "network must be an object" };
		const extraNet = unknownKeys(net, ["open", "allowHosts"]);
		if (extraNet.length) return { reason: `unknown key network.${extraNet.join(", network.")}` };
		if (net.open !== undefined) {
			if (typeof net.open !== "boolean") return { reason: "network.open must be true or false" };
			config.network = { ...config.network, open: net.open };
		}
		if (net.allowHosts !== undefined) {
			const hosts = net.allowHosts;
			if (!Array.isArray(hosts) || !hosts.every((h): h is string => typeof h === "string")) return { reason: "network.allowHosts must be an array of strings" };
			const bad = hosts.filter((h) => normalizeAllowHosts([h]).length === 0);
			if (bad.length) return { reason: `invalid network.allowHosts entry ${JSON.stringify(bad[0])}` };
			config.network = { ...config.network, allowHosts: normalizeAllowHosts(hosts) };
		}
	}
	return { config };
}

/** Reads the config file; never throws. */
export async function loadConfig(path: string): Promise<ConfigResult> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, config: DEFAULT_CONFIG };
		return { ok: false, config: DEFAULT_CONFIG, reason: `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, config: DEFAULT_CONFIG, reason: `invalid JSON in ${path}` };
	}
	const result = parseConfig(parsed);
	if ("reason" in result) return { ok: false, config: DEFAULT_CONFIG, reason: `invalid config ${path}: ${result.reason}` };
	return { ok: true, config: result.config };
}
