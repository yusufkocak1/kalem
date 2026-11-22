import type { Settings, UserRole } from "./bridge.js";
import { revealPane } from "./panes.js";
import { AGENT_SPEC_ID, BUILTIN_ID } from "./templates.js";

/**
 * What the first start's question sets for each kind of user. Only what
 * differs between them: everything else stays as it is, and every one of
 * these is a setting the user can change again.
 *
 * - writer: a quiet page: the simplified ribbon, no line numbers, the
 *   headings at the left;
 * - analyst: the full ribbon, the headings at the left, the assistant open,
 *   new documents from the analysis template;
 * - developer: the simplified ribbon, line numbers on the page too, the
 *   files at the left, the assistant open, new documents from the coding
 *   agent's spec template.
 */
export function rolePreset(role: UserRole, settings: Settings): Partial<Settings> {
	switch (role) {
		case "writer":
			return {
				role,
				ribbonSimple: true,
				lineNumbers: false,
				...revealPane(settings, "outline"),
			};
		case "analyst":
			return {
				role,
				ribbonSimple: false,
				lineNumbers: false,
				assistant: true,
				defaultTemplate: BUILTIN_ID,
				...revealPane(settings, "outline"),
			};
		case "developer":
			return {
				role,
				ribbonSimple: true,
				lineNumbers: true,
				codeLineNumbers: true,
				assistant: true,
				defaultTemplate: AGENT_SPEC_ID,
				...revealPane(settings, "files"),
			};
	}
}
