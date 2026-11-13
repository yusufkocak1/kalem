import { describe, expect, it } from "vitest";
import type { CommentFilter } from "./jira-comments.js";
import {
	applyMentions,
	commentPeople,
	compactCommentHtml,
	compactCommentText,
	filterComments,
	formatDurationShort,
	hasAttachment,
	isBotAuthor,
	isShortComment,
	mentionIdFromHref,
	mentionsOf,
	NO_COMMENT_FILTER,
	parsePersonName,
	shortDateTime,
	timeBar,
} from "./jira-comments.js";

describe("parsePersonName", () => {
	it("splits a name and its team after a dash", () => {
		expect(parsePersonName("GULDEN BAYKARA - Quickres Analist Takimi")).toEqual({
			name: "Gulden Baykara",
			team: "Quickres Analist Takimi",
			full: "GULDEN BAYKARA - Quickres Analist Takimi",
		});
	});

	it("takes the first unit of a parenthesised title", () => {
		const full = "ISIL SEN (Gelir Yonetimi Bsk. (Dogrudan Dagitim Kanallari Md.) - Bassorumlu)";
		expect(parsePersonName(full)).toEqual({ name: "Isil Sen", team: "Gelir Yonetimi Bsk.", full });
	});

	it("keeps names that are already mixed case, and Turkish capitals", () => {
		expect(parsePersonName("Ayşe Balcı").name).toBe("Ayşe Balcı");
		expect(parsePersonName("IŞIL ŞEN - Gelir").name).toBe("Işıl Şen");
		expect(parsePersonName("Ao.jiraadmin")).toEqual({
			name: "Ao.jiraadmin",
			team: "",
			full: "Ao.jiraadmin",
		});
	});
});

describe("mentions", () => {
	it("reads the user from a profile address", () => {
		expect(mentionIdFromHref("https://jira.x.com/secure/ViewProfile.jspa?name=isil.sen")).toBe(
			"isil.sen",
		);
		expect(mentionIdFromHref("https://x.atlassian.net/jira/people/5b10ac")).toBe("5b10ac");
		expect(mentionIdFromHref("https://wiki.x.com/display/QR/Page")).toBeNull();
	});

	it("collects Jira's rendered mentions with their names", () => {
		const html =
			'<p>Merhaba <a href="https://jira.x.com/secure/ViewProfile.jspa?name=isil.sen" class="user-hover" rel="isil.sen">ISIL SEN (Gelir &amp; Md.)</a>, ' +
			'<a href="https://wiki.x.com/page">sayfa</a></p>';
		expect(mentionsOf(html, "Merhaba [~isil.sen]")).toEqual([
			{ id: "isil.sen", name: "ISIL SEN (Gelir & Md.)" },
		]);
	});

	it("falls back to the wiki markup's user names", () => {
		expect(mentionsOf(null, "[~can] ve [~accountid:5b10ac]")).toEqual([
			{ id: "can", name: "can" },
			{ id: "5b10ac", name: "5b10ac" },
		]);
	});
});

describe("compacting comments", () => {
	it("drops empty paragraphs and runs of line breaks", () => {
		const html =
			"<p>Merhaba</p><p>&nbsp;</p><p><br></p><p>Analiz<br><br><br>tamam</p><div> </div><p>Teşekkürler<br></p>";
		expect(compactCommentHtml(html)).toBe("<p>Merhaba</p><p>Analiz<br>tamam</p><p>Teşekkürler</p>");
	});

	it("squeezes blank lines in text", () => {
		expect(compactCommentText("Uygundur\n\n\n\n Teşekkürler  \n\n")).toBe(
			"Uygundur\n\n Teşekkürler",
		);
	});

	it("tells a one-line comment", () => {
		expect(isShortComment("Uygundur\n\n", "<p>Uygundur</p><p></p>")).toBe(true);
		expect(isShortComment("Uygundur\n\nTeşekkürler", null)).toBe(false);
		expect(isShortComment("Bakın", '<p>Bakın <img src="a.png"></p>')).toBe(false);
		expect(isShortComment("x".repeat(200), null)).toBe(false);
	});
});

describe("dates and durations", () => {
	it("writes a short date with the time, the year only when it differs", () => {
		const now = new Date("2026-11-13T10:00:00");
		expect(shortDateTime("2026-10-07T11:56:00", "tr", now).short).toBe("7 Eki 11:56");
		expect(shortDateTime("2025-10-07T11:56:00", "tr", now).short).toContain("2025");
		expect(shortDateTime("2026-10-07T11:56:00", "tr", now).full).toContain("2026");
		expect(shortDateTime(null, "tr", now)).toEqual({ short: "", full: "" });
	});

	it("writes durations with the language's units", () => {
		expect(formatDurationShort(20 * 3600 + 9 * 60, "s", "dk")).toBe("20s 9dk");
		expect(formatDurationShort(3600, "h", "m")).toBe("1h");
		expect(formatDurationShort(0, "h", "m")).toBe("0m");
	});

	it("fills the bar against the remaining or the estimate", () => {
		expect(timeBar(3600, 3600, null)).toEqual({ value: 3600, max: 7200 });
		expect(timeBar(3600, null, 14400)).toEqual({ value: 3600, max: 14400 });
		expect(timeBar(3600, 0, null)).toEqual({ value: 1, max: 1 });
	});
});

describe("filters", () => {
	const comments = [
		{
			author: "GULDEN BAYKARA - Quickres Analist Takimi",
			authorId: "gulden",
			body: "Analiz",
			html: null,
		},
		{ author: "Ao.jiraadmin", authorId: "ao.jiraadmin", body: "Otomatik", html: null },
		{
			author: "YUSUF KOCAK - Quickres Gelistirme Takimi",
			authorId: "yusuf",
			body: "!shot.png!",
			html: null,
		},
		{
			author: "Can",
			authorId: "can",
			body: "x",
			html: '<p><img src="/secure/attachment/1/a.png"></p>',
		},
	];

	it("keeps people, attachments, a person or a team", () => {
		const pick = (filter: Partial<CommentFilter>) =>
			filterComments(comments, { ...NO_COMMENT_FILTER, ...filter }).map((c) => c.authorId);
		expect(pick({ humansOnly: true })).toEqual(["gulden", "yusuf", "can"]);
		expect(pick({ attachmentsOnly: true })).toEqual(["yusuf", "can"]);
		expect(pick({ person: "Gulden Baykara" })).toEqual(["gulden"]);
		expect(pick({ team: "Quickres Gelistirme Takimi" })).toEqual(["yusuf"]);
	});

	it("lists the people and teams", () => {
		expect(commentPeople(comments).teams).toEqual([
			"Quickres Analist Takimi",
			"Quickres Gelistirme Takimi",
		]);
		expect(isBotAuthor("Automation for Jira", "")).toBe(true);
		expect(isBotAuthor("Işıl Şen", "isil.sen")).toBe(false);
		expect(hasAttachment("bkz [^rapor.pdf]", null)).toBe(true);
		expect(hasAttachment("Merhaba! Nasılsın!", null)).toBe(false);
	});
});

describe("applyMentions", () => {
	it("turns chosen names into Jira's mention markup, longer names first", () => {
		const mentions = new Map([
			["Işıl Şen", "[~isil.sen]"],
			["Işıl Şen Kaya", "[~isil.kaya]"],
		]);
		expect(applyMentions("@Işıl Şen Kaya ve @Işıl Şen bakar mısınız? @Can", mentions)).toBe(
			"[~isil.kaya] ve [~isil.sen] bakar mısınız? @Can",
		);
	});
});
