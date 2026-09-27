/**
 * @kalem-editor/core — Düğüm künye kaydı  (İş listesi: F1-01)
 *
 * Her düğüm tipinin hangi katmana ait olduğu ve ne tuttuğu burada tek bir
 * yerde yazılıdır. Gezinme (F1-02), render (F2) ve serileştirme (F1-07) bu
 * kaydı okuyarak her düğüm tipi için ayrı `switch` yazmaktan kurtulur.
 *
 * Kayıt `NodeSpecs` tipinde olduğu için **eksik bırakılamaz**: `ast.ts`'teki
 * birliğe yeni bir düğüm eklendiğinde künyesini yazmayı unutmak derleme
 * hatasıdır.
 */
import type { ContentModel, NodeSpecs, NodeType } from "./ast.js";

export const SPECS: NodeSpecs = {
	// --- kök ---
	root: { type: "root", groups: ["root"], content: "blocks", hasSyntax: true },

	// --- frontmatter (yalnızca belgenin başında) ---
	yaml: { type: "yaml", groups: ["frontmatter"], content: "value", hasSyntax: false },
	toml: { type: "toml", groups: ["frontmatter"], content: "value", hasSyntax: false },

	// --- bloklar ---
	paragraph: { type: "paragraph", groups: ["block"], content: "inlines", hasSyntax: false },
	heading: { type: "heading", groups: ["block"], content: "inlines", hasSyntax: true },
	blockquote: { type: "blockquote", groups: ["block"], content: "blocks", hasSyntax: true },
	list: { type: "list", groups: ["block"], content: "listItems", hasSyntax: true },
	code: { type: "code", groups: ["block"], content: "value", hasSyntax: true },
	thematicBreak: { type: "thematicBreak", groups: ["block"], content: "void", hasSyntax: true },
	definition: { type: "definition", groups: ["block"], content: "void", hasSyntax: false },
	table: { type: "table", groups: ["block"], content: "tableRows", hasSyntax: true },

	// `html` hem blok hem satır içi olabilir — mdast ikisini ayırmaz.
	html: { type: "html", groups: ["block", "inline"], content: "value", hasSyntax: false },

	// --- yapısal (yalnızca kendi ebeveyninin içinde) ---
	listItem: { type: "listItem", groups: ["structural"], content: "blocks", hasSyntax: false },
	tableRow: { type: "tableRow", groups: ["structural"], content: "tableCells", hasSyntax: false },
	tableCell: { type: "tableCell", groups: ["structural"], content: "inlines", hasSyntax: false },

	// --- satır içi ---
	text: { type: "text", groups: ["inline"], content: "value", hasSyntax: false },
	emphasis: { type: "emphasis", groups: ["inline"], content: "inlines", hasSyntax: true },
	strong: { type: "strong", groups: ["inline"], content: "inlines", hasSyntax: true },
	delete: { type: "delete", groups: ["inline"], content: "inlines", hasSyntax: true },
	inlineCode: { type: "inlineCode", groups: ["inline"], content: "value", hasSyntax: true },
	link: { type: "link", groups: ["inline"], content: "inlines", hasSyntax: true },
	image: { type: "image", groups: ["inline"], content: "void", hasSyntax: true },
	linkReference: {
		type: "linkReference",
		groups: ["inline"],
		content: "inlines",
		hasSyntax: true,
	},
	imageReference: {
		type: "imageReference",
		groups: ["inline"],
		content: "void",
		hasSyntax: true,
	},
	break: { type: "break", groups: ["inline"], content: "void", hasSyntax: true },
};

/** Bilinen bütün düğüm tipleri. */
export const NODE_TYPES = Object.keys(SPECS) as NodeType[];

/** Çocuk taşıyan içerik modelleri — gezinme yardımcılarının giriş noktası. */
const PARENT_CONTENT: ReadonlySet<ContentModel> = new Set<ContentModel>([
	"blocks",
	"inlines",
	"listItems",
	"tableRows",
	"tableCells",
]);

/** Bu içerik modeli `children` dizisi taşır mı. */
export function isParentContent(content: ContentModel): boolean {
	return PARENT_CONTENT.has(content);
}

/** Bir düğüm tipinin künyesi. Bilinmeyen tip için `undefined`. */
export function specOf(type: string): NodeSpecs[NodeType] | undefined {
	return Object.hasOwn(SPECS, type) ? SPECS[type as NodeType] : undefined;
}
