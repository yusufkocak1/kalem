import JSZip from "jszip";

/** 1×1 PNG. */
export const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
	"base64",
);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="emf" ContentType="image/x-emf"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ornek.com/rapor" TargetMode="External"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.emf"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="·"/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(text: string, props = ""): string {
	const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
	return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(content: string, style?: string, extra = ""): string {
	const pStyle = style === undefined ? "" : `<w:pStyle w:val="${style}"/>`;
	const pPr = pStyle === "" && extra === "" ? "" : `<w:pPr>${pStyle}${extra}</w:pPr>`;
	return `<w:p>${pPr}${content}</w:p>`;
}

function listItem(text: string, numId: number, level = 0): string {
	return paragraph(
		run(text),
		"ListParagraph",
		`<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
	);
}

function cell(...paragraphs: string[]): string {
	return `<w:tc>${paragraphs.join("")}</w:tc>`;
}

function image(relId: string): string {
	return `<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Resim" descr="Kırmızı nokta"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="nokta.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const BODY = [
	paragraph(run("Çeyrek Raporu"), "Title"),
	paragraph(
		run("Bu bölümde ") +
			run("üç", "<w:b/>") +
			run(" bulgu var ve hepsi ") +
			run("ölçüldü", "<w:i/>") +
			run("; biri ") +
			run("iptal", "<w:strike/>") +
			run(". Ayrıntı: ") +
			`<w:hyperlink r:id="rId3">${run("detaylı rapor")}</w:hyperlink>` +
			run("."),
	),
	paragraph(run("Bulgular"), "Heading1"),
	listItem("Gelir beklentinin üstünde", 1),
	listItem("Maliyet sabit kaldı", 1),
	listItem("Kira", 1, 1),
	listItem("Personel", 1, 1),
	paragraph(run("Sonraki adımlar"), "Heading2"),
	listItem("Bütçe gözden geçirilecek", 2),
	listItem("Ekip bilgilendirilecek", 2),
	paragraph(run("Ölçmediğin şeyi yönetemezsin."), "Quote"),
	`<w:tbl>
<w:tr>${cell(paragraph(run("Kalem")))}${cell(paragraph(run("Tutar")))}</w:tr>
<w:tr>${cell(paragraph(run("Gelir")))}${cell(paragraph(run("120")), paragraph(run("(tahmini)")))}</w:tr>
</w:tbl>`,
	paragraph(image("rId4")),
	paragraph(image("rId5")),
	paragraph(run("Son paragraf: a < b & c.")),
].join("\n");

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${BODY}
<w:sectPr/>
</w:body>
</w:document>`;

/**
 * A real .docx with a title, formatted text, nested and numbered lists, a
 * quote, a table, a PNG and an EMF image the browser cannot draw.
 */
export async function createSampleDocx(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file("[Content_Types].xml", CONTENT_TYPES);
	zip.file("_rels/.rels", ROOT_RELS);
	zip.file("word/document.xml", DOCUMENT);
	zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
	zip.file("word/styles.xml", STYLES);
	zip.file("word/numbering.xml", NUMBERING);
	zip.file("word/media/image1.png", PNG_1X1);
	zip.file("word/media/image2.emf", Buffer.from([1, 0, 0, 0]));
	return zip.generateAsync({ type: "nodebuffer" });
}
