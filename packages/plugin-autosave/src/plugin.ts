/**
 * `@kalem/plugin-autosave` — Otomatik kaydetme  (İş listesi: F4-07)
 *
 * Yazma durunca kaydediyor, durumu bildiriyor ve kaydedilemeyeni yerel
 * depoda tutuyor.
 *
 * ## Kaydetme kancası dışarıdan
 *
 * Eklenti ağ hakkında hiçbir şey bilmiyor (F4-01'deki aynı karar):
 * `save(markdown)` çağrılıyor, gerisi gömen uygulamanın. Hangi sunucu,
 * hangi kimlik doğrulama, hangi çakışma çözümü — hepsi orada.
 *
 * ## Neden aynı anda tek kayıt
 *
 * Kullanıcı yazmaya devam ederken bir önceki kayıt hâlâ sürüyor
 * olabiliyor. Paralel istek göndermek, sunucuya **sırası karışmış**
 * sürümler yollamak demek: ağda geciken eski bir kayıt, yenisinin üstüne
 * yazabiliyor. Bu yüzden bir kayıt sürerken yenisi başlatılmıyor;
 * biterken belge yine değişmişse bir kez daha çalışıyor.
 *
 * ## Kurtarma neden `localStorage`
 *
 * Kayıt başarısız olduğunda (ağ yok, sekme kapanıyor) yazılan metnin
 * kaybolmaması gerekiyor. `localStorage` eşzamanlı ve `beforeunload`
 * sırasında çalışan tek depo — `IndexedDB` asenkron olduğu için sekme
 * kapanırken yazma sözü verip tutamıyor.
 *
 * Kurtarma kaydı **otomatik uygulanmıyor**. Editör açıldığında yerel
 * kopyayı sessizce yüklemek, kullanıcının sunucudaki daha yeni sürümünü
 * gizleyebilir. Bunun yerine `recovered()` soruluyor ve ne yapılacağına
 * gömen uygulama karar veriyor.
 */
import { serialize } from "@kalem/core";
import type { Plugin, PluginContext } from "@kalem/editor";

/** Kaydetmenin görünen durumu. */
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveOptions {
	/** Belgeyi kaydeden kanca; hata fırlatırsa durum `error` oluyor. */
	save: (markdown: string, signal: AbortSignal) => Promise<void> | void;
	/** Yazma durduktan kaç ms sonra kaydedileceği (varsayılan 1500). */
	delay?: number;
	/**
	 * Kurtarma kaydının anahtarı.
	 *
	 * Aynı kaynakta birden çok belge açılabiliyor; anahtar belgeye özgü
	 * olmalı (`kalem:taslak:<belge-kimliği>` gibi). Verilmezse yerel
	 * kurtarma **kapalı**: rastgele bir anahtar üretmek, başka bir
	 * belgenin taslağını bu belgeye getirme riski taşıyor.
	 */
	storageKey?: string;
	/** Depo; verilmezse `localStorage`. Test ve SSR için. */
	storage?: Storage | null;
	/** Durum değiştiğinde — göstergeyi çizen uygulama için. */
	onStateChange?: (state: SaveState, error?: Error) => void;
}

export interface AutosavePlugin extends Plugin {
	/** Güncel durum. */
	state(): SaveState;
	/** Beklemeden kaydeder. */
	saveNow(): Promise<void>;
	/**
	 * Yerel depodaki kurtarma kaydı; yoksa `null`.
	 *
	 * Kayıt başarısız olduğunda ya da sekme kapandığında yazılıyor.
	 * Uygulanıp uygulanmayacağına gömen uygulama karar veriyor.
	 */
	recovered(): string | null;
	/** Kurtarma kaydını siler. */
	clearRecovered(): void;
}

export function autosavePlugin(options: AutosaveOptions): AutosavePlugin {
	const gecikme = options.delay ?? 1500;

	let ctx: PluginContext | null = null;
	let durum: SaveState = "idle";
	let zamanlayici: ReturnType<typeof setTimeout> | null = null;
	let suren: Promise<void> | null = null;
	let kontrol: AbortController | null = null;
	/** En son başarıyla kaydedilen metin. */
	let kaydedilen: string | null = null;
	/** Kayıt sürerken belge yine değiştiyse. */
	let tekrar = false;

	function depo(): Storage | null {
		if (options.storage !== undefined) return options.storage;
		try {
			return globalThis.localStorage ?? null;
		} catch {
			// Üçüncü taraf çerez kısıtlaması olan bir iframe'de erişim
			// **fırlatıyor**; kurtarma yoksa da eklenti çalışmaya devam etmeli.
			return null;
		}
	}

	function durumaGec(yeni: SaveState, hata?: Error): void {
		if (durum === yeni && hata === undefined) return;
		durum = yeni;
		options.onStateChange?.(yeni, hata);
	}

	function metin(): string {
		return ctx === null ? "" : serialize(ctx.getDocument());
	}

	function taslakYaz(deger: string): void {
		if (options.storageKey === undefined) return;
		try {
			depo()?.setItem(options.storageKey, deger);
		} catch {
			// Kota dolu ya da özel kip: kurtarma kaybediliyor, kaydetme
			// akışı sürüyor. Kullanıcıya gösterilecek bir şey yok.
		}
	}

	function taslakSil(): void {
		if (options.storageKey === undefined) return;
		try {
			depo()?.removeItem(options.storageKey);
		} catch {
			/* yukarıdaki gerekçe */
		}
	}

	async function kaydet(): Promise<void> {
		if (ctx === null) return;
		if (suren !== null) {
			// Kayıt sürüyor: bitince bir kez daha (dosya başındaki not).
			tekrar = true;
			return suren;
		}

		const deger = metin();
		if (deger === kaydedilen) {
			durumaGec("saved");
			return;
		}

		kontrol = new AbortController();
		durumaGec("saving");

		const is = (async () => {
			try {
				await options.save(deger, (kontrol as AbortController).signal);
				kaydedilen = deger;
				taslakSil();
				durumaGec("saved");
			} catch (sebep) {
				// Başarısız kayıt yerel depoya düşüyor: kullanıcı yazdığını
				// kaybetmesin.
				taslakYaz(deger);
				durumaGec("error", sebep instanceof Error ? sebep : new Error(String(sebep)));
			} finally {
				suren = null;
				kontrol = null;
			}
		})();

		suren = is;
		await is;

		if (tekrar) {
			tekrar = false;
			await kaydet();
		}
	}

	function planla(): void {
		durumaGec("dirty");
		if (zamanlayici !== null) clearTimeout(zamanlayici);
		if (gecikme <= 0) {
			void kaydet();
			return;
		}
		zamanlayici = setTimeout(() => {
			zamanlayici = null;
			void kaydet();
		}, gecikme);
	}

	/**
	 * Sekme kapanırken kaydedilmemiş metin yerel depoya yazılıyor.
	 *
	 * Burada ağa gidilmiyor: `beforeunload` sırasında başlatılan bir
	 * istek tarayıcı tarafından kesilebiliyor ve söz verip tutmamak,
	 * hiç söz vermemekten kötü. `localStorage` eşzamanlı olduğu için
	 * bitmesi garanti.
	 */
	const kapanirken = (): void => {
		if (durum === "dirty" || durum === "error" || zamanlayici !== null) taslakYaz(metin());
	};

	return {
		name: "autosave",

		setup(context: PluginContext) {
			ctx = context;
			// Açılıştaki içerik "kaydedilmiş" sayılıyor: kullanıcı henüz bir
			// şey yazmadı ve kurulur kurulmaz sunucuya istek atmak, açılan
			// her editörün gereksiz bir yazma yapması demek.
			kaydedilen = metin();
			durumaGec("idle");

			const view = context.element.ownerDocument.defaultView;
			view?.addEventListener("beforeunload", kapanirken);
			const birak = context.on("change", planla);

			return () => {
				birak();
				view?.removeEventListener("beforeunload", kapanirken);
				if (zamanlayici !== null) clearTimeout(zamanlayici);
				zamanlayici = null;
				// Süren kayıt iptal ediliyor: editör söküldükten sonra dönen
				// bir yanıtın yazacağı bir yer yok.
				kontrol?.abort();
				suren = null;
				tekrar = false;
				ctx = null;
			};
		},

		state: () => durum,
		saveNow: kaydet,

		recovered() {
			if (options.storageKey === undefined) return null;
			try {
				return depo()?.getItem(options.storageKey) ?? null;
			} catch {
				return null;
			}
		},

		clearRecovered: taslakSil,
	};
}
