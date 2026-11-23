import { describe, expect, it } from "vitest";
import { Steering } from "./assistant-steering.js";

describe("steering", () => {
	it("keeps what the user adds until the answer takes it, in order", () => {
		const steering = new Steering();
		expect(steering.add({ id: "a", text: "Tabloyu da ekle" })).toBe(true);
		expect(steering.add({ id: "b", text: "Kısa tut" })).toBe(true);
		expect(steering.take()).toEqual([
			{ id: "a", text: "Tabloyu da ekle" },
			{ id: "b", text: "Kısa tut" },
		]);
		expect(steering.take()).toEqual([]);
	});

	it("passes each message on as it comes while someone listens", () => {
		const steering = new Steering();
		const passed: string[] = [];
		steering.listen(() => passed.push(...steering.take().map((message) => message.text)));
		steering.add({ id: "a", text: "bir" });
		steering.add({ id: "b", text: "iki" });
		expect(passed).toEqual(["bir", "iki"]);
		steering.listen(null);
		steering.add({ id: "c", text: "üç" });
		expect(passed).toEqual(["bir", "iki"]);
		expect(steering.take().map((message) => message.id)).toEqual(["c"]);
	});

	it("gives back a message not taken in yet, and only that", () => {
		const steering = new Steering();
		steering.add({ id: "a", text: "bir" });
		steering.add({ id: "b", text: "iki" });
		expect(steering.withdraw("a")).toBe(true);
		expect(steering.withdraw("a")).toBe(false);
		expect(steering.take().map((message) => message.id)).toEqual(["b"]);
		expect(steering.withdraw("b")).toBe(false);
	});

	it("takes no more once the answer has ended", () => {
		const steering = new Steering();
		let heard = 0;
		steering.listen(() => heard++);
		steering.close();
		expect(steering.closed).toBe(true);
		expect(steering.add({ id: "a", text: "geç kaldı" })).toBe(false);
		expect(steering.take()).toEqual([]);
		expect(heard).toBe(0);
	});
});
