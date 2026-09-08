/**
 * @kalem/core — AST tip tanımları  (İş listesi: F1-01)
 *
 * Bu dosya **yalnızca tip içerir**. Derlendiğinde geriye tek byte runtime kod
 * kalmaz; `ast.test.ts` bunu doğrular. Çalışan kod `spec.ts` ve `guards.ts`'te.
 *
 * ## Tasarım
 *
 * Ağaç, [mdast](https://github.com/syntax-tree/mdast) şemasıyla **şekil olarak
 * uyumludur** — ama `unified` / `mdast` bağımlılığı yoktur. Kullanıcı isterse
 * remark/rehype ekosistemini kendi tarafında bağlayabilir; biz ona bağlı
 * değiliz. Uyumluluk `ast.test.ts` içinde elle yazılmış mdast arayüzlerine
 * atanabilirlik testiyle korunur.
 *
 * mdast'ın isteğe bağlı bıraktığı alanlar, ayrıştırıcımız her zaman değer
 * ürettiği yerlerde **daraltılmıştır** (`ordered?: boolean | null` yerine
 * `ordered: boolean`). Daraltma tek yönlü uyumu bozmaz: bizim ağacımız
 * mdast bekleyen bir eklentiye verilebilir, tersi gerekmez.
 *
 * ## İki ekimiz
 *
 * 1. `syntax` — kaynaktaki **yazım tercihleri** (`-` mi `*` mi, ATX mi setext
 *    mi, ``` mi ~~~ mi). Gidiş-dönüş sadakatinin (F1-07) teknik önkoşulu;
 *    marked/markdown-it'in vermediği ve kendi ayrıştırıcımızı yazma
 *    gerekçemiz olan bilgi. Anlamı değiştirmez, yalnızca yazılışı taşır.
 * 2. `id` — editör içi kimlik. Ayrıştırıcı **atamaz**; editör kendi yönettiği
 *    bloklara verir ve serileştirilmez.
 */

// ---------------------------------------------------------------------------
// Konum
// ---------------------------------------------------------------------------

/** Kaynak metinde tek bir nokta. `line` ve `column` 1 tabanlı, `offset` 0 tabanlı. */
export interface Point {
	line: number;
	column: number;
	offset: number;
}

/** Bir düğümün kaynak metindeki aralığı. `end` dışlayıcıdır. */
export interface Position {
	start: Point;
	end: Point;
}

/**
 * Editör içi düğüm kimliği.
 *
 * Ayrıştırıcı bunu **doldurmaz** — her düğüme kimlik üretmek binlerce gereksiz
 * tahsis demek olurdu. Editör, sürükle-bırak ve DOM eşlemesi için sorumlu
 * olduğu bloklara kendisi atar. Serileştiriciye görünmez.
 */
export type NodeId = string;

/**
 * mdast'ın eklenti verisi için ayırdığı serbest alan.
 *
 * Bizim yazım tercihlerimiz burada **değil**, düğümün `syntax` alanında durur —
 * remark eklentileriyle çakışmasın diye.
 */
export interface Data {
	[key: string]: unknown;
}

/** Her düğümde bulunan alanlar. */
export interface NodeBase {
	type: string;
	/** Ayrıştırıcı doldurur. Elle kurulan düğümlerde bulunmaz. */
	position?: Position;
	/** Editör doldurur. Ayrıştırıcı ve serileştirici görmezden gelir. */
	id?: NodeId;
	data?: Data;
}

// ---------------------------------------------------------------------------
// Yazım tercihleri
//
// Bunlar anlamı değil YAZILIŞI taşır. Serileştirici (F1-07) bir düğümün
// `syntax` alanı doluysa onu kullanır, boşsa yapılandırılmış varsayılana
// düşer. Kullanıcının `*` yazdığı yerde `-` üretmemenin tek yolu bu.
// ---------------------------------------------------------------------------

/** `# Başlık` (atx) mi `Başlık\n=====` (setext) mi. */
export interface HeadingSyntax {
	style: "atx" | "setext";
	/** `## Başlık ##` — kapanış diyezleri var mı. Yalnızca atx için anlamlı. */
	closed?: boolean;
	/** Setext'te alt çizgi karakteri: `=` (depth 1) veya `-` (depth 2). */
	underline?: "=" | "-";
}

/** Çitli mi girintili mi; çit karakteri ve uzunluğu. */
export interface CodeSyntax {
	style: "fenced" | "indented";
	/** Çit karakteri. `indented` için bulunmaz. */
	fence?: "`" | "~";
	/** Çit uzunluğu (en az 3). İç içe kod bloklarında 4+ olabilir. */
	fenceLength?: number;
}

/**
 * Liste işaretleyicisi.
 *
 * CommonMark'ta işaretleyici değişince liste **biter** — bu yüzden tercih
 * liste düzeyinde tutulur, madde düzeyinde değil.
 */
export interface ListSyntax {
	/** Sırasız listelerde madde işareti. */
	marker?: "-" | "*" | "+";
	/** Sıralı listelerde sayıdan sonraki ayraç. */
	delimiter?: "." | ")";
	/**
	 * Sıralı listelerde numaralandırma biçimi.
	 * `incrementing`: 1. 2. 3.  ·  `repeated`: 1. 1. 1.
	 * İkisi de geçerli Markdown'dır ve kullanıcının tercihi korunmalıdır.
	 */
	numbering?: "incrementing" | "repeated";
}

/** Vurgu işaretleyicisi. `**` ve `__` aynı anlama gelir, farklı yazılır. */
export interface EmphasisSyntax {
	marker: "*" | "_";
}

/** Satır içi kodun yazılışı. */
export interface InlineCodeSyntax {
	/** Kullanılan ters tırnak sayısı. */
	fenceLength: number;
	/**
	 * İçerik tek boşlukla dolgulanmış mıydı: `` ` a ` ``
	 *
	 * CommonMark bu boşlukları içerikten atar (ters tırnakla başlayan kod
	 * yazılabilsin diye). Atıldığını kaydetmezsek geri yazarken kaybolur.
	 */
	padded?: boolean;
}

/** Sert satır sonunun yazılışı: iki boşluk mu ters bölü mü. */
export interface BreakSyntax {
	marker: "spaces" | "backslash";
}

/**
 * Yatay çizgi.
 *
 * `---`, `***`, `___`, `* * *`, `- - - - -` hepsi geçerli ve hepsi farklı
 * yazılır. Modellemek yerine ham metni saklamak burada hem daha kısa hem
 * daha sadık.
 */
export interface ThematicBreakSyntax {
	raw: string;
}

/** Bağlantının yazılış biçimi. */
export interface LinkSyntax {
	/**
	 * `inline`: `[metin](url)` · `autolink`: `<https://...>` ·
	 * `literal`: GFM'in çıplak URL'i (`https://...`)
	 */
	style: "inline" | "autolink" | "literal";
	/** Başlığı saran karakter. */
	titleDelimiter?: '"' | "'" | "(";
}

/** Başvurulu bağlantı/görselin yazılış biçimi. */
export interface ReferenceSyntax {
	/**
	 * `full`: `[metin][etiket]` · `collapsed`: `[etiket][]` ·
	 * `shortcut`: `[etiket]`
	 */
	referenceType: "full" | "collapsed" | "shortcut";
}

/**
 * Tablo.
 *
 * v1'de tablo **düzenleme arayüzü yok** (Karar #5) ama ayrıştırıcı tabloyu
 * kayıpsız korumak zorunda — kullanıcının dosyasını bozmamak için. Hücre
 * dolgusu, ayraç satırındaki tire sayısı ve kenar boruları tek tek
 * modellenmek yerine ham metin olarak saklanır; düzenleme geldiğinde
 * (v1.1, `@kalem/plugin-table`) bu alan yerini gerçek modele bırakır.
 */
export interface TableSyntax {
	raw: string;
}

/**
 * Belge düzeyi yazım bilgisi.
 *
 * Bunlar tek bir düğüme değil dosyanın tamamına ait olduğu için kökte durur.
 * Üçü de gidiş-dönüş sadakati (F1-07) için gerekli: biri eksikse serileştirici
 * kullanıcının dosyasını sessizce değiştirir.
 */
export interface RootSyntax {
	/**
	 * Dosyadaki satır sonu. Karışık kullanımda çoğunluk kazanır — karışık
	 * satır sonlu dosyalar byte düzeyinde gidiş-dönüşten sağ çıkamaz, bu
	 * bilinen ve belgelenmiş tek istisnadır.
	 */
	lineEnding: "\n" | "\r\n" | "\r";
	/** Dosya satır sonuyla bitiyor mu. */
	finalNewline: boolean;
	/** Dosya bayt sırası işaretiyle (BOM) başlıyor muydu. */
	bom: boolean;
}

// ---------------------------------------------------------------------------
// Blok düğümleri
// ---------------------------------------------------------------------------

/** Belgenin kökü. Frontmatter varsa ilk çocuktur. */
export interface Root extends NodeBase {
	type: "root";
	children: (Block | Frontmatter)[];
	syntax?: RootSyntax;
}

export interface Paragraph extends NodeBase {
	type: "paragraph";
	children: Inline[];
}

export interface Heading extends NodeBase {
	type: "heading";
	depth: 1 | 2 | 3 | 4 | 5 | 6;
	children: Inline[];
	syntax?: HeadingSyntax;
}

export interface Blockquote extends NodeBase {
	type: "blockquote";
	children: Block[];
}

export interface List extends NodeBase {
	type: "list";
	ordered: boolean;
	/** Sıralı listenin başlangıç numarası; sırasızda `null`. */
	start: number | null;
	/**
	 * mdast terminolojisi: `spread === true` gevşek liste (maddeler arasında
	 * boş satır, içerik `<p>` ile sarılır). Sıkı liste `spread === false`.
	 * Analiz taslağındaki `tight` alanının tam tersidir.
	 */
	spread: boolean;
	children: ListItem[];
	syntax?: ListSyntax;
}

export interface ListItem extends NodeBase {
	type: "listItem";
	/** GFM görev listesi: `[ ]` → false, `[x]` → true. Görev değilse `null`. */
	checked: boolean | null;
	spread: boolean;
	children: Block[];
}

export interface Code extends NodeBase {
	type: "code";
	/** Çit sonrası ilk kelime: ```` ```ts ```` → `"ts"`. */
	lang: string | null;
	/** Dilden sonraki kalan bilgi dizisi: ```` ```ts twoslash ```` → `"twoslash"`. */
	meta: string | null;
	value: string;
	syntax?: CodeSyntax;
}

export interface ThematicBreak extends NodeBase {
	type: "thematicBreak";
	syntax?: ThematicBreakSyntax;
}

/**
 * Ham HTML bloğu. **Korunur, çalıştırılmaz.**
 *
 * Viewer bunu varsayılan olarak kaçırarak metin gibi gösterir;
 * `allowDangerousHtml` açıkça açılmadıkça DOM'a HTML olarak girmez
 * (bkz. SECURITY.md).
 */
export interface Html extends NodeBase {
	type: "html";
	value: string;
}

/** `[etiket]: https://... "başlık"` — başvurulu bağlantı tanımı. */
export interface Definition extends NodeBase {
	type: "definition";
	/** Karşılaştırma için normalleştirilmiş etiket. */
	identifier: string;
	/** Kaynaktaki haliyle etiket. */
	label: string;
	url: string;
	title: string | null;
}

export type AlignType = "left" | "right" | "center";

export interface Table extends NodeBase {
	type: "table";
	/** Sütun başına hizalama; belirtilmemişse `null`. */
	align: (AlignType | null)[];
	children: TableRow[];
	syntax?: TableSyntax;
}

export interface TableRow extends NodeBase {
	type: "tableRow";
	children: TableCell[];
}

export interface TableCell extends NodeBase {
	type: "tableCell";
	children: Inline[];
}

/**
 * YAML frontmatter. **Ayrıştırılmaz, opak string olarak korunur** (F1-06) —
 * YAML ayrıştırıcısı bağımlılığı eklemiyoruz.
 */
export interface Yaml extends NodeBase {
	type: "yaml";
	value: string;
}

/** TOML frontmatter. YAML ile aynı gerekçe: korunur, ayrıştırılmaz. */
export interface Toml extends NodeBase {
	type: "toml";
	value: string;
}

/** Yalnızca belgenin en başında bulunabilen düğümler. */
export type Frontmatter = Yaml | Toml;

/**
 * Blok düzeyi içerik — bir bloğun beklendiği her yere konabilen düğümler.
 *
 * `listItem`, `tableRow` ve `tableCell` **buraya dahil değildir**: onlar
 * yalnızca kendi ebeveynlerinin içinde yaşayan yapısal düğümlerdir.
 * `blockquote.children` bir `tableRow` kabul etmemeli. mdast'ın
 * `BlockContent` / `ListContent` / `TableContent` ayrımı budur.
 */
export type Block =
	| Paragraph
	| Heading
	| Blockquote
	| List
	| Code
	| ThematicBreak
	| Html
	| Definition
	| Table;

/** Yalnızca belirli bir ebeveynin içinde geçerli olan yapısal düğümler. */
export type Structural = ListItem | TableRow | TableCell;

// ---------------------------------------------------------------------------
// Satır içi düğümler
// ---------------------------------------------------------------------------

export interface Text extends NodeBase {
	type: "text";
	value: string;
}

export interface Emphasis extends NodeBase {
	type: "emphasis";
	children: Inline[];
	syntax?: EmphasisSyntax;
}

export interface Strong extends NodeBase {
	type: "strong";
	children: Inline[];
	syntax?: EmphasisSyntax;
}

/**
 * Üstü çizili işaretinin uzunluğu.
 *
 * GFM hem `~metin~` hem `~~metin~~` kabul eder; ikisi aynı anlama gelir,
 * farklı yazılır.
 */
export interface DeleteSyntax {
	length: 1 | 2;
}

/** GFM üstü çizili (`~~metin~~`). */
export interface Delete extends NodeBase {
	type: "delete";
	children: Inline[];
	syntax?: DeleteSyntax;
}

export interface InlineCode extends NodeBase {
	type: "inlineCode";
	value: string;
	syntax?: InlineCodeSyntax;
}

export interface Link extends NodeBase {
	type: "link";
	url: string;
	title: string | null;
	children: Inline[];
	syntax?: LinkSyntax;
}

/**
 * Görsel. mdast'ta görsel **satır içidir**, blok değil — tek başına duran bir
 * görsel, içinde görsel olan bir paragraftır. Analiz taslağı bunu blok olarak
 * listeliyordu; mdast uyumluluğu adına burada satır içi tutuldu.
 */
export interface Image extends NodeBase {
	type: "image";
	url: string;
	alt: string | null;
	title: string | null;
	syntax?: LinkSyntax;
}

export interface LinkReference extends NodeBase {
	type: "linkReference";
	identifier: string;
	label: string;
	children: Inline[];
	syntax?: ReferenceSyntax;
}

export interface ImageReference extends NodeBase {
	type: "imageReference";
	identifier: string;
	label: string;
	alt: string | null;
	syntax?: ReferenceSyntax;
}

/** Sert satır sonu: satır sonunda iki boşluk ya da ters bölü. */
export interface Break extends NodeBase {
	type: "break";
	syntax?: BreakSyntax;
}

/**
 * Satır içi içerik.
 *
 * `Html` burada da bulunur: mdast ham HTML için blok ve satır içi ayrımı
 * yapmaz, ikisi de `type: "html"`tir. Ayrı bir `inlineHtml` tipi uydurmak
 * uyumluluğu bozardı — bunun yerine künye kaydında (`NodeSpecs`) `html`
 * iki gruba birden ait olarak işaretlenir.
 */
export type Inline =
	| Text
	| Emphasis
	| Strong
	| Delete
	| InlineCode
	| Link
	| Image
	| LinkReference
	| ImageReference
	| Html
	| Break;

// ---------------------------------------------------------------------------
// Birleşim ve yardımcı tipler
// ---------------------------------------------------------------------------

/** Ağaçtaki herhangi bir düğüm. */
export type Node = Root | Block | Structural | Inline | Frontmatter;

/** Herhangi bir düğümün `type` değeri. */
export type NodeType = Node["type"];

/** Tipe göre düğüm seçmek için: `NodeOf<"heading">` → `Heading`. */
export type NodeOf<T extends NodeType> = Extract<Node, { type: T }>;

/** Çocuğu olan düğümler. */
export type ParentNode = Extract<Node, { children: unknown[] }>;

/** Metin değeri taşıyan yaprak düğümler. */
export type LiteralNode = Extract<Node, { value: string }>;

// ---------------------------------------------------------------------------
// Düğüm künyesi (NodeSpec)
// ---------------------------------------------------------------------------

/** Düğümün ağaçtaki katmanı. */
export type NodeGroup = "root" | "block" | "structural" | "inline" | "frontmatter";

/**
 * Düğümün ne tuttuğu.
 *
 * Gezinme yardımcıları (F1-02) bunu okuyarak her düğüm tipi için ayrı `switch`
 * yazmaktan kurtulur: `children` içeren her içerik modeli gezilebilir,
 * `value` ve `void` yapraktır.
 */
export type ContentModel =
	| "blocks"
	| "inlines"
	| "listItems"
	| "tableRows"
	| "tableCells"
	| "value"
	| "void";

/** Tek bir düğüm tipinin künyesi. */
export interface NodeSpec {
	readonly type: NodeType;
	/**
	 * Düğümün ait olduğu katman(lar).
	 *
	 * Dizi olmasının tek sebebi `html`: mdast'ta ham HTML hem blok hem satır
	 * içi olabilir ve ikisi de aynı düğüm tipidir. Geri kalan her tipin tek
	 * elemanlı grubu vardır.
	 */
	readonly groups: readonly NodeGroup[];
	readonly content: ContentModel;
	/** Yazım tercihi (`syntax`) taşıyabilir mi. */
	readonly hasSyntax: boolean;
}

/**
 * Bütün düğüm tiplerinin künye kaydı.
 *
 * `Record<NodeType, ...>` olduğu için birliğe yeni bir düğüm eklendiğinde
 * künyesini yazmayı unutmak **derleme hatasıdır**. Uygulaması `spec.ts`'te.
 */
export type NodeSpecs = {
	readonly [T in NodeType]: NodeSpec & { readonly type: T };
};
