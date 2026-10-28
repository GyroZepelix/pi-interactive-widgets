// E2E-only Pi extension: a scripted faux model (no network, no real model) that records every context it receives.
// A user prompt `e2e-tool <json>` makes the model call `show_widget` with those arguments; anything else answers "ok".
import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Msg = { role: string; content?: unknown; customType?: string; toolName?: string };

function text(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c: { type?: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
}

export default function e2eProbe(pi: ExtensionAPI): void {
	const log = process.env.PI_WIDGETS_E2E_TURNS;
	const faux = fauxProvider({ provider: "e2e-faux", models: [{ id: "echo", name: "e2e echo" }] });
	const respond = (context: { messages: Msg[] }) => {
		const messages = context.messages.filter((m) => m.role !== "system");
		if (log) appendFileSync(log, `${JSON.stringify({ t: Date.now(), messages: messages.map((m) => ({ role: m.role, customType: m.customType, toolName: m.toolName, text: text(m.content) })) })}\n`);
		const last = messages.at(-1);
		const prompt = last?.role === "user" ? text(last.content) : "";
		const m = /^e2e-tool (\{[\s\S]*\})\s*$/.exec(prompt);
		if (m?.[1]) return fauxAssistantMessage(fauxToolCall("show_widget", JSON.parse(m[1]) as Parameters<typeof fauxToolCall>[1]), { stopReason: "toolUse" });
		return fauxAssistantMessage("ok");
	};
	faux.setResponses(Array.from({ length: 200 }, () => respond));
	pi.registerProvider(faux.provider);
}
