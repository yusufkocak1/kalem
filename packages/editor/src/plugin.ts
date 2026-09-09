/**
 * @kalem/editor — Eklenti sistemi  (İş listesi: F2-12)
 *
 * ## Ne kadar yüzey
 *
 * Eklenti üç şey yapabiliyor ve üçü de editörün gerçekten genişletme
 * noktası olan yerleri:
 *
 * - **`keymap`** — tuş yakalama. Çekirdek kısayollarından **önce**
 *   deneniyor; eklenti `true` döndürürse çekirdek o tuşu hiç görmüyor.
 * - **`inputRules`** — yazarken dönüşüm. Aynı öncelik kuralı.
 * - **`setup`** — kurulum; söküldüğünde çağrılacak temizleyiciyi döndürüyor.
 *
 * Render'a kanca **bilerek yok**. Düğüm başına bir kanca, her blok için
 * bir dolaylı çağrı demek ve blok motorunun en sıcak yolu orası; ihtiyaç
 * ölçülmeden ödenecek bir bedel değil. Görsel genişletme Faz 3'ün
 * (`@kalem/ui`) işi.
 *
 * ## Çakışma çözümü
 *
 * Tek kural: **kayıt sırası**. Önce kayıtlı eklenti önce deneniyor, ilk
 * `true` döndüren kazanıyor, çekirdek en sonda. Öncelik numarası ya da
 * bağımlılık grafiği yok — ikisi de eklenti yazarını, kendi eklentisini
 * başkalarına göre konumlandırmaya zorluyor ve tahmin edilemez hâle
 * geliyor. Sıra çağıranın elinde ve görünür.
 *
 * ## Dogfooding
 *
 * Giriş kuralları ve görev listesi davranışı **eklenti olarak** yazıldı ve
 * varsayılan olarak kayıtlı. Yani API, çekirdek bir özelliği taşıyacak
 * kadar geniş olduğunu kendi üstünde kanıtlıyor; kaldırılabildikleri
 * testle sabitleniyor.
 */
import type { Root } from "@kalem/core";
import type { Caret, EditResult } from "./block-edit.js";
import type { Editor } from "./editor.js";

/**
 * Eklentinin editöre erişimi.
 *
 * `Editor` sınıfının tamamı değil, gerekli olan kadarı. Dar tutmanın
 * sebebi ileriye dönük: bu yüzey yayımlandıktan sonra daraltılamaz.
 */
export interface PluginContext {
	/** Güncel belge. */
	getDocument(): Root;
	/** İmlecin model konumu; seçim tek bir taşıyıcıda değilse `null`. */
	getCaret(): Caret | null;
	/** Bir düzenleme sonucunu uygular (geçmişe de yazılır). */
	applyEdit(result: EditResult | null): boolean;
	/** Editörün kök elemanı — olay dinlemek isteyen eklentiler için. */
	readonly element: HTMLElement;
	/** Salt okunur mod. */
	isReadOnly(): boolean;
	/**
	 * Olay aboneliği; aboneliği bitiren fonksiyonu döndürüyor.
	 *
	 * `Editor.on` ile aynı. Eklentinin editörün durumuna **tepki
	 * verebilmesi** için gerekli ve bu ihtiyaç F4-01 yazılırken çıktı:
	 * yükleme sürerken editör bloğu yeniden çizince eklentinin `<img>`
	 * üstüne koyduğu ilerleme süslemesi kayboluyordu ve eklentinin bunu
	 * öğrenmesinin hiçbir yolu yoktu.
	 *
	 * Render kancası hâlâ yok (yukarıya bakın) ve bu ondan farklı: düğüm
	 * başına değil, değişiklik başına tek çağrı.
	 */
	on: Editor["on"];
}

/** Tuş işleyicisi: olayı tükettiyse `true` döner. */
export type PluginKeyHandler = (event: KeyboardEvent, ctx: PluginContext) => boolean;

/** Giriş kuralı: dönüşüm ürettiyse sonucu, üretmediyse `null` döner. */
export type PluginInputRule = (doc: Root, caret: Caret) => EditResult | null;

export interface Plugin {
	/** Benzersiz ad — kaldırmak ve çakışmayı bildirmek için. */
	readonly name: string;
	/** Kurulum; söküldüğünde çağrılacak temizleyiciyi döndürebilir. */
	setup?: (ctx: PluginContext) => (() => void) | void;
	/** Çekirdekten önce denenen tuş işleyicileri. */
	keymap?: PluginKeyHandler;
	/** Çekirdekten önce denenen giriş kuralları. */
	inputRules?: readonly PluginInputRule[];
}

/**
 * Kayıtlı eklentiler.
 *
 * Aynı adla ikinci bir eklenti kaydı **hata**: sessizce ezmek, hangi
 * eklentinin çalıştığını bulunamaz hâle getirirdi.
 */
export class PluginRegistry {
	readonly #plugins: Plugin[] = [];
	readonly #cleanups = new Map<string, () => void>();
	readonly #ctx: PluginContext;

	constructor(ctx: PluginContext) {
		this.#ctx = ctx;
	}

	get names(): readonly string[] {
		return this.#plugins.map((p) => p.name);
	}

	add(plugin: Plugin): void {
		if (this.#plugins.some((p) => p.name === plugin.name)) {
			throw new Error(`Eklenti adı zaten kayıtlı: "${plugin.name}"`);
		}
		this.#plugins.push(plugin);
		const cleanup = plugin.setup?.(this.#ctx);
		if (typeof cleanup === "function") this.#cleanups.set(plugin.name, cleanup);
	}

	remove(name: string): boolean {
		const index = this.#plugins.findIndex((p) => p.name === name);
		if (index < 0) return false;
		this.#plugins.splice(index, 1);
		this.#cleanups.get(name)?.();
		this.#cleanups.delete(name);
		return true;
	}

	has(name: string): boolean {
		return this.#plugins.some((p) => p.name === name);
	}

	/** Tuşu eklentilere sırayla sorar; ilk tüketen kazanır. */
	handleKey(event: KeyboardEvent): boolean {
		for (const plugin of this.#plugins) {
			if (plugin.keymap?.(event, this.#ctx) === true) return true;
		}
		return false;
	}

	/** Giriş kurallarını sırayla dener; ilk dönüşüm kazanır. */
	runInputRules(doc: Root, caret: Caret): EditResult | null {
		for (const plugin of this.#plugins) {
			for (const rule of plugin.inputRules ?? []) {
				const sonuc = rule(doc, caret);
				if (sonuc !== null) return sonuc;
			}
		}
		return null;
	}

	destroy(): void {
		for (const temizle of this.#cleanups.values()) temizle();
		this.#cleanups.clear();
		this.#plugins.length = 0;
	}
}
