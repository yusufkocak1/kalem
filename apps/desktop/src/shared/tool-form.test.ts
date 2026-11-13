import { describe, expect, it } from "vitest";
import { stringsFor } from "./i18n.js";
import type { FormField } from "./tool-form.js";
import { checkField, checkForm, parseFormValues } from "./tool-form.js";
import { parseApprovalAnswer } from "./tool-protocol.js";

const t = stringsFor("tr");
const field = (extra: Partial<FormField>): FormField => ({
	name: "x",
	label: "X",
	type: "text",
	required: true,
	...extra,
});

describe("form fields", () => {
	it("checks each type", () => {
		expect(checkField(t, field({ type: "url" }), " https://jira.example.com ")).toEqual({
			ok: true,
			value: "https://jira.example.com",
		});
		expect(checkField(t, field({ type: "url" }), "jira.example.com")).toEqual({
			ok: false,
			error: t.formInvalidUrl,
		});
		expect(checkField(t, field({ type: "url" }), "ftp://x.com").ok).toBe(false);
		expect(checkField(t, field({ type: "email" }), "a@b.co").ok).toBe(true);
		expect(checkField(t, field({ type: "email" }), "ab.co").ok).toBe(false);
		expect(checkField(t, field({ type: "boolean" }), "true")).toEqual({ ok: true, value: true });
		expect(
			checkField(t, field({ type: "choice", options: [{ value: "a", label: "A" }] }), "b").ok,
		).toBe(false);
		expect(checkField(t, field({ type: "text", maxLength: 3 }), "abcd").ok).toBe(false);
	});

	it("checks numbers against their range and step", () => {
		const zoom = field({ type: "number", min: 50, max: 200, step: 10 });
		expect(checkField(t, zoom, "124")).toEqual({ ok: true, value: 120 });
		expect(checkField(t, zoom, "12,5").ok).toBe(false);
		expect(checkField(t, zoom, "300")).toEqual({
			ok: false,
			error: "50 ile 200 arasında bir sayı girin.",
		});
		expect(checkField(t, zoom, "abc")).toEqual({ ok: false, error: t.formInvalidNumber });
	});

	it("asks for required fields and lets optional ones be empty", () => {
		const fields = [field({ name: "site", type: "url" }), field({ name: "user", required: false })];
		expect(checkForm(t, fields, { site: "", user: "" })).toEqual({
			ok: false,
			errors: { site: t.formRequired },
		});
		expect(checkForm(t, fields, { site: "https://a.com" })).toEqual({
			ok: true,
			values: { site: "https://a.com", user: "" },
		});
	});

	it("keeps only plain values from the window", () => {
		expect(parseFormValues({ a: "1", b: 2, c: true, d: {}, "bad name": "x" })).toEqual({
			a: "1",
			b: 2,
			c: true,
		});
		expect(parseApprovalAnswer({ approved: true, values: { token: "s" } }).values).toEqual({
			token: "s",
		});
	});
});
