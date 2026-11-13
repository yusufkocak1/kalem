/**
 * The forms a tool asks the user to fill in, in the chat: a connection's
 * address, user name and token, or settings with their types. The fields
 * are described here once; the card checks what is typed before it is
 * sent, and the main process checks it again before it is used. What is
 * typed into a form goes to Kalem, never to the model: a token is never
 * part of the chat. Pure.
 */
import type { Strings } from "./i18n.js";
import { format } from "./i18n.js";

/** What a field takes, and so how it is typed and checked. */
export type FormFieldType = "text" | "url" | "email" | "secret" | "number" | "boolean" | "choice";

export interface FormOption {
	/** The value as the form sends it. */
	readonly value: string;
	readonly label: string;
}

export interface FormField {
	readonly name: string;
	readonly label: string;
	readonly type: FormFieldType;
	readonly required: boolean;
	/** What it holds now; a secret is never filled in. */
	readonly value?: string | number | boolean;
	readonly placeholder?: string;
	readonly hint?: string;
	readonly min?: number;
	readonly max?: number;
	/** A number is rounded to a multiple of it. */
	readonly step?: number;
	readonly maxLength?: number;
	/** The values a choice takes. */
	readonly options?: readonly FormOption[];
}

export type FormValue = string | number | boolean;
export type FormValues = Readonly<Record<string, FormValue>>;

export type FieldCheck = { ok: true; value: FormValue } | { ok: false; error: string };

/** Text fields are this long at most when the field says nothing. */
export const MAX_FORM_TEXT = 2000;

const URL_PATTERN = /^https?:\/\/[^\s/?#]+[^\s]*$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One value as the field takes it, or why not. Text is trimmed; empty is allowed when not required. */
export function checkField(t: Strings, field: FormField, raw: unknown): FieldCheck {
	if (field.type === "boolean") {
		if (typeof raw === "boolean") return { ok: true, value: raw };
		if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
		return { ok: false, error: t.formInvalidBoolean };
	}
	const given = typeof raw === "string" ? raw.trim() : raw;
	if (given === undefined || given === null || given === "") {
		return field.required ? { ok: false, error: t.formRequired } : { ok: true, value: "" };
	}
	if (field.type === "number") {
		const value = typeof given === "number" ? given : Number(String(given).replace(",", "."));
		if (!Number.isFinite(value)) return { ok: false, error: t.formInvalidNumber };
		const stepped =
			field.step !== undefined && field.step > 0
				? Math.round(value / field.step) * field.step
				: value;
		const rounded = Number(stepped.toFixed(6));
		if (
			(field.min !== undefined && rounded < field.min) ||
			(field.max !== undefined && rounded > field.max)
		) {
			return {
				ok: false,
				error: format(t.formNumberRange, field.min ?? "−∞", field.max ?? "∞"),
			};
		}
		return { ok: true, value: rounded };
	}
	if (typeof given !== "string") return { ok: false, error: t.formInvalidText };
	if (given.length > (field.maxLength ?? MAX_FORM_TEXT)) {
		return { ok: false, error: format(t.formTooLong, field.maxLength ?? MAX_FORM_TEXT) };
	}
	if (field.type === "choice") {
		return (field.options ?? []).some((option) => option.value === given)
			? { ok: true, value: given }
			: { ok: false, error: t.formInvalidChoice };
	}
	if (field.type === "url") {
		if (!URL_PATTERN.test(given)) return { ok: false, error: t.formInvalidUrl };
		try {
			const url = new URL(given);
			if (url.protocol !== "http:" && url.protocol !== "https:")
				return { ok: false, error: t.formInvalidUrl };
		} catch {
			return { ok: false, error: t.formInvalidUrl };
		}
		return { ok: true, value: given };
	}
	if (field.type === "email" && !EMAIL_PATTERN.test(given)) {
		return { ok: false, error: t.formInvalidEmail };
	}
	return { ok: true, value: given };
}

export type FormCheck =
	| { ok: true; values: Record<string, FormValue> }
	| { ok: false; errors: Record<string, string> };

/** Every field's value checked: the values, or each wrong field's error. */
export function checkForm(
	t: Strings,
	fields: readonly FormField[],
	raw: Readonly<Record<string, unknown>>,
): FormCheck {
	const values: Record<string, FormValue> = {};
	const errors: Record<string, string> = {};
	for (const field of fields) {
		const checked = checkField(t, field, Object.hasOwn(raw, field.name) ? raw[field.name] : "");
		if (checked.ok) values[field.name] = checked.value;
		else errors[field.name] = checked.error;
	}
	return Object.keys(errors).length === 0 ? { ok: true, values } : { ok: false, errors };
}

/** Values as the window sent them, made safe: plain values under plain names. */
export function parseFormValues(raw: unknown): FormValues | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const values: Record<string, FormValue> = {};
	for (const [name, value] of Object.entries(raw).slice(0, 100)) {
		if (!/^[\w.-]{1,100}$/.test(name)) continue;
		if (typeof value === "string") values[name] = value.slice(0, 20_000);
		else if (typeof value === "boolean") values[name] = value;
		else if (typeof value === "number" && Number.isFinite(value)) values[name] = value;
	}
	return values;
}
