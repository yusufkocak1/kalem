/**
 * Blok kimlikleri  (İş listesi: F2-05)
 *
 * Kimlik, model ile DOM arasındaki tek bağ. Bu testlerin koruduğu iki
 * özellik var: kimlikler benzersiz, ve kimlik atama ağacı **yerinde
 * değiştirmiyor** — editörün her yerinde değişmezlik varsayılıyor.
 */
import { parse } from "@kalem/core";
import { beforeEach, describe, expect, it } from "vitest";
import { assignIds, newId, resetIds } from "./ids.js";

beforeEach(() => {
	resetIds();
});

describe("newId", () => {
	it("her çağrıda farklı kimlik", () => {
		const uretilen = new Set([newId(), newId(), newId()]);
		expect(uretilen.size).toBe(3);
	});
});

describe("assignIds", () => {
	it("her üst düzey bloğa kimlik veriyor", () => {
		const doc = assignIds(parse("# a\n\nb\n\n- c\n"));
		expect(doc.children.map((c) => c.id)).toEqual(["k1", "k2", "k3"]);
	});

	it("frontmatter da kimlik alıyor", () => {
		// Editörde frontmatter da bir blok: görünür ve düzenlenebilir olmalı.
		const doc = assignIds(parse("---\na: 1\n---\n\nmetin\n"));
		expect(doc.children[0]?.type).toBe("yaml");
		expect(doc.children[0]?.id).toBe("k1");
	});

	it("var olan kimliğe dokunmuyor", () => {
		const once = assignIds(parse("a\n\nb\n"));
		const sonra = assignIds(once);
		expect(sonra.children.map((c) => c.id)).toEqual(["k1", "k2"]);
	});

	/** Değiştirecek bir şey yoksa yeni nesne üretmiyor — render atlaması buna bağlı. */
	it("değişiklik gerekmiyorsa aynı kökü döndürüyor", () => {
		const once = assignIds(parse("a\n"));
		expect(assignIds(once)).toBe(once);
	});

	it("girdi ağacını değiştirmiyor", () => {
		const kaynak = parse("a\n");
		assignIds(kaynak);
		expect(kaynak.children[0]?.id).toBeUndefined();
	});

	it("boş belge boş kalıyor", () => {
		expect(assignIds(parse("")).children).toEqual([]);
	});
});
