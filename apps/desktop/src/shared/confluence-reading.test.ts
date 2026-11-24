import { describe, expect, it } from "vitest";
import { storageToMarkdown, storageUsers } from "./confluence-storage.js";

const PAGE = `<p>Sahibi <ac:link><ri:user ri:account-id="abc123" /></ac:link></p>
<ac:structured-macro ac:name="jira"><ac:parameter ac:name="jqlQuery">project = QR AND status = Open</ac:parameter></ac:structured-macro>
<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">QR-7</ac:parameter></ac:structured-macro>
<ac:structured-macro ac:name="include"><ac:parameter ac:name=""><ac:link><ri:page ri:content-title="Ortak Kurallar" ri:space-key="DEV" /></ac:link></ac:parameter></ac:structured-macro>
<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">Mimari</ac:parameter></ac:structured-macro>
<ac:structured-macro ac:name="children" />
<ac:structured-macro ac:name="toc" />
<ac:structured-macro ac:name="gizemli" />`;

describe("a page read for the assistant", () => {
	it("names what Confluence fills in instead of dropping it", () => {
		const text = storageToMarkdown(PAGE, {
			reading: { users: new Map([["abc123", "Ayşe Yılmaz"]]) },
		});
		expect(text).toContain("@Ayşe Yılmaz");
		expect(text).toContain('JQL "project = QR AND status = Open"');
		expect(text).toContain("QR-7");
		expect(text).toContain('The page "Ortak Kurallar" (space DEV) is shown here');
		expect(text).toContain('draw.io diagram "Mimari"');
		expect(text).toContain('name "Mimari.png"');
		expect(text).toContain("the page's child pages");
		expect(text).toContain("⟦Macro: gizemli⟧");
		expect(text).not.toContain("toc");
	});

	it("leaves the editor's import as it was", () => {
		const text = storageToMarkdown(PAGE);
		expect(text).not.toContain("jqlQuery");
		expect(text).not.toContain("Ortak Kurallar");
		expect(text).not.toContain("⟦");
	});

	it("finds the people a page mentions, each once", () => {
		expect(
			storageUsers(`${PAGE}<ri:user ri:account-id="abc123"/><ri:user ri:username="mehmet" />`),
		).toEqual([{ accountId: "abc123" }, { username: "mehmet" }]);
	});
});
