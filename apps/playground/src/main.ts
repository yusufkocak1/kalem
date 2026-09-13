/**
 * Kalem playground  (İş listesi: F6-06)
 *
 * Kabul kriteri "kütüphanenin gücü 30 saniyede anlaşılıyor". O yüzden bu
 * sayfa bir özellik listesi değil, **beş iddianın kanıtı**:
 *
 * 1. Word deneyimi — balon araç çubuğu, slash menüsü, blok tutamağı.
 * 2. Çıktı Markdown — sağda, her tuşta, JSON değil.
 * 3. Gidiş-dönüş kayıpsız — rozet `serialize(parse(v)) === v` diyor.
 * 4. Word'den yapıştırma çalışıyor — tek düğme, gerçek Word HTML'i.
 * 5. Büyük belge akıcı — bin bloklu örnek yazarak sınanıyor.
 *
 * ## Neden `apps/demo` değil
 *
 * `apps/demo` on yedi tarayıcı testinin zemini: sayfalarındaki eleman
 * kimlikleri 1100 testin bağlı olduğu bir sözleşme ve üstündeki hata
 * ayıklama göstergeleri geliştirici için. Orayı ürün demosuna çevirmek
 * ikisini de bozardı — biri test zemini, öteki vitrin.
 */
import { parse, serialize } from "@kalem/core";
import { Editor } from "@kalem/editor";
import { autosavePlugin, createIndicator, trAutosaveLabels } from "@kalem/plugin-autosave";
import { codeHighlightPlugin } from "@kalem/plugin-code-highlight";
import { findReplacePlugin } from "@kalem/plugin-find-replace";
import { imageUploadPlugin } from "@kalem/plugin-image-upload";
import { outlinePlugin } from "@kalem/plugin-outline";
import { type SourceModePlugin, sourceModePlugin } from "@kalem/plugin-source-mode";
import { wordCountPlugin } from "@kalem/plugin-word-count";
import { mountUi, type Ui } from "@kalem/ui";

import "@kalem/themes/tokens.css";
import "@kalem/themes/viewer.css";
import "@kalem/themes/editor.css";
import "@kalem/themes/ui.css";
import "@kalem/themes/plugin-code.css";
import "@kalem/themes/plugin-find.css";
import "@kalem/themes/plugin-image.css";
import "@kalem/themes/plugin-outline.css";
import "@kalem/themes/plugin-word-count.css";
import "@kalem/themes/plugin-source.css";
import "@kalem/themes/plugin-autosave.css";
import "./stil.css";

import { baglantiUret, coz, GUVENLI_UZUNLUK } from "./baglanti.js";
import { ORNEKLER } from "./ornekler.js";
import { temaUygula } from "./tema.js";
import { wordYapistir } from "./word-ornegi.js";

const $ = <T extends HTMLElement>(id: string): T => {
	const el = document.getElementById(id);
	if (el === null) throw new Error(`eleman yok: #${id}`);
	return el as T;
};

const tuval = $("editor");
const cikti = $<HTMLPreElement>("cikti");
const gidisDonus = $("gidisDonus");
const bilgi = $("bilgi");
const ipucu = $("ipucu");
const paylasim = $("paylasim");

// ---------------------------------------------------------------------------
// Editör
// ---------------------------------------------------------------------------

/** Arayüz ve eklentiler editörle birlikte kuruluyor ve onunla sökülüyor. */
interface Kurulum {
	readonly editor: Editor;
	readonly ui: Ui;
	readonly kaynak: SourceModePlugin;
	sok(): void;
}

let kurulum: Kurulum | null = null;

const gosterge = createIndicator($("kayit"), { prefix: "kalem-", labels: trAutosaveLabels });

function kur(metin: string): Kurulum {
	const editor = new Editor(tuval, {
		value: metin,
		lang: "tr",
		label: "Deneme belgesi",
		inputRules: $<HTMLInputElement>("kurallar").checked,
		onChange: (markdown) => rapor(markdown),
	});

	const kaynak = sourceModePlugin({
		onModeChange: (kaynakta) => {
			$("kaynak").setAttribute("aria-pressed", String(kaynakta));
		},
	});

	const eklentiler = [
		codeHighlightPlugin(),
		findReplacePlugin(),
		outlinePlugin({ container: $("icindekiler") }),
		wordCountPlugin({ container: $("sayac") }),
		kaynak,
		autosavePlugin({
			delay: 800,
			storageKey: "kalem:playground:taslak",
			// Sunucu yok: "kaydetmek" burada tarayıcıda saklamak demek ve
			// eklentinin sözleşmesi açısından ikisi arasında fark yok.
			save: (markdown) => {
				localStorage.setItem("kalem:playground:belge", markdown);
			},
			onStateChange: (durum) => gosterge.render(durum),
		}),
		/*
		 * Görsel yükleme: sunucuya değil, `data:` adresine.
		 *
		 * Gerçek bir servis olmadan da uçtan uca çalışıyor ve çevrimdışı
		 * kalıyor. Beyaz liste `data:image/png|jpeg|gif|webp|avif`e izin
		 * veriyor; SVG kasten dışarıda (bkz. güvenlik rehberi).
		 */
		imageUploadPlugin({
			maxSize: 2 * 1024 * 1024,
			upload: ({ file, onProgress }) =>
				new Promise<string>((coz, ret) => {
					const okuyucu = new FileReader();
					okuyucu.addEventListener("load", () => {
						onProgress(1);
						coz(String(okuyucu.result));
					});
					okuyucu.addEventListener("error", () => ret(new Error("Dosya okunamadı")));
					okuyucu.readAsDataURL(file);
				}),
			onError: (hata) => {
				bilgi.textContent = hata.message;
			},
		}),
	];

	for (const eklenti of eklentiler) editor.addPlugin(eklenti);

	const cubuk = $<HTMLSelectElement>("cubuk").value;
	const ui = mountUi(editor, {
		toolbar: cubuk === "false" ? false : (cubuk as "both" | "fixed" | "bubble"),
	});

	editor.setReadOnly($<HTMLInputElement>("saltOkunur").checked);
	rapor(editor.getValue());

	return {
		editor,
		ui,
		kaynak,
		sok() {
			// Arayüz editörden **önce**: `ui.destroy()` kendi kısayol
			// eklentisini editörden kaldırıyor.
			ui.destroy();
			editor.destroy();
			tuval.replaceChildren();
		},
	};
}

/** Editörü baştan kurar; arayüz seçenekleri montaj anında okunuyor. */
function yenidenKur(metin?: string): void {
	const eski = kurulum;
	const yeni = metin ?? eski?.editor.getValue() ?? "";
	eski?.sok();
	kurulum = kur(yeni);
}

// ---------------------------------------------------------------------------
// Çıktı ve gidiş-dönüş rozeti
// ---------------------------------------------------------------------------

/**
 * Sağ paneli ve rozeti tazeler.
 *
 * Rozet iddiayı ölçüyor: metni ayrıştırıp yeniden yazmak **aynı baytları**
 * veriyor mu. Bir kütüphane bunu söyleyebilir; burada okuyucu kendi
 * yazdığı metinde görüyor.
 */
function rapor(markdown: string): void {
	cikti.textContent = markdown;

	const geri = serialize(parse(markdown));
	if (geri === markdown) {
		gidisDonus.textContent = "gidiş-dönüş: byte-birebir";
		gidisDonus.dataset["durum"] = "iyi";
	} else {
		gidisDonus.textContent = `gidiş-dönüş: ${Math.abs(geri.length - markdown.length)} karakter fark`;
		gidisDonus.dataset["durum"] = "kotu";
	}

	const blok = tuval.querySelectorAll("[data-kalem-id]").length;
	bilgi.textContent = `${blok} blok · ${markdown.length} karakter`;
}

// ---------------------------------------------------------------------------
// Denetimler
// ---------------------------------------------------------------------------

const ornekSecici = $<HTMLSelectElement>("ornek");
for (const [i, o] of ORNEKLER.entries()) {
	const secenek = document.createElement("option");
	secenek.value = String(i);
	secenek.textContent = o.ad;
	ornekSecici.append(secenek);
}

function ipucuYaz(): void {
	const o = ORNEKLER[Number(ornekSecici.value)];
	ipucu.textContent = o === undefined ? "" : o.aciklama;
}

ornekSecici.addEventListener("change", () => {
	const o = ORNEKLER[Number(ornekSecici.value)];
	if (o === undefined) return;
	ipucuYaz();
	// Yeni belge açmak: geçmişi de sıfırlıyor, o yüzden `setValue` yerine
	// baştan kurulum daha dürüst.
	yenidenKur(o.metin());
	kurulum?.editor.focus();
});

$("word").addEventListener("click", () => {
	const k = kurulum;
	if (k === null) return;
	if (k.editor.isReadOnly()) {
		bilgi.textContent = "Salt okunur modda yapıştırılamaz.";
		return;
	}
	wordYapistir(k.editor);
});

$<HTMLSelectElement>("tema").addEventListener("change", (olay) => {
	temaUygula((olay.target as HTMLSelectElement).value);
});

$<HTMLSelectElement>("cubuk").addEventListener("change", () => {
	// `mountUi` tek seferlik bir montaj; kip bir çalışma zamanı anahtarı
	// değil (bkz. temalar rehberi).
	yenidenKur();
});

$<HTMLInputElement>("kurallar").addEventListener("change", () => yenidenKur());

$<HTMLInputElement>("saltOkunur").addEventListener("change", (olay) => {
	kurulum?.editor.setReadOnly((olay.target as HTMLInputElement).checked);
});

$<HTMLInputElement>("anahat").addEventListener("change", (olay) => {
	$("icindekiler").hidden = !(olay.target as HTMLInputElement).checked;
});

$("kaynak").addEventListener("click", () => kurulum?.kaynak.toggle());

// ---------------------------------------------------------------------------
// Paylaşılabilir bağlantı  (F6-07)
// ---------------------------------------------------------------------------

function paylasimYaz(metin: string, durum: "iyi" | "uyari" = "iyi"): void {
	paylasim.textContent = metin;
	paylasim.dataset["durum"] = durum;
	paylasim.hidden = false;
}

$("paylas").addEventListener("click", () => {
	const editor = kurulum?.editor;
	if (editor === undefined) return;

	void (async () => {
		const adres = await baglantiUret(editor.getValue(), window.location.href);

		/*
		 * Karma her hâlükârda güncelleniyor: adres çubuğunun kendisi
		 * bağlantı oluyor. Pano yazması başarısız olsa bile (güvensiz
		 * köken, izin reddi) kullanıcının elinde çalışan bir şey kalıyor.
		 *
		 * `replaceState`, `location.hash = …` değil — ikincisi geçmişe
		 * kayıt ekliyor ve geri tuşu kullanıcıyı belgesinden çıkarıyordu.
		 */
		window.history.replaceState(null, "", adres);

		const uzun = adres.length > GUVENLI_UZUNLUK;
		try {
			await navigator.clipboard.writeText(adres);
			paylasimYaz(
				uzun
					? `Bağlantı kopyalandı ama uzun (${adres.length} karakter); bazı uygulamalar kesebilir.`
					: `Bağlantı kopyalandı (${adres.length} karakter). Belge adreste, sunucuda değil.`,
				uzun ? "uyari" : "iyi",
			);
		} catch {
			paylasimYaz(
				`Panoya yazılamadı; bağlantı adres çubuğunda (${adres.length} karakter).`,
				"uyari",
			);
		}
	})();
});

// ---------------------------------------------------------------------------
// Açılış
// ---------------------------------------------------------------------------

temaUygula("acik");
ipucuYaz();

void (async () => {
	// Bağlantıyla gelen belge örnek seçiminin önüne geçiyor.
	const paylasilan = await coz(window.location.hash);
	if (paylasilan === null) {
		yenidenKur(ORNEKLER[0]?.metin() ?? "");
		return;
	}
	yenidenKur(paylasilan);
	ipucu.textContent = "Bu belge paylaşılan bir bağlantıdan geldi.";
})();

// Konsoldan ve testlerden erişim; kütüphane global'e bir şey yazmıyor.
declare global {
	interface Window {
		kalemPlayground?: { editor: Editor | null };
	}
}
window.kalemPlayground = {
	get editor() {
		return kurulum?.editor ?? null;
	},
};
