/**
 * Eklenti kaydı  (İş listesi: F2-12)
 *
 * Kaydın kendisi saf; editöre bağlanması tarayıcı testinde. Buradaki
 * testler çakışma kuralını (kayıt sırası) ve yaşam döngüsünü sabitliyor.
 */
import type { Root } from "@kalem/core";
import { parse } from "@kalem/core";
import { describe, expect, it, vi } from "vitest";
import type { Plugin, PluginContext } from "./plugin.js";
import { PluginRegistry } from "./plugin.js";

function baglam(): PluginContext {
	const doc: Root = parse("metin\n");
	return {
		element: {
			addEventListener: () => {},
			removeEventListener: () => {},
		} as unknown as HTMLElement,
		getDocument: () => doc,
		getCaret: () => null,
		applyEdit: () => true,
		isReadOnly: () => false,
	};
}

const bos = (name: string): Plugin => ({ name });

describe("kayıt", () => {
	it("eklenti ekliyor", () => {
		const kayit = new PluginRegistry(baglam());
		kayit.add(bos("a"));
		expect(kayit.names).toEqual(["a"]);
		expect(kayit.has("a")).toBe(true);
	});

	/** Sessizce ezmek, hangi eklentinin çalıştığını bulunamaz hâle getirir. */
	it("aynı ad iki kez kaydedilemiyor", () => {
		const kayit = new PluginRegistry(baglam());
		kayit.add(bos("a"));
		expect(() => kayit.add(bos("a"))).toThrow(/zaten kayıtlı/);
	});

	it("kaldırılabiliyor", () => {
		const kayit = new PluginRegistry(baglam());
		kayit.add(bos("a"));
		expect(kayit.remove("a")).toBe(true);
		expect(kayit.names).toEqual([]);
	});

	it("olmayan eklentiyi kaldırmak yanlış dönüyor", () => {
		expect(new PluginRegistry(baglam()).remove("yok")).toBe(false);
	});
});

describe("yaşam döngüsü", () => {
	it("setup kuruluşta çağrılıyor", () => {
		const setup = vi.fn();
		new PluginRegistry(baglam()).add({ name: "a", setup });
		expect(setup).toHaveBeenCalledTimes(1);
	});

	it("temizleyici kaldırılınca çağrılıyor", () => {
		const temizle = vi.fn();
		const kayit = new PluginRegistry(baglam());
		kayit.add({ name: "a", setup: () => temizle });
		expect(temizle).not.toHaveBeenCalled();
		kayit.remove("a");
		expect(temizle).toHaveBeenCalledTimes(1);
	});

	it("destroy tüm temizleyicileri çağırıyor", () => {
		const a = vi.fn();
		const b = vi.fn();
		const kayit = new PluginRegistry(baglam());
		kayit.add({ name: "a", setup: () => a });
		kayit.add({ name: "b", setup: () => b });
		kayit.destroy();
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		expect(kayit.names).toEqual([]);
	});
});

describe("çakışma çözümü", () => {
	const tus = { key: "b" } as KeyboardEvent;

	/** Tek kural: kayıt sırası. Önce kayıtlı olan önce görür. */
	it("ilk tüketen kazanıyor", () => {
		const sira: string[] = [];
		const kayit = new PluginRegistry(baglam());
		kayit.add({
			name: "a",
			keymap: () => {
				sira.push("a");
				return true;
			},
		});
		kayit.add({
			name: "b",
			keymap: () => {
				sira.push("b");
				return true;
			},
		});
		expect(kayit.handleKey(tus)).toBe(true);
		expect(sira).toEqual(["a"]);
	});

	it("tüketmeyen eklenti sıradakine devrediyor", () => {
		const kayit = new PluginRegistry(baglam());
		kayit.add({ name: "a", keymap: () => false });
		kayit.add({ name: "b", keymap: () => true });
		expect(kayit.handleKey(tus)).toBe(true);
	});

	it("hiçbiri tüketmezse yanlış dönüyor — çekirdek devralır", () => {
		const kayit = new PluginRegistry(baglam());
		kayit.add({ name: "a", keymap: () => false });
		expect(kayit.handleKey(tus)).toBe(false);
	});

	it("giriş kurallarında da ilk dönüşüm kazanıyor", () => {
		const doc = parse("x\n");
		const caret = { blockIndex: 0, path: [], offset: 0 };
		const kayit = new PluginRegistry(baglam());
		kayit.add({ name: "a", inputRules: [() => null] });
		kayit.add({ name: "b", inputRules: [() => ({ doc, caret })] });
		expect(kayit.runInputRules(doc, caret)).not.toBeNull();
	});
});
