/**
 * Konumlandırma hesabı  (İş listesi: F3-01)
 *
 * `computePosition` saf: girdi iki dikdörtgen ve görünür alan ölçüsü,
 * çıktı koordinat. Bu ayrım tam da bunun için — kenar durumları (üstte
 * yer yok, sağa taşıyor, hiçbir yere sığmıyor) tarayıcı açmadan
 * sabitlenebiliyor.
 */
import { describe, expect, it } from "vitest";
import { computePosition } from "./floating.js";

const gorunur = { width: 1000, height: 800 };
const kutu = { width: 200, height: 40 };

/** Ekranın ortasında, 100 px genişliğinde bir seçim. */
const capa = (top: number, left = 400) => ({ top, bottom: top + 20, left, width: 100 });

describe("yerleşim", () => {
	it("yer varsa üste koyuyor", () => {
		const sonuc = computePosition(capa(400), kutu, gorunur);
		expect(sonuc.placement).toBe("top");
		// 400 (üst) - 40 (yükseklik) - 8 (boşluk)
		expect(sonuc.y).toBe(352);
	});

	it("üstte yer yoksa alta geçiyor", () => {
		const sonuc = computePosition(capa(10), kutu, gorunur);
		expect(sonuc.placement).toBe("bottom");
		// 30 (alt) + 8 (boşluk)
		expect(sonuc.y).toBe(38);
	});

	it("alt tercih edilse de yer yoksa üste geçiyor", () => {
		const sonuc = computePosition(capa(760), kutu, gorunur, { placement: "bottom" });
		expect(sonuc.placement).toBe("top");
	});

	/** Hiçbir yere sığmıyorsa tercih korunuyor ve kırpma devreye giriyor. */
	it("dar görünür alanda kırpılıyor", () => {
		const sonuc = computePosition(capa(20), kutu, { width: 1000, height: 60 });
		expect(sonuc.y).toBeGreaterThanOrEqual(8);
		expect(sonuc.y).toBeLessThanOrEqual(60);
	});
});

describe("yatay hizalama", () => {
	it("çapanın ortasına hizalanıyor", () => {
		// Çapa 400..500, ortası 450; kutu 200 geniş → 450 - 100 = 350
		expect(computePosition(capa(400), kutu, gorunur).x).toBe(350);
	});

	it("sol kenardan taşmıyor", () => {
		expect(computePosition(capa(400, 0), kutu, gorunur).x).toBe(8);
	});

	it("sağ kenardan taşmıyor", () => {
		const sonuc = computePosition(capa(400, 950), kutu, gorunur);
		expect(sonuc.x).toBe(gorunur.width - kutu.width - 8);
	});

	/** Kutu görünür alandan genişse sol paya yapışıyor, negatife kaçmıyor. */
	it("kutu ekrandan genişse sola yapışıyor", () => {
		const sonuc = computePosition(capa(400), { width: 1200, height: 40 }, gorunur);
		expect(sonuc.x).toBe(8);
	});
});

describe("seçenekler", () => {
	it("boşluk ayarlanabiliyor", () => {
		expect(computePosition(capa(400), kutu, gorunur, { offset: 20 }).y).toBe(340);
	});

	it("kenar payı ayarlanabiliyor", () => {
		expect(computePosition(capa(400, 0), kutu, gorunur, { padding: 24 }).x).toBe(24);
	});
});
