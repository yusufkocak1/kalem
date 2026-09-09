/**
 * @kalem/plugin-image-upload — Eklenti  (İş listesi: F4-01)
 *
 * Sürüklenen ya da yapıştırılan görseli belgeye koyuyor, yüklenmesini
 * bekliyor ve adresi gerçek adresle değiştiriyor.
 *
 * ## Geçici adres modele giriyor
 *
 * Görsel, yükleme **başlamadan** belgeye geçici bir adresle giriyor.
 * Alternatifi, yükleme bitene kadar modelin dışında bir yer tutucu
 * tutmaktı; o da editörün model→DOM akışının (F2-05) yanında ikinci bir
 * gerçeklik demek ve imleç, geri alma, seçim gibi her şeyin iki kez
 * yazılmasını gerektirirdi.
 *
 * Bedeli açık: yükleme sürerken belge kaydedilirse içinde kullanılamaz bir
 * `kalem-upload:` adresi kalıyor. `pendingUploads()` bunu sorulabilir
 * kılıyor; gömen uygulama kaydetmeden önce bakabiliyor.
 *
 * ## Geçici adres neden `blob:` değil
 *
 * İlk hâli `blob:` idi ve çalışmadı: çekirdeğin URL beyaz listesi (F1-10)
 * `blob:`i tanımıyor ve render sırasında adres `#`e çevriliyor — önizleme
 * hiç görünmüyordu.
 *
 * Beyaz liste **haklı** ve gevşetilmedi. `data:` görselleri için MIME türü
 * adresin içinde yazıyor ve `image/svg+xml` oradan ayıklanabiliyor;
 * `blob:` adresinde tür bilgisi yok, yani aynı kural uygulanamıyor. Bir
 * şemayı, denetleyemediğin hâlde açmak beyaz listeyi anlamsız kılar.
 *
 * Bunun yerine modele `kalem-upload:<n>` giriyor. Bu da `#`e çevriliyor —
 * ama zaten görüntülenmesi istenmiyor: gerçek önizlemeyi eklenti DOM'a
 * kendisi yazıyor (aşağıya bakın). Belge yükleme sürerken kaydedilirse
 * içindeki adres ölü bir `blob:` yerine ne olduğu belli bir işaret oluyor.
 *
 * ## İlerleme ve önizleme DOM'da, modelde değil
 *
 * Yüzde kaç yüklendiği belgenin bir parçası değil; kaydedilip geri
 * yüklendiğinde anlamı olmayan bir bilgi. Eklenti `<img>` elemanını bulup
 * `src`ini yerel önizlemeye çeviriyor ve üstüne ilerleme yazıyor —
 * eklenti API'sinin render kancası bilerek yok (`plugin.ts`), o yüzden
 * süsleme çizimden **sonra** uygulanıyor ve her `change` olayında
 * yeniden.
 *
 * Model ile DOM eşleşmesi **belge sırasından** kuruluyor: render görselleri
 * belgedeki sırayla üretiyor, yani modeldeki n. görsel DOM'daki n. `<img>`.
 * Adresten eşleştirmek mümkün değil, çünkü render onu `#` yapıyor.
 *
 * ## Yeniden boyutlandırma neden yok
 *
 * Markdown'da görsel boyutu diye bir sözdizimi yok. Yapılabilecek tek şey
 * `<img width="...">` ham HTML'i yazmak; o da temiz bir Markdown görselini
 * ham HTML'e çeviriyor, başka araçlarda görünmez kılıyor ve belgeyi
 * taşınamaz hâle getiriyor. Kullanıcının bunu isteyip istemediği bizim
 * kararımız değil — `onResize` kancası veriliyor, ne yapacağına gömen
 * uygulama karar veriyor.
 */
import type { Image, Root } from "@kalem/core";
import type { Plugin, PluginContext } from "@kalem/editor";
import type { AltEditor } from "./alt-editor.js";
import { createAltEditor } from "./alt-editor.js";
import type { ImageLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { AcceptOptions, RejectReason } from "./model.js";
import {
	altFromFilename,
	imageAltAt,
	imageUrls,
	insertImage,
	rejectionOf,
	removeImage,
	replaceImageUrl,
	setImageAlt,
} from "./model.js";

/** Yükleme kancasına verilen iş. */
export interface UploadTask {
	readonly file: File;
	/** 0–1 arası ilerleme bildirimi; çağırmak isteğe bağlı. */
	readonly onProgress: (ratio: number) => void;
	/** Kullanıcı görseli silerse iptal ediliyor. */
	readonly signal: AbortSignal;
}

/** Yüklemenin sonucu: yalnızca adres ya da adres + üstveri. */
export type UploadResult = string | { readonly url: string; readonly alt?: string };

export interface ImageUploadOptions extends AcceptOptions {
	/**
	 * Dosyayı yükleyip adresini döndüren kanca.
	 *
	 * Eklentinin ağ hakkında bildiği tek şey bu: hangi servis, hangi
	 * kimlik doğrulama, hangi yeniden deneme — hepsi gömen uygulamanın.
	 */
	upload(task: UploadTask): Promise<UploadResult>;
	/** Reddedilen ya da yüklenemeyen dosya. */
	onError?: (error: Error, file: File, reason: RejectReason | "upload") => void;
	/**
	 * Görsel yeniden boyutlandırılmak istendiğinde çağrılıyor.
	 *
	 * Eklenti bunu **kendisi yapmıyor**; sebebi dosyanın başındaki notta.
	 */
	onResize?: (image: Image, ctx: PluginContext) => void;
	/** Arayüz metinleri; verilmezse editörün diline göre seçiliyor. */
	labels?: ImageLabels;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
}

/** Süren bir yükleme. */
export interface PendingUpload {
	/** Belgedeki geçici adres. */
	readonly url: string;
	readonly file: File;
	/** 0–1; kanca ilerleme bildirmiyorsa 0 kalıyor. */
	readonly progress: number;
}

export interface ImageUploadPlugin extends Plugin {
	/**
	 * Süren yüklemeler.
	 *
	 * Gömen uygulama kaydetmeden önce buna bakmalı: belge şu anda
	 * kullanılamaz `blob:` adresleri taşıyor olabilir.
	 */
	pendingUploads(): readonly PendingUpload[];
}

interface Kayit {
	readonly file: File;
	readonly controller: AbortController;
	/** Yerel önizleme (`blob:`); yalnızca DOM'a yazılıyor, modele değil. */
	readonly preview: string;
	progress: number;
}

/** Geçici adresleri benzersiz kılan sayaç. */
let sayac = 0;

export function imageUploadPlugin(options: ImageUploadOptions): ImageUploadPlugin {
	const p = options.classPrefix ?? "kalem-";
	/** Geçici adres → süren yükleme. */
	const bekleyen = new Map<string, Kayit>();
	let ctx: PluginContext | null = null;
	let labels: ImageLabels | null = null;
	let altEditor: AltEditor | null = null;

	// -----------------------------------------------------------------------
	// Süsleme
	// -----------------------------------------------------------------------

	/**
	 * Süren yüklemelerin `<img>` elemanlarını işaretler.
	 *
	 * Her `change` olayında yeniden çalışıyor: editör bloğu yeniden
	 * çizdiğinde eklediğimiz sınıf kayboluyor ve ilerleme çubuğu ortadan
	 * yok oluyordu.
	 */
	function suslemeyiTazele(): void {
		if (ctx === null) return;
		// Modeldeki n. görsel = DOM'daki n. `<img>`; adres eşleştirmesi
		// yapılamıyor çünkü render geçici adresi `#` yapıyor.
		const adresler = imageUrls(ctx.getDocument());
		const elemanlar = ctx.element.querySelectorAll<HTMLImageElement>("img");

		for (const [i, img] of Array.from(elemanlar).entries()) {
			const kayit = bekleyen.get(adresler[i] ?? "");
			if (kayit === undefined) {
				img.classList.remove(`${p}uploading`);
				img.style.removeProperty("--kalem-upload");
				continue;
			}
			img.classList.add(`${p}uploading`);
			img.style.setProperty("--kalem-upload", String(Math.round(kayit.progress * 100)));
			// Yerel önizleme: modele giremeyen, yalnızca ekranda duran adres.
			if (img.getAttribute("src") !== kayit.preview) img.setAttribute("src", kayit.preview);
		}
	}

	// -----------------------------------------------------------------------
	// Yükleme
	// -----------------------------------------------------------------------

	function hata(mesaj: string, file: File, sebep: RejectReason | "upload"): void {
		options.onError?.(new Error(mesaj), file, sebep);
	}

	async function yukle(file: File): Promise<void> {
		if (ctx === null || ctx.isReadOnly()) return;

		const red = rejectionOf(file, options);
		if (red !== null) {
			const metin = labels ?? labelsFor(null);
			hata(red === "type" ? metin.rejectedType : metin.rejectedSize, file, red);
			return;
		}

		// Geçici adres benzersiz; yükleme bitince bu adresle bulunuyor.
		sayac += 1;
		const gecici = `kalem-upload:${sayac}`;
		const preview = URL.createObjectURL(file);
		const controller = new AbortController();
		bekleyen.set(gecici, { file, controller, preview, progress: 0 });

		const image: Image = {
			type: "image",
			url: gecici,
			alt: altFromFilename(file.name),
			title: null,
		};
		ctx.applyEdit(insertImage(ctx.getDocument(), ctx.getCaret(), image));
		suslemeyiTazele();

		try {
			const sonuc = await options.upload({
				file,
				signal: controller.signal,
				onProgress: (ratio) => {
					const kayit = bekleyen.get(gecici);
					if (kayit === undefined) return;
					kayit.progress = Math.min(1, Math.max(0, ratio));
					suslemeyiTazele();
				},
			});
			if (controller.signal.aborted) return;
			tamamla(gecici, sonuc);
		} catch (sebep) {
			// İptal, kullanıcının görseli silmesi demek; hata değil.
			if (!controller.signal.aborted) {
				bitir(gecici, true);
				hata(sebep instanceof Error ? sebep.message : String(sebep), file, "upload");
			}
		}
	}

	function tamamla(gecici: string, sonuc: UploadResult): void {
		if (ctx === null) return;
		const { url, alt } = typeof sonuc === "string" ? { url: sonuc, alt: undefined } : sonuc;
		const yeni = replaceImageUrl(ctx.getDocument(), gecici, {
			url,
			...(alt === undefined ? {} : { alt }),
		});
		bitir(gecici, false);
		// `yeni === null`: kullanıcı yükleme biterken görseli silmiş.
		if (yeni !== null) ctx.applyEdit({ doc: yeni, caret: null });
		suslemeyiTazele();
	}

	/** Kaydı kapatır; `sil` ise görseli belgeden de çıkarır. */
	function bitir(gecici: string, sil: boolean): void {
		const kayit = bekleyen.get(gecici);
		bekleyen.delete(gecici);
		if (kayit !== undefined) URL.revokeObjectURL(kayit.preview);
		if (!sil || ctx === null) return;
		const yeni = removeImage(ctx.getDocument(), gecici);
		if (yeni !== null) ctx.applyEdit({ doc: yeni, caret: null });
	}

	/**
	 * Belgeden silinen görsellerin yüklemesini iptal eder.
	 *
	 * Kullanıcı yükleme sürerken Ctrl+Z'ye basarsa ya da görseli silerse,
	 * biten yükleme geri gelip silinmiş bir düğümü aramamalı — ve ağ isteği
	 * boşuna sürmemeli.
	 */
	function silinenleriIptalEt(doc: Root): void {
		if (bekleyen.size === 0) return;
		const mevcut = new Set(imageUrls(doc));
		for (const [url, kayit] of bekleyen) {
			if (mevcut.has(url)) continue;
			kayit.controller.abort();
			bekleyen.delete(url);
			URL.revokeObjectURL(kayit.preview);
		}
	}

	// -----------------------------------------------------------------------
	// Olaylar
	// -----------------------------------------------------------------------

	function dosyalar(veri: DataTransfer | null): File[] {
		if (veri === null) return [];
		return Array.from(veri.files);
	}

	return {
		name: "image-upload",

		pendingUploads() {
			return Array.from(bekleyen, ([url, kayit]) => ({
				url,
				file: kayit.file,
				progress: kayit.progress,
			}));
		},

		setup(context) {
			ctx = context;
			labels =
				options.labels ??
				labelsFor(context.element.closest("[lang]")?.getAttribute("lang") ?? null);

			const surukleUstunde = (event: DragEvent): void => {
				if (dosyalar(event.dataTransfer).length === 0) return;
				// `preventDefault` olmadan tarayıcı dosyayı sayfa olarak açıyor.
				event.preventDefault();
				context.element.classList.add(`${p}drop-target`);
			};
			const surukleAyrildi = (): void => {
				context.element.classList.remove(`${p}drop-target`);
			};
			const birakildi = (event: DragEvent): void => {
				const files = dosyalar(event.dataTransfer);
				context.element.classList.remove(`${p}drop-target`);
				if (files.length === 0) return;
				event.preventDefault();
				for (const file of files) void yukle(file);
			};
			const yapistirildi = (event: ClipboardEvent): void => {
				const files = dosyalar(event.clipboardData);
				if (files.length === 0) return;
				// Yapıştırma boru hattından (F3-07) **önce** yakalanıyor:
				// pano hem dosya hem HTML taşıyabiliyor ve dosya varsa
				// kullanıcının kastettiği o.
				event.preventDefault();
				for (const file of files) void yukle(file);
			};

			context.element.addEventListener("dragover", surukleUstunde);
			context.element.addEventListener("dragleave", surukleAyrildi);
			context.element.addEventListener("drop", birakildi);
			context.element.addEventListener("paste", yapistirildi, true);

			// Alt metin düzenleme (görsele tıklayınca).
			altEditor = createAltEditor(context, {
				prefix: p,
				labels,
				readAlt: (index) => imageAltAt(context.getDocument(), index),
				writeAlt: (index, alt) => {
					const yeni = setImageAlt(context.getDocument(), index, alt);
					// İmleç `null`: kullanıcı odağı kutuda, geri çekilmemeli.
					if (yeni !== null) context.applyEdit({ doc: yeni, caret: null });
				},
			});

			const sokChange = context.on("change", (_value, doc) => {
				silinenleriIptalEt(doc);
				suslemeyiTazele();
			});

			return () => {
				altEditor?.destroy();
				altEditor = null;
				sokChange();
				context.element.removeEventListener("dragover", surukleUstunde);
				context.element.removeEventListener("dragleave", surukleAyrildi);
				context.element.removeEventListener("drop", birakildi);
				context.element.removeEventListener("paste", yapistirildi, true);
				context.element.classList.remove(`${p}drop-target`);
				for (const kayit of bekleyen.values()) {
					kayit.controller.abort();
					URL.revokeObjectURL(kayit.preview);
				}
				bekleyen.clear();
				ctx = null;
			};
		},
	};
}
