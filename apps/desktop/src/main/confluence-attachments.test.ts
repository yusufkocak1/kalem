import { describe, expect, it } from "vitest";
import {
	freeName,
	isRunnable,
	localFileName,
	mediaTypeOf,
	opensDirectly,
} from "./confluence-attachments.js";
import { zoneIdentifier } from "./zone.js";

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
		expect(isRunnable("rapor.exe.")).toBe(true);
		expect(isRunnable("rapor.exe . ")).toBe(true);
		expect(isRunnable("eklenti.xll")).toBe(true);
		expect(isRunnable("yardim.chm")).toBe(true);
		expect(isRunnable("disk.vhdx")).toBe(true);
		expect(isRunnable("baslat.desktop")).toBe(true);
	});

	it("opens only documents, pictures and media directly", () => {
		expect(opensDirectly("Analiz.docx")).toBe(true);
		expect(opensDirectly("ekran.PNG")).toBe(true);
		expect(opensDirectly("makro.docm")).toBe(false);
		expect(opensDirectly("sayfa.html")).toBe(false);
		expect(opensDirectly("cizim.svg")).toBe(false);
		expect(opensDirectly("rapor.pdf.exe.")).toBe(false);
		expect(opensDirectly("adsiz")).toBe(false);
	});

	it("makes a safe local file name", () => {
		expect(localFileName("../../a:b?.txt")).toBe("_.._a_b_.txt");
		expect(localFileName("..")).toBe("attachment");
		expect(localFileName("Bütçe 2026.xlsx")).toBe("Bütçe 2026.xlsx");
		expect(localFileName("kurulum.exe. . ")).toBe("kurulum.exe");
		expect(localFileName("CON.txt")).toBe("_CON.txt");
		expect(localFileName("console.txt")).toBe("console.txt");
	});
});

describe("zoneIdentifier", () => {
	it("marks a download as from the internet", () => {
		expect(zoneIdentifier("https://wiki.example.com")).toBe(
			"[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://wiki.example.com\r\n",
		);
		expect(zoneIdentifier("https://a\r\nZoneId=0")).not.toContain("\nZoneId=0");
		expect(zoneIdentifier("file:///x")).toBe("[ZoneTransfer]\r\nZoneId=3\r\n");
	});
});
