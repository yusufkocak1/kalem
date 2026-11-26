/**
 * The assistant's tools by what gives them: Kalem's own by what they work
 * on, an extension's under the extension. A group can be turned off as a
 * whole: its setting (`group:<id>`) is kept with the tools' own, and an
 * extension's tools stay off when it is started again. Pure.
 */
import type { ToolPolicy } from "./tool-protocol.js";

export type BuiltInToolGroup = "jira" | "confluence" | "document" | "app";

export const BUILT_IN_GROUPS: readonly BuiltInToolGroup[] = [
	"jira",
	"confluence",
	"document",
	"app",
];

/** A tool's group: `extension:<id>` for an extension's, else what it works on. */
export function toolGroupOf(name: string, extensionId?: string): string {
	if (extensionId !== undefined) return `extension:${extensionId}`;
	if (name.startsWith("jira_")) return "jira";
	if (name.startsWith("confluence_")) return "confluence";
	if (/^(?:document_|propose_edit|read_file|list_files|search$)/.test(name)) return "document";
	return "app";
}

/** The settings key that turns a group off. */
export const groupPolicyKey = (group: string): string => `group:${group}`;

/** How a tool runs, its group's switch first: a group turned off turns off each of its tools. */
export function effectiveToolPolicy(
	policies: Readonly<Record<string, ToolPolicy>>,
	name: string,
	group: string,
): ToolPolicy | undefined {
	const key = groupPolicyKey(group);
	if (Object.hasOwn(policies, key) && policies[key] === "off") return "off";
	return Object.hasOwn(policies, name) ? policies[name] : undefined;
}
