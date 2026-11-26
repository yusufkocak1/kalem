const TR = {
	Logs: "Loglar",
	"Open a Log File…": "Log Dosyası Aç…",
	"Open a log file": "Log dosyası aç",
	"Follow application, server and build logs as they grow. Errors are coloured and counted, stack traces stay with their line.":
		"Uygulama, sunucu ve build loglarını büyüdükçe izleyin. Hatalar renklenir ve sayılır, stack trace'ler kendi satırıyla birlikte kalır.",
	Recent: "Son açılanlar",
	Close: "Kapat",
	Forget: "Listeden çıkar",
	Search: "Ara",
	"Search the log": "Logda ara",
	"Regular expression": "Düzenli ifade",
	"Match case": "Büyük/küçük harf duyarlı",
	"Only matching": "Yalnız eşleşenler",
	Follow: "İzle",
	Following: "İzleniyor",
	Paused: "Duraklatıldı",
	"Wrap lines": "Satırları kaydır",
	"Clear the view": "Görünümü temizle",
	"Load earlier": "Öncekileri yükle",
	"Jump to the end": "Sona git",
	"Start of the file": "Dosyanın başı",
	fatal: "fatal",
	error: "hata",
	warn: "uyarı",
	info: "bilgi",
	debug: "debug",
	trace: "trace",
	none: "seviyesiz",
	"{0} more lines": "{0} satır daha",
	"Show less": "Daha az göster",
	"{0} entries": "{0} kayıt",
	"{0} of {1} entries": "{0} / {1} kayıt",
	"Showing the last {0}.": "Son {0} gösteriliyor.",
	"Show more": "Daha fazla göster",
	"No entries match.": "Eşleşen kayıt yok.",
	"The file was rotated or truncated; reading it from its new end.":
		"Dosya döndürüldü ya da kısaldı; yeni sonundan okunuyor.",
	"The file is not there any more; waiting for it to come back.":
		"Dosya artık yok; geri gelmesi bekleniyor.",
	"Not a valid pattern: {0}": "Geçersiz ifade: {0}",
	"{0} is not there.": "{0} bulunamadı.",
	"{0} is a folder, not a file.": "{0} bir klasör, dosya değil.",
	"{0} new": "{0} yeni",
	Copy: "Kopyala",
	Copied: "Kopyalandı",
	"Path, e.g. logs/app.log": "Yol, örn. logs/app.log",
	Open: "Aç",
	"Log file path": "Log dosyasının yolu",
};

export function translator(language) {
	const words = language === "tr" ? TR : {};
	return (text, ...values) =>
		(words[text] ?? text).replace(/\{(\d+)\}/g, (match, index) =>
			index < values.length ? String(values[index]) : match,
		);
}
