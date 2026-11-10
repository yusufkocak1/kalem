import { describe, expect, it } from "vitest";
import { describeAtom } from "./confluence-atoms.js";
import {
	insertedAtomXml,
	isInsertedAtom,
	JIRA_PREFIX,
	jiraHref,
	jiraServerOf,
	MENTION_PREFIX,
	mentionHref,
	usersOf,
} from "./confluence-insert.js";
import { ATOM_PREFIX, markdownToStorage } from "./confluence-storage.js";
import { exportPage } from "./confluence-sync.js";

const place = { site: "https://acme.atlassian.net/wiki", spaceKey: "DEV", pageUrl: "" };

describe("inserted atoms", () => {
	it("start like kept atoms, so they show and save as those do", () => {
		expect(MENTION_PREFIX.startsWith(ATOM_PREFIX)).toBe(true);
		expect(JIRA_PREFIX.startsWith(ATOM_PREFIX)).toBe(true);
	});

	it("mention a Cloud user by account id, a Server user by key or name", () => {
		const cloud = mentionHref({ name: "Ali Veli", accountId: "557058:ab-12" });
		expect(cloud).toBe("#confluence-keep-mention-a-557058%3Aab-12");
		expect(insertedAtomXml(cloud ?? "")).toBe(
			'<ac:link><ri:user ri:account-id="557058:ab-12" /></ac:link>',
		);
		expect(insertedAtomXml(mentionHref({ name: "A", key: "8a7f" }) ?? "")).toContain(
			'ri:userkey="8a7f"',
		);
		expect(insertedAtomXml(mentionHref({ name: "A", username: "a&b" }) ?? "")).toContain(
			'ri:username="a&amp;b"',
		);
		expect(mentionHref({ name: "Nobody" })).toBeNull();
	});

	it("write a Jira macro with the server when known", () => {
		expect(jiraHref("abc-12")).toBe("#confluence-keep-jira-ABC-12");
		expect(jiraHref("not a key")).toBeNull();
		const href = jiraHref("ABC-12", { id: "1a2b", name: "Our Jira" }) ?? "";
		expect(insertedAtomXml(href)).toBe(
			'<ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="server">Our Jira</ac:parameter><ac:parameter ac:name="serverId">1a2b</ac:parameter><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro>',
		);
		expect(insertedAtomXml(jiraHref("ABC-1") ?? "")).toBe(
			'<ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">ABC-1</ac:parameter></ac:structured-macro>',
		);
	});

	it("are not confused with kept atoms or broken targets", () => {
		expect(isInsertedAtom("#confluence-keep-0a1b2c3d")).toBe(false);
		expect(insertedAtomXml("#confluence-keep-0a1b2c3d")).toBeNull();
		expect(insertedAtomXml(`${MENTION_PREFIX}x-1`)).toBeNull();
		expect(insertedAtomXml(`${MENTION_PREFIX}a-%E0`)).toBeNull();
		expect(insertedAtomXml(`${JIRA_PREFIX}lower-1`)).toBeNull();
	});

	it("describe themselves for the link card", () => {
		const mention = describeAtom(
			insertedAtomXml(mentionHref({ name: "A", accountId: "x1" }) ?? "") ?? "",
			place,
		);
		expect(mention?.type).toBe("mention");
		expect(mention?.user).toEqual({ accountId: "x1" });
		const jira = describeAtom(insertedAtomXml(jiraHref("ABC-3") ?? "") ?? "", place);
		expect(jira?.type).toBe("jira");
		expect(jira?.title).toBe("ABC-3");
	});

	it("become a real mention and Jira macro when the Markdown is saved", () => {
		const markdown = `Ask [@Ali Veli](${mentionHref({ name: "Ali Veli", accountId: "u1" })}) about [ABC-12](${jiraHref("ABC-12")}).`;
		const storage = markdownToStorage(markdown);
		expect(storage).toContain('<ac:link><ri:user ri:account-id="u1" /></ac:link>');
		expect(storage).toContain('<ac:parameter ac:name="key">ABC-12</ac:parameter>');
		expect(storage).not.toContain("confluence-keep");
	});

	it("are written when added to a page's changed paragraph", () => {
		const base = "<p>First</p><p>Second</p>";
		const markdown = `First\n\nSecond [@Ayşe](${mentionHref({ name: "Ayşe", key: "k9" })})\n`;
		const { storage } = exportPage(markdown, base);
		expect(storage).toContain("<p>First</p>");
		expect(storage).toContain('<ri:user ri:userkey="k9" />');
	});
});

describe("usersOf", () => {
	it("reads Cloud's user search", () => {
		const users = usersOf({
			results: [
				{
					user: {
						type: "known",
						accountId: "557058:1",
						accountType: "atlassian",
						email: "ali@acme.com",
						displayName: "Ali Veli",
					},
					title: "Ali Veli",
				},
				{ user: { accountId: "app:1", accountType: "app", displayName: "A bot" } },
			],
		});
		expect(users).toEqual([{ name: "Ali Veli", accountId: "557058:1", detail: "ali@acme.com" }]);
	});

	it("reads Server's search and the prototype API, each user once", () => {
		expect(
			usersOf({
				results: [
					{ user: { type: "known", username: "aveli", userKey: "8a7f", displayName: "Ali Veli" } },
					{ user: { type: "known", username: "aveli", userKey: "8a7f", displayName: "Ali Veli" } },
				],
			}),
		).toEqual([{ name: "Ali Veli", key: "8a7f", username: "aveli", detail: "aveli" }]);
		expect(
			usersOf({ group: [{ name: "users", result: [{ title: "Ayşe K", username: "ayse" }] }] }),
		).toEqual([{ name: "Ayşe K", username: "ayse", detail: "ayse" }]);
	});

	it("does not take pages or spaces for users", () => {
		expect(
			usersOf({
				results: [
					{ title: "Page", type: "page", name: "p" },
					{ key: "DEV", name: "Dev" },
				],
			}),
		).toEqual([]);
	});
});

describe("jiraServerOf", () => {
	const servers = [
		{ id: "a", name: "Old", url: "https://old.acme.com" },
		{ id: "b", name: "Main", url: "https://jira.acme.com", selected: true },
	];

	it("takes the Jira Kalem is connected to, else the default, else the only one", () => {
		expect(jiraServerOf(servers, "old.acme.com")).toEqual({ id: "a", name: "Old" });
		expect(jiraServerOf(servers, null)).toEqual({ id: "b", name: "Main" });
		expect(jiraServerOf([servers[0]], "x.com")).toEqual({ id: "a", name: "Old" });
		expect(jiraServerOf([{ id: "a" }, { id: "c" }], null)).toBeNull();
		expect(jiraServerOf({}, null)).toBeNull();
	});
});
