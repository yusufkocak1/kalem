/**
 * @kalem/ui — Arayüz metinleri  (İş listesi: F3-03, F6-10 hazırlığı)
 *
 * ## Neden tek bir nesne
 *
 * Arayüzün gördüğü **her** metin buradan geçiyor; hiçbir bileşen kendi
 * içinde dize taşımıyor. Böylece dil değiştirmek tek bir nesne vermek
 * oluyor ve i18n (F6-10) yeni bir mekanizma gerektirmiyor — yalnızca daha
 * çok sözlük.
 *
 * Çeviri kütüphanesi yok: çoğul kuralı, bağlam, sayı biçimi gibi
 * ihtiyaçlar yok. Düz bir sözlük, ihtiyacın tamamını karşılıyor ve
 * bağımlılık listesini boş tutuyor.
 *
 * ## Varsayılan neden Türkçe değil
 *
 * Kütüphane uluslararası yayımlanacak; varsayılan İngilizce, Türkçe
 * sözlük `trLabels` olarak hazır. Kod ve yorumlar Türkçe kalıyor —
 * o, projenin kendi tercihi ve kullanıcıya görünmüyor.
 */

export interface UiLabels {
	// Balon araç çubuğu
	readonly formatting: string;
	readonly bold: string;
	readonly italic: string;
	readonly strikethrough: string;
	readonly code: string;
	readonly link: string;
	readonly blockType: string;
	readonly paragraph: string;
	readonly heading1: string;
	readonly heading2: string;
	readonly heading3: string;
	readonly quote: string;
	readonly codeBlock: string;

	// Bağlantı akışı
	readonly linkUrl: string;
	readonly linkApply: string;
	readonly linkRemove: string;
	readonly linkOpen: string;
	readonly linkInvalid: string;

	// Slash menü
	readonly slashMenu: string;
	readonly slashEmpty: string;
	readonly bulletList: string;
	readonly orderedList: string;
	readonly taskList: string;
	readonly divider: string;
	readonly heading4: string;

	// Blok tutamacı ve menüsü
	readonly blockHandle: string;
	readonly blockMenu: string;
	readonly blockAdd: string;
	readonly duplicate: string;
	readonly delete: string;
	readonly moveUp: string;
	readonly moveDown: string;

	// Yer tutucu
	readonly placeholder: string;

	// Canlı bölge duyuruları
	readonly movedUp: string;
	readonly movedDown: string;
	readonly blockDeleted: string;
}

export const enLabels: UiLabels = {
	formatting: "Formatting",
	bold: "Bold",
	italic: "Italic",
	strikethrough: "Strikethrough",
	code: "Inline code",
	link: "Link",
	blockType: "Block type",
	paragraph: "Paragraph",
	heading1: "Heading 1",
	heading2: "Heading 2",
	heading3: "Heading 3",
	quote: "Quote",
	codeBlock: "Code block",

	linkUrl: "Address",
	linkApply: "Apply",
	linkRemove: "Remove link",
	linkOpen: "Open link",
	linkInvalid: "This address cannot be used",

	slashMenu: "Insert block",
	slashEmpty: "No matches",
	bulletList: "Bulleted list",
	orderedList: "Numbered list",
	taskList: "Task list",
	divider: "Divider",
	heading4: "Heading 4",

	blockHandle: "Move block",
	blockMenu: "Block actions",
	blockAdd: "Add block below",
	duplicate: "Duplicate",
	delete: "Delete",
	moveUp: "Move up",
	moveDown: "Move down",

	placeholder: "Start writing, or press / for commands",

	movedUp: "Block moved up",
	movedDown: "Block moved down",
	blockDeleted: "Block deleted",
};

export const trLabels: UiLabels = {
	formatting: "Biçimlendirme",
	bold: "Kalın",
	italic: "İtalik",
	strikethrough: "Üstü çizili",
	code: "Satır içi kod",
	link: "Bağlantı",
	blockType: "Blok türü",
	paragraph: "Paragraf",
	heading1: "Başlık 1",
	heading2: "Başlık 2",
	heading3: "Başlık 3",
	quote: "Alıntı",
	codeBlock: "Kod bloğu",

	linkUrl: "Adres",
	linkApply: "Uygula",
	linkRemove: "Bağlantıyı kaldır",
	linkOpen: "Bağlantıyı aç",
	linkInvalid: "Bu adres kullanılamaz",

	slashMenu: "Blok ekle",
	slashEmpty: "Eşleşme yok",
	bulletList: "Madde imli liste",
	orderedList: "Numaralı liste",
	taskList: "Görev listesi",
	divider: "Ayırıcı",
	heading4: "Başlık 4",

	blockHandle: "Bloğu taşı",
	blockMenu: "Blok işlemleri",
	blockAdd: "Altına blok ekle",
	duplicate: "Çoğalt",
	delete: "Sil",
	moveUp: "Yukarı taşı",
	moveDown: "Aşağı taşı",

	placeholder: "Yazmaya başlayın veya / ile komut çalıştırın",

	movedUp: "Blok yukarı taşındı",
	movedDown: "Blok aşağı taşındı",
	blockDeleted: "Blok silindi",
};

/**
 * Belge diline göre sözlük.
 *
 * Yalnızca dil koduna bakılıyor, bölgeye değil: `tr-TR` ile `tr` aynı
 * sözlüğü alıyor.
 */
export function labelsFor(lang: string | null | undefined): UiLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trLabels : enLabels;
}
