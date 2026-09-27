/**
 * @kalem-editor/core — Markdown AST, ayrıştırıcı ve serileştirici
 *
 * DOM'a dokunmaz; sunucuda, worker'da ve tarayıcıda aynı şekilde çalışır.
 * Üçüncü parti bağımlılığı yoktur ve olmayacaktır (bkz. CONTRIBUTING.md).
 *
 * İki modül **kasten** burada değil, kendi giriş noktalarında:
 * `@kalem-editor/core/commands` (editör komutları) ve `@kalem-editor/core/html`
 * (yapıştırma dönüştürücüsü). Yalnızca Markdown işleyen kullanıcı —
 * SSR, derleme betiği — onların boyutunu ödemez.
 *
 * `scanner` de dışarıda: ayrıştırıcının iç tesisatı, kararlı API değil.
 *
 * @module @kalem-editor/core
 */

// --- AST tipleri (F1-01) ---
export type {
	AlignType,
	Block,
	Blockquote,
	BlockquoteSyntax,
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
// --- Blok ayrıştırıcı (F1-03) ---
//
// `parseBlocks` düşük seviyeli giriş: satır içi ayrıştırıcıyı dışarıdan
// almak isteyen (editör, özel eklenti) için. Sıradan kullanım `parse`.
export type { InlineParser, ParseBlocksOptions } from "./blocks.js";
export { parseBlocks } from "./blocks.js";
// --- Ağaç düzenleme (F1-02) ---
export type { CloneOptions } from "./edit.js";
export { clone, insertAt, remove, removeAt, replace, replaceAt } from "./edit.js";
// --- Tip koruyucuları (F1-02) ---
export {
	isBlock,
	isFrontmatter,
	isInline,
	isLiteral,
	isNode,
	isNodeOf,
	isParent,
	isRoot,
	isStructural,
} from "./guards.js";
// --- Ayrıştırıcı (F1-03 + F1-04) ---
export { parse } from "./parse.js";
// --- Yol (path) yardımcıları (F1-02) ---
export type { Path } from "./path.js";
export { nodeAtPath, parentAtPath, parentPath, pathEquals, pathToNode } from "./path.js";
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
export type { SerializeCache, SerializeOptions } from "./serialize.js";
export { createSerializeCache, serialize } from "./serialize.js";
// --- Künye kaydı (F1-01) ---
export { isParentContent, NODE_TYPES, SPECS, specOf } from "./spec.js";
// --- Gezinme (F1-02) ---
export type { VisitContext, Visitor, VisitorResult } from "./traverse.js";
export { CONTINUE, EXIT, find, SKIP, visit, walk } from "./traverse.js";
