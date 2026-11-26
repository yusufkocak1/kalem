const TR = {
	"WSDL address": "WSDL adresi",
	Load: "Yükle",
	Reload: "Yeniden yükle",
	Services: "Servisler",
	Recent: "Son kullanılanlar",
	"Load a WSDL": "Bir WSDL yükleyin",
	"Its services and operations show here, each with a sample request made from its schema.":
		"Servisleri ve operasyonları burada görünür; her birinin şemasından üretilmiş örnek isteğiyle.",
	"Pick an operation": "Bir operasyon seçin",
	"Its request opens here, ready to fill in and send.":
		"İsteği burada açılır; doldurup gönderebilirsiniz.",
	Endpoint: "Uç nokta",
	Send: "Gönder",
	Envelope: "Zarf",
	Headers: "Başlıklar",
	Auth: "Yetki",
	Username: "Kullanıcı adı",
	Password: "Parola",
	"Basic authentication, sent with each call.": "Temel kimlik doğrulama; her çağrıyla gönderilir.",
	"Reset to sample": "Örneğe dön",
	Format: "Düzenle",
	Response: "Yanıt",
	"Send the request": "İsteği gönderin",
	"The response shows here, with any SOAP fault.": "Yanıt burada görünür; SOAP fault varsa o da.",
	Sending: "Gönderiliyor…",
	Pretty: "Düzenli",
	Raw: "Ham",
	Copy: "Kopyala",
	Copied: "Kopyalandı",
	Body: "Gövde",
	"Request failed": "İstek başarısız",
	"SOAP fault": "SOAP fault",
	Key: "Anahtar",
	Value: "Değer",
	Remove: "Kaldır",
	Forget: "Unut",
	operations: "operasyon",
	"Sent headers": "Gönderilen başlıklar",
	"Extra headers": "Ek başlıklar",
	Filter: "Filtrele",
};

export function translator(language) {
	const words = language === "tr" ? TR : {};
	return (text) => words[text] ?? text;
}
