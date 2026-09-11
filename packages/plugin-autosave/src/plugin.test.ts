/**
 * Otomatik kaydetme — testler  (İş listesi: F4-07)
 *
 * Eklenti DOM'a dokunmuyor (gösterge ayrı bir dosyada), yani durum
 * makinesinin tamamı tarayıcısız sınanabiliyor: sahte bir
 * `PluginContext`, sahte bir depo ve elle çözülen sözler.
 *
 * Asıl sınanan şey zamanlama: eş zamanlı kayıtlar, hata sonrası kurtarma
 * ve söküldükten sonra dönen yanıtlar.
 */
import type { Root } from "@kalem/core";
import { parse } from "@kalem/core";
import type { PluginContext } from "@kalem/editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveState } from "./plugin.js";
import { autosavePlugin } from "./plugin.js";

/** Elle çözülebilen söz. */
function bekleyen(): { promise: Promise<void>; coz: () => void; reddet: (e: Error) => void } {
	let coz!: () => void;
	let reddet!: (e: Error) => void;
	const promise = new Promise<void>((r, j) => {
		coz = r;
		reddet = j;
	});
	return { promise, coz, reddet };
}

/** Bellekte yaşayan `Storage`. */
function sahteDepo(): Storage {
	const veri = new Map<string, string>();
	return {
		get length() {
			return veri.size;
		},
		clear: () => veri.clear(),
		getItem: (k) => veri.get(k) ?? null,
		key: (i) => Array.from(veri.keys())[i] ?? null,
		removeItem: (k) => {
			veri.delete(k);
		},
		setItem: (k, v) => {
			veri.set(k, v);
		},
	};
}

/** Editör olmadan eklentiye verilebilen en küçük bağlam. */
function sahteCtx(doc: Root) {
	const dinleyiciler: (() => void)[] = [];
	const ctx = {
		getDocument: () => doc,
		getCaret: () => null,
		applyEdit: () => false,
		// `defaultView` yok: eklenti `beforeunload` aboneliğini atlıyor.
		element: { ownerDocument: { defaultView: null }, closest: () => null },
		isReadOnly: () => false,
		on: (_event: string, handler: () => void) => {
			dinleyiciler.push(handler);
			return () => {
				const i = dinleyiciler.indexOf(handler);
				if (i >= 0) dinleyiciler.splice(i, 1);
			};
		},
	} as unknown as PluginContext;

	return {
		ctx,
		/** Belgeyi değiştirip `change` yayıyor. */
		degistir(md: string) {
			doc = parse(md);
			(ctx as unknown as { getDocument: () => Root }).getDocument = () => doc;
			for (const h of [...dinleyiciler]) h();
		},
	};
}

let durumlar: SaveState[] = [];

beforeEach(() => {
	durumlar = [];
});

/** Kurulmuş bir eklenti ve onu süren yardımcılar. */
function kur(secenekler: Partial<Parameters<typeof autosavePlugin>[0]> = {}) {
	const kayitlar: string[] = [];
	const sahte = sahteCtx(parse("ilk\n"));
	const eklenti = autosavePlugin({
		delay: 0,
		onStateChange: (s) => durumlar.push(s),
		save: (md) => {
			kayitlar.push(md);
		},
		...secenekler,
	});
	const temizle = eklenti.setup?.(sahte.ctx);
	return { eklenti, kayitlar, degistir: sahte.degistir, temizle };
}

describe("durum akışı", () => {
	it("kurulduğunda boşta", () => {
		const { eklenti } = kur();
		expect(eklenti.state()).toBe("idle");
	});

	it("kurulurken kaydetmiyor", () => {
		// Açılan her editörün sunucuya gereksiz bir yazma yapması.
		const { kayitlar } = kur();
		expect(kayitlar).toEqual([]);
	});

	it("değişiklikten sonra kaydediyor", async () => {
		const { kayitlar, degistir, eklenti } = kur();
		degistir("yeni metin\n");
		await eklenti.saveNow();
		expect(kayitlar).toEqual(["yeni metin\n"]);
		expect(eklenti.state()).toBe("saved");
	});

	it("durumlar sırayla geçiyor", async () => {
		const { degistir, eklenti } = kur();
		degistir("yeni\n");
		await eklenti.saveNow();
		// Kurulum `idle` bildirmiyor: durum zaten `idle` ve değişmeyen bir
		// durumu duyurmak, göstergeyi boş yere çizdirmek olurdu.
		expect(durumlar).toEqual(["dirty", "saving", "saved"]);
	});

	it("değişmemiş belgeyi yeniden kaydetmiyor", async () => {
		const { kayitlar, degistir, eklenti } = kur();
		degistir("yeni\n");
		await eklenti.saveNow();
		await eklenti.saveNow();
		expect(kayitlar).toHaveLength(1);
	});

	it("gecikme sonunda kendiliğinden kaydediyor", async () => {
		vi.useFakeTimers();
		try {
			const { kayitlar, degistir } = kur({ delay: 50 });
			degistir("yeni\n");
			expect(kayitlar).toEqual([]);
			await vi.advanceTimersByTimeAsync(60);
			expect(kayitlar).toEqual(["yeni\n"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("art arda değişiklikler tek kayda düşüyor", async () => {
		vi.useFakeTimers();
		try {
			const { kayitlar, degistir } = kur({ delay: 50 });
			degistir("bir\n");
			await vi.advanceTimersByTimeAsync(20);
			degistir("iki\n");
			await vi.advanceTimersByTimeAsync(20);
			degistir("üç\n");
			await vi.advanceTimersByTimeAsync(60);
			expect(kayitlar).toEqual(["üç\n"]);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("eş zamanlılık", () => {
	it("kayıt sürerken ikincisi başlatılmıyor", async () => {
		const ilk = bekleyen();
		const cagrilar: string[] = [];
		const { degistir, eklenti } = kur({
			save: (md) => {
				cagrilar.push(md);
				return ilk.promise;
			},
		});

		degistir("bir\n");
		const a = eklenti.saveNow();
		degistir("iki\n");
		const b = eklenti.saveNow();
		expect(cagrilar).toEqual(["bir\n"]);

		ilk.coz();
		await Promise.all([a, b]);
		// Kayıt biterken belge değişmişti: bir kez daha çalışıyor.
		expect(cagrilar).toEqual(["bir\n", "iki\n"]);
	});

	it("sürerken gelen birden çok değişiklik tek tekrar üretiyor", async () => {
		const ilk = bekleyen();
		const cagrilar: string[] = [];
		const { degistir, eklenti } = kur({
			save: (md) => {
				cagrilar.push(md);
				return cagrilar.length === 1 ? ilk.promise : undefined;
			},
		});

		degistir("bir\n");
		const a = eklenti.saveNow();
		degistir("iki\n");
		void eklenti.saveNow();
		degistir("üç\n");
		void eklenti.saveNow();
		ilk.coz();
		await a;
		expect(cagrilar).toEqual(["bir\n", "üç\n"]);
	});
});

describe("hata ve kurtarma", () => {
	it("hata durumu bildiriliyor", async () => {
		const { degistir, eklenti } = kur({
			save: () => Promise.reject(new Error("ağ yok")),
		});
		degistir("yeni\n");
		await eklenti.saveNow();
		expect(eklenti.state()).toBe("error");
	});

	it("hata metni yerel depoya yazıyor", async () => {
		const storage = sahteDepo();
		const { degistir, eklenti } = kur({
			storage,
			storageKey: "kalem:taslak:1",
			save: () => Promise.reject(new Error("ağ yok")),
		});
		degistir("kurtarılacak\n");
		await eklenti.saveNow();
		expect(eklenti.recovered()).toBe("kurtarılacak\n");
	});

	it("başarılı kayıt taslağı siliyor", async () => {
		const storage = sahteDepo();
		let patla = true;
		const { degistir, eklenti } = kur({
			storage,
			storageKey: "kalem:taslak:1",
			save: () => (patla ? Promise.reject(new Error("ağ yok")) : undefined),
		});

		degistir("bir\n");
		await eklenti.saveNow();
		expect(eklenti.recovered()).not.toBeNull();

		patla = false;
		degistir("iki\n");
		await eklenti.saveNow();
		expect(eklenti.recovered()).toBeNull();
	});

	it("anahtar verilmezse kurtarma kapalı", async () => {
		// Rastgele anahtar üretmek, başka bir belgenin taslağını buraya
		// getirme riski taşıyor.
		const storage = sahteDepo();
		const { degistir, eklenti } = kur({
			storage,
			save: () => Promise.reject(new Error("ağ yok")),
		});
		degistir("yeni\n");
		await eklenti.saveNow();
		expect(eklenti.recovered()).toBeNull();
		expect(storage.length).toBe(0);
	});

	it("kurtarma kaydı elle silinebiliyor", async () => {
		const storage = sahteDepo();
		const { degistir, eklenti } = kur({
			storage,
			storageKey: "k",
			save: () => Promise.reject(new Error("x")),
		});
		degistir("yeni\n");
		await eklenti.saveNow();
		eklenti.clearRecovered();
		expect(eklenti.recovered()).toBeNull();
	});

	it("erişilemeyen depo eklentiyi kırmıyor", async () => {
		const patlayan = {
			getItem: () => {
				throw new Error("erişim yok");
			},
			setItem: () => {
				throw new Error("erişim yok");
			},
			removeItem: () => {
				throw new Error("erişim yok");
			},
		} as unknown as Storage;

		const { degistir, eklenti } = kur({
			storage: patlayan,
			storageKey: "k",
			save: () => Promise.reject(new Error("ağ yok")),
		});
		degistir("yeni\n");
		await eklenti.saveNow();
		expect(eklenti.state()).toBe("error");
		expect(eklenti.recovered()).toBeNull();
	});
});

describe("sökülme", () => {
	it("bekleyen kayıt iptal ediliyor", async () => {
		vi.useFakeTimers();
		try {
			const { kayitlar, degistir, temizle } = kur({ delay: 50 });
			degistir("yeni\n");
			temizle?.();
			await vi.advanceTimersByTimeAsync(100);
			expect(kayitlar).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("süren kayda iptal işareti gidiyor", async () => {
		const ilk = bekleyen();
		let iptalEdildi = false;
		const { degistir, eklenti, temizle } = kur({
			save: (_md, signal) => {
				signal.addEventListener("abort", () => {
					iptalEdildi = true;
				});
				return ilk.promise;
			},
		});
		degistir("yeni\n");
		const is = eklenti.saveNow();
		temizle?.();
		expect(iptalEdildi).toBe(true);
		ilk.coz();
		await is;
	});

	it("söküldükten sonra değişiklik kaydetmiyor", async () => {
		const { kayitlar, degistir, temizle } = kur();
		temizle?.();
		degistir("yeni\n");
		expect(kayitlar).toEqual([]);
	});
});
