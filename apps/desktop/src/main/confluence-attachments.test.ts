import { describe, expect, it } from "vitest";
import { freeName, isRunnable, localFileName, mediaTypeOf } from "./confluence-attachments.js";

describe("Confluence attachments", () => {
	it("picks a free name next to the ones the page has", () => {
		const taken = new Set(["rapor.pdf", "rapor-2.pdf", "notlar"]);
		expect(freeName("plan.pdf", taken)).toBe("plan.pdf");
		expect(freeName("rapor.pdf", taken)).toBe("rapor-3.pdf");
		expect(freeName("Rapor.PDF", new Set(["Rapor.PDF"]))).toBe("Rapor-2.PDF");
		expect(freeName("notlar", taken)).toBe("notlar-2");
	});

	it("knows the media type of common files", () => {
		expect(mediaTypeOf("a.PDF")).toBe("application/pdf");
		expect(mediaTypeOf("tablo.xlsx")).toContain("spreadsheetml");
		expect(mediaTypeOf("veri.bin")).toBe("application/octet-stream");
	});

	it("does not open programs and scripts", () => {
		expect(isRunnable("kurulum.EXE")).toBe(true);
		expect(isRunnable("betik.ps1")).toBe(true);
		expect(isRunnable("rapor.pdf")).toBe(false);
	});

	it("makes a safe local file name", () => {
		expect(localFileName("../../a:b?.txt")).toBe("_.._a_b_.txt");
		expect(localFileName("..")).toBe("attachment");
		expect(localFileName("Bütçe 2026.xlsx")).toBe("Bütçe 2026.xlsx");
	});
});
