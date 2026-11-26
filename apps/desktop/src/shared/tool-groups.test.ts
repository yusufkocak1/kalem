import { describe, expect, it } from "vitest";
import { effectiveToolPolicy, groupPolicyKey, toolGroupOf } from "./tool-groups.js";
import { parseToolPolicies } from "./tool-protocol.js";

describe("tool groups", () => {
	it("put a tool under its extension, else under what it works on", () => {
		expect(toolGroupOf("jira_search")).toBe("jira");
		expect(toolGroupOf("confluence_page")).toBe("confluence");
		expect(toolGroupOf("read_file")).toBe("document");
		expect(toolGroupOf("open_settings")).toBe("app");
		expect(toolGroupOf("jira_search", "acme.tickets")).toBe("extension:acme.tickets");
	});

	it("turn every tool of a group off with its switch, whatever each was set to", () => {
		const policies = { [groupPolicyKey("extension:acme.tickets")]: "off", lookup: "auto" } as const;
		expect(effectiveToolPolicy(policies, "lookup", "extension:acme.tickets")).toBe("off");
		expect(effectiveToolPolicy(policies, "lookup", "app")).toBe("auto");
		expect(effectiveToolPolicy({}, "lookup", "app")).toBeUndefined();
	});

	it("keep a group's switch and an extension tool's name in the settings file", () => {
		expect(
			parseToolPolicies({
				"group:jira": "off",
				"group:extension:acme.tickets": "off",
				"Find-Ticket": "ask",
				"group:../x": "off",
			}),
		).toEqual({
			"group:jira": "off",
			"group:extension:acme.tickets": "off",
			"Find-Ticket": "ask",
		});
	});
});
