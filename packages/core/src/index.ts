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
// --- Düzenleme (F1-02) ---
export type { CloneOptions } from "./edit.js";
export { clone, insertAt, remove, removeAt, replace, replaceAt } from "./edit.js";
// --- Tip koruyucular (F1-01) ---
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
// --- Konum yolları (F1-02) ---
export type { Path } from "./path.js";
export { nodeAtPath, parentAtPath, parentPath, pathEquals, pathToNode } from "./path.js";
export type { Line, LineEnding, ScanResult } from "./scanner.js";
export { indentWidth, isBlank, scan } from "./scanner.js";
// --- Künye kaydı (F1-01) ---
export { isParentContent, NODE_TYPES, SPECS, specOf } from "./spec.js";
// --- Gezinme (F1-02) ---
export type { VisitContext, Visitor, VisitorResult } from "./traverse.js";
export { CONTINUE, EXIT, find, SKIP, visit, walk } from "./traverse.js";
