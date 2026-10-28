import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapKey } from "../src/keys.js";

const downs = (data: string) => {
	const a = mapKey(data);
	assert.equal(a?.kind, "keys", JSON.stringify(data));
	return a?.kind === "keys" ? a.events : [];
};

describe("mapKey", () => {
	it("reserves Escape and Ctrl+C for release, including kitty CSI-u forms", () => {
		for (const d of ["\x1b", "\x03", "\x1b[27u", "\x1b[99;5u"]) assert.deepEqual(mapKey(d), { kind: "release" }, JSON.stringify(d));
	});
	it("maps printable characters to keyDown with text and keyUp", () => {
		assert.deepEqual(downs("a"), [
			{ type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0, text: "a", unmodifiedText: "a" },
			{ type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0 },
		]);
		assert.equal(downs("A")[0]?.text, "A");
		assert.equal(downs("7")[0]?.code, "Digit7");
		assert.equal(downs(" ")[0]?.text, " ");
		assert.equal(downs("é")[0]?.text, "é");
		assert.equal(downs("?")[0]?.windowsVirtualKeyCode, 0);
	});
	it("decodes kitty CSI-u printable keys", () => {
		assert.equal(downs("\x1b[97u")[0]?.text, "a");
	});
	it("maps special keys with modifiers", () => {
		assert.deepEqual(downs("\r"), [
			{ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0, text: "\r", unmodifiedText: "\r" },
			{ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0 },
		]);
		assert.deepEqual(downs("\x7f")[0], { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, modifiers: 0 });
		assert.equal(downs("\x1b[A")[0]?.key, "ArrowUp");
		assert.deepEqual(downs("\x1b[1;2A")[0], { type: "rawKeyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 8 });
		assert.equal(downs("\x1b[1;5D")[0]?.modifiers, 2);
		assert.equal(downs("\x1b[Z")[0]?.key, "Tab");
		assert.equal(downs("\x1b[Z")[0]?.modifiers, 8);
		assert.equal(downs("\x1b[3~")[0]?.key, "Delete");
		assert.equal(downs("\x1b[5~")[0]?.key, "PageUp");
		assert.equal(downs("\x1b[H")[0]?.key, "Home");
	});
	it("maps ctrl and alt letters without text", () => {
		assert.deepEqual(downs("\x01")[0], { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
		assert.equal(downs("\x1b[97;5u")[0]?.modifiers, 2);
	});
	it("maps multi-character input and bracketed paste to text", () => {
		assert.deepEqual(mapKey("hello"), { kind: "text", text: "hello" });
		assert.deepEqual(mapKey("\x1b[200~line1\r\nline2\x1b[201~"), { kind: "text", text: "line1\nline2" });
	});
	it("ignores unknown sequences", () => {
		assert.equal(mapKey("\x1b[999~"), undefined);
		assert.equal(mapKey(""), undefined);
	});
});
