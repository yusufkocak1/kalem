/**
 * @kalem-editor/editor — Geçmiş yığını  (İş listesi: F2-09)
 *
 * ## Neden anlık görüntü, neden ters işlem değil
 *
 * Klasik editör geçmişi her komut için bir "ters işlem" saklar; bu, her
 * yeni komutun ayrıca tersini yazmasını gerektirir ve o tersler zamanla
 * sessizce yanlışlanır. Burada gerek yok: `@kalem-editor/core`'un düzenleme
 * işlemleri **değişmez** ve yapısal paylaşımlı (F1-02), yani bir anlık
 * görüntü tüm belgeyi kopyalamıyor — yalnızca değişen yoldaki ataları.
 * Bir geçmiş kaydı pratikte tek bir kök referansı.
 *
 * Bu, F1-02'de "geri al/yinele anlık görüntüleri bir kök referansına
 * iner" diye yazılan gerekçenin karşılığını aldığı yer.
 *
 * ## Gruplama
 *
 * Harf harf geri alma kimsenin istediği şey değil. Aynı blokta, kısa
 * aralıklarla gelen yazma değişiklikleri tek kayda toplanıyor; blok
 * değişince ya da ara uzayınca yeni kayıt açılıyor. Yapısal değişiklikler
 * (Enter, silme, biçim) hiç toplanmıyor: onlar kullanıcının kafasında
 * ayrı birer adım.
 */
import type { Root } from "@kalem-editor/core";
import type { Caret } from "./block-edit.js";

export interface HistoryState {
	readonly doc: Root;
	/** Kaydın alındığı andaki imleç; geri alınca buraya dönülüyor. */
	readonly caret: Caret | null;
}

/**
 * Ardışık yazma değişikliklerinin tek kayda toplandığı süre.
 *
 * 700 ms, "yazmaya ara verdim" ile "hâlâ yazıyorum" arasındaki sınır için
 * yaygın bir değer. Kısa tutmak geçmişi harflere böler, uzun tutmak bir
 * paragrafın tamamını tek adımda sildirir.
 */
const GRUPLAMA_SURESI = 700;

/**
 * Yığın üst sınırı.
 *
 * Anlık görüntüler yapısal paylaşımlı olduğu için ucuz, ama sınırsız
 * değil: uzun bir oturumda binlerce kayıt, geri alınamayacak kadar eski
 * durumları bellekte tutmaktan başka işe yaramaz.
 */
const AZAMI_KAYIT = 200;

export class History {
	#entries: HistoryState[];
	#index = 0;
	#lastAt = 0;
	#lastKey: string | null = null;

	constructor(initial: HistoryState) {
		this.#entries = [initial];
	}

	get current(): HistoryState {
		return this.#entries[this.#index] as HistoryState;
	}

	get canUndo(): boolean {
		return this.#index > 0;
	}

	get canRedo(): boolean {
		return this.#index < this.#entries.length - 1;
	}

	/** Test ve hata ayıklama için kayıt sayısı. */
	get size(): number {
		return this.#entries.length;
	}

	/**
	 * Yeni bir durum kaydeder.
	 *
	 * `coalesceKey` verilmişse ve önceki kayıt aynı anahtarla kısa süre önce
	 * alınmışsa, yeni kayıt açılmıyor — üsttekinin üstüne yazılıyor. Anahtar
	 * genelde `"type:<blok kimliği>"`; blok değişince gruplama kendiliğinden
	 * kırılıyor.
	 */
	push(state: HistoryState, before: Caret | null, coalesceKey: string | null, now: number): void {
		const gruplanabilir =
			coalesceKey !== null &&
			coalesceKey === this.#lastKey &&
			now - this.#lastAt < GRUPLAMA_SURESI &&
			this.#index === this.#entries.length - 1;

		this.#lastKey = coalesceKey;
		this.#lastAt = now;

		if (gruplanabilir) {
			// Grubun **başlangıç** imleci korunuyor: geri alınca kullanıcı
			// yazmaya başladığı yere dönmeli, bıraktığı yere değil.
			const onceki = this.#entries[this.#index] as HistoryState;
			this.#entries[this.#index] = { doc: state.doc, caret: onceki.caret };
			return;
		}

		// Geri alınca dönülecek yer, değişiklikten **önceki** imleç — ve o,
		// terk etmek üzere olduğumuz kayda ait. Sonraki imleci saklamak
		// yetmiyordu: ilk kaydın imleci hiç dolmuyor ve geri alan kullanıcı
		// bloğun başına düşüyordu.
		if (before !== null) {
			this.#entries[this.#index] = {
				...(this.#entries[this.#index] as HistoryState),
				caret: before,
			};
		}

		// İleri dallar atılıyor: geri alıp sonra yazan kullanıcı yeni bir
		// tarih yazmıştır.
		this.#entries.length = this.#index + 1;
		this.#entries.push(state);
		if (this.#entries.length > AZAMI_KAYIT) this.#entries.shift();
		this.#index = this.#entries.length - 1;
	}

	undo(): HistoryState | null {
		if (!this.canUndo) return null;
		this.#index -= 1;
		this.#kes();
		return this.current;
	}

	redo(): HistoryState | null {
		if (!this.canRedo) return null;
		this.#index += 1;
		this.#kes();
		return this.current;
	}

	/** Yığını tek bir duruma indirir — başka bir belge açıldığında. */
	reset(state: HistoryState): void {
		this.#entries = [state];
		this.#index = 0;
		this.#kes();
	}

	/**
	 * Gruplamayı kırar.
	 *
	 * Geri alma sonrası yazmaya devam etmek, geri alınan kaydın üstüne
	 * yazmamalı; aksi hâlde bir Ctrl+Z geri alınamaz hâle gelirdi.
	 */
	#kes(): void {
		this.#lastKey = null;
		this.#lastAt = 0;
	}
}
