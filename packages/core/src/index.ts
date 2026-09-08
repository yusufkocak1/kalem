/**
 * @kalem/core — Markdown AST, ayrıştırıcı ve serileştirici
 *
 * DOM'a dokunmaz; sunucuda, worker'da ve tarayıcıda aynı şekilde çalışır.
 * Üçüncü parti bağımlılığı yoktur ve olmayacaktır (bkz. CONTRIBUTING.md).
 *
 * Şu an yalnızca AST katmanı hazır (F1-01). Ayrıştırıcı F1-03/04,
 * serileştirici F1-07 ile gelir.
 */

// --- AST tipleri (F1-01) ---
export type {
	AlignType,
	Block,
	Blockquote,
	Break,
	BreakSyntax,
	Code,
	CodeSyntax,
	ContentModel,
	Data,
	Definition,
	Delete,
	DeleteSyntax,
	Emphasis,
	EmphasisSyntax,
	Frontmatter,
	Heading,
	HeadingSyntax,
	Html,
	Image,
	ImageReference,
	Inline,
	InlineCode,
	InlineCodeSyntax,
	Link,
	LinkReference,
	LinkSyntax,
	List,
	ListItem,
	ListSyntax,
	LiteralNode,
	Node,
	NodeBase,
	NodeGroup,
	NodeId,
	NodeOf,
	NodeSpec,
	NodeSpecs,
	NodeType,
	Paragraph,
	ParentNode,
	Point,
	Position,
	ReferenceSyntax,
	Root,
	RootSyntax,
	Strong,
	Structural,
	Table,
	TableCell,
	TableRow,
	TableSyntax,
	Text,
	ThematicBreak,
	ThematicBreakSyntax,
	Toml,
	Yaml,
} from "./ast.js";
// --- Blok ayrıştırıcı (F1-03, devam ediyor) ---
//
// API henüz kararlı DEĞİL: kapsayıcı bloklar (blockquote, liste), HTML
// blokları ve satır içi ayrıştırma eksik. Yayımlanan `parse()` bunların
// üstüne kurulacak. Şimdiden dışa aktarılmasının sebebi boyut kapısının
// gerçek kodu ölçmesi.
export type { InlineParser, ParseBlocksOptions } from "./blocks.js";
export { parseBlocks } from "./blocks.js";
// --- Güvenlik (F1-10) ---
export type { HtmlPolicy, SecurityOptions, UrlPolicy } from "./security.js";
export {
	ALLOWED_IMAGE_DATA_TYPES,
	ALLOWED_PROTOCOLS,
	applyHtmlPolicy,
	escapeHtml,
	isSafeUrl,
	NEUTRALIZED_URL,
	sanitizeUrl,
} from "./security.js";

// --- Serileştirici (F1-07) ---
export type { SerializeOptions } from "./serialize.js";
export { serialize } from "./serialize.js";
// --- Künye kaydı (F1-01) ---
export { isParentContent, NODE_TYPES, SPECS, specOf } from "./spec.js";
// --- Gezinme (F1-02) ---
export type { VisitContext, Visitor, VisitorResult } from "./traverse.js";
export { CONTINUE, EXIT, find, SKIP, visit, walk } from "./traverse.js";
