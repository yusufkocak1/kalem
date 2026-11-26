const TR = {
	"Search Graylog": "Graylog'da ara",
	"Write a query, or start from one of these:": "Bir sorgu yazın ya da şunlardan biriyle başlayın:",
	Search: "Ara",
	"All streams": "Tüm akışlar",
	"Last 5 minutes": "Son 5 dakika",
	"Last 15 minutes": "Son 15 dakika",
	"Last hour": "Son 1 saat",
	"Last 4 hours": "Son 4 saat",
	"Last day": "Son 1 gün",
	"Last 7 days": "Son 7 gün",
	Searching: "Aranıyor…",
	"No messages matched": "Eşleşen mesaj yok",
	"Widen the time, or loosen the query.": "Zaman aralığını genişletin ya da sorguyu gevşetin.",
	"{0} of {1} messages": "{1} mesajdan {0} tanesi",
	"{0} ms": "{0} ms",
	Copy: "Kopyala",
	Copied: "Kopyalandı",
	Connected: "Bağlı",
	"Not connected": "Bağlı değil",
	Fields: "Alanlar",
};

export function translator(language) {
	const words = language === "tr" ? TR : {};
	return (text, ...values) =>
		(words[text] ?? text).replace(/\{(\d+)\}/g, (match, index) =>
			index < values.length ? String(values[index]) : match,
		);
}
