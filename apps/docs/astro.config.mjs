// @ts-check

import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import vue from "@astrojs/vue";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

/**
 * API referansının okuduğu giriş noktaları  (İş listesi: F6-04)
 *
 * Paketlerin `exports` haritasındaki her genel giriş burada. Kaynak
 * okunuyor, `.d.ts` değil: derlenmiş bildirimlerde JSDoc yorumlarının bir
 * kısmı kayboluyor ve referansın değerli yanı tam olarak o yorumlar.
 */
const GIRISLER = [
	"core/src/index.ts",
	"core/src/commands.ts",
	"core/src/html.ts",
	"viewer/src/index.ts",
	"editor/src/index.ts",
	"ui/src/index.ts",
	"plugin-image-upload/src/index.ts",
	"plugin-code-highlight/src/index.ts",
	"plugin-find-replace/src/index.ts",
	"plugin-outline/src/index.ts",
	"plugin-word-count/src/index.ts",
	"plugin-source-mode/src/index.ts",
	"plugin-autosave/src/index.ts",
	"react/src/index.ts",
	"vue/src/index.ts",
	"wc/src/index.ts",
].map((yol) => `../../packages/${yol}`);

/**
 * Kalem dokümantasyon sitesi  (İş listesi: F6-01, F6-02)
 *
 * ## Neden Starlight
 *
 * Kütüphanenin ana iddiası çerçeve bağımsızlığı. Starlight, **aynı
 * sayfada** vanilla, React ve Vue canlı örneklerini gömebildiği için bu
 * iddiayı sitenin kendisi kanıtlıyor (F6-03). Vue tabanlı VitePress ya da
 * React tabanlı Docusaurus, mesajla çelişirdi.
 *
 * Yerleşik gelenler: Pagefind araması, i18n, koyu tema, erişilebilir
 * varsayılanlar.
 *
 * ## İki dil
 *
 * `root` Türkçe, `en` İngilizce. Starlight çevrilmemiş bir sayfayı
 * varsayılan dile **düşürüyor** ve okuyucuya bunu söylüyor; yani
 * İngilizce bölüm yarım da olsa site kırılmıyor. Çeviri F6-10'un işi,
 * iskelet burada.
 *
 * ## React **ve** Vue, aynı sitede
 *
 * İki ada motoru birden kurulu (F6-03). Sebep doğrudan ürünün iddiası:
 * `/canli/` sayfasında vanilla, React ve Vue örnekleri **aynı anda**
 * yaşıyor. Vue tabanlı VitePress ya da React tabanlı Docusaurus bunu
 * yapamazdı — dokümantasyon aracının seçimi de mesajın parçası.
 */

/** Bir kenar çubuğu girdisi; etiket iki dilde de yazılı. */
const bag = (label, en, link) => ({ label, translations: { en }, link });

export default defineConfig({
	site: "https://kalem.dev",
	/*
	 * `@kalem/core/html` modülünün dosyası `html-1.md` oluyor.
	 *
	 * TypeDoc'un dosya kaydı büyük/küçük harfe duyarsız ve `@kalem/core`
	 * zaten `Html` adlı bir AST tipi dışa aktarıyor; iki ad çakışınca
	 * sonrakine son ek veriliyor. Adresi elle yazan okuyucu ise `/html/`
	 * deneyecek, o yüzden doğrusuna yönlendiriliyor.
	 */
	redirects: {
		"/api/kalem/core/html": "/api/kalem/core/html-1/",
		"/en/api/kalem/core/html": "/en/api/kalem/core/html-1/",
	},
	integrations: [
		react(),
		vue(),
		starlight({
			title: "Kalem",
			plugins: [
				/*
				 * API referansı TypeDoc'tan üretiliyor (F6-04).
				 *
				 * Elle yazılan bir referans kaçınılmaz olarak koddan sapıyor;
				 * F6-02 sitenin on beş görev boyunca yanlış API'yi anlattığını
				 * gösterdi. Üretilen referansın sapması mümkün değil.
				 *
				 * Çıktı `src/content/docs/api/` altına yazılıyor ve **depoya
				 * girmiyor** — her derlemede yeniden üretiliyor.
				 */
				starlightTypeDoc({
					entryPoints: GIRISLER,
					tsconfig: "./tsconfig.typedoc.json",
					output: "api",
					sidebar: { label: "API referansı", collapsed: true },
					typeDoc: {
						// Kök `package.json`ın adı ("kalem-monorepo") başlık
						// olmamalı; okuyucunun gördüğü şey referansın kendisi.
						name: "API referansı",
						// Giriş sayfasının üst kısmı elle yazıldı: üretilen
						// modül listesi tek başına "bu ne" sorusunu cevaplamıyor.
						readme: "./src/api-giris.md",
						// "Defined in" satırları kaynağa bağlanıyor; referans,
						// koda açılan bir kapı olsun diye.
						sourceLinkTemplate: "https://github.com/yusufkocak1/kalem/blob/main/{path}#L{line}",
						basePath: "../../",
						// Her giriş ayrı bir modül sayfası; paket sınırları
						// referansta da görünüyor.
						entryPointStrategy: "resolve",
						/*
						 * Giriş başına **tek** sayfa.
						 *
						 * Varsayılan ("members") her dışa aktarma için ayrı bir
						 * dosya üretiyor: 396 sayfa, iki dille 792 rota ve
						 * Pagefind indeksi yirmi saniye. Okuyucunun istediği ise
						 * "`@kalem/editor` neler veriyor" sorusunun tek yerde
						 * cevabı; sayfa içi içindekiler zaten gezinmeyi
						 * sağlıyor.
						 */
						outputFileStrategy: "modules",
						useCodeBlocks: true,
						expandObjects: true,
						parametersFormat: "table",
						propertiesFormat: "table",
						typeDeclarationFormat: "table",
						// İç tesisat dışarıda: yalnızca `export`lananlar.
						excludeInternal: true,
						excludePrivate: true,
						/*
						 * Miras alınan DOM üyeleri dışarıda.
						 *
						 * `KalemEditorElement` `HTMLElement`i genişletiyor ve
						 * TypeDoc onun bütün üyelerini sayfaya döküyordu:
						 * `@kalem/wc` referansı 140 kB, çekirdeğinkinden
						 * büyük. Okuyucunun aradığı şey Kalem'in eklediği
						 * yüzey; `HTMLElement`i MDN anlatıyor.
						 */
						excludeExternals: true,
						githubPages: false,
					},
				}),
			],
			description: "Framework-bağımsız, küçük ve modüler bir WYSIWYG Markdown editör kütüphanesi.",
			defaultLocale: "root",
			locales: {
				root: { label: "Türkçe", lang: "tr" },
				en: { label: "English", lang: "en" },
			},
			social: [{ icon: "github", label: "GitHub", href: "https://github.com/yusufkocak1/kalem" }],
			/*
			 * Kalem'in kendi tema dosyaları da yükleniyor (F6-03).
			 *
			 * Canlı örnekler onlarsız stilsiz kalıyordu — ilk denemede
			 * editör içeriği Starlight'ın kendi element kurallarıyla
			 * "tesadüfen" düzgün görünüyordu ama araç çubuğu düz bir
			 * `<div>` yığınıydı. Hepsi `.kalem-*` sınıflarının altına
			 * kapatılı olduğu için sitenin geri kalanına tek kural
			 * sızmıyor.
			 */
			customCss: [
				"@kalem/themes/tokens.css",
				"@kalem/themes/viewer.css",
				"@kalem/themes/editor.css",
				"@kalem/themes/ui.css",
				"./src/styles/kalem.css",
			],
			// Kenar çubuğu etiketleri de çeviriliyor; dil değiştiren okuyucu
			// Türkçe bir menüyle karşılaşmıyor.
			sidebar: [
				bag("Başlangıç", "Getting started", "/baslangic/"),
				bag("Canlı deneyin", "Try it live", "/canli/"),
				{
					label: "Rehber",
					translations: { en: "Guides" },
					items: [
						bag("Viewer (salt okunur)", "Viewer (read-only)", "/rehber/viewer/"),
						bag("Editör", "Editor", "/rehber/editor/"),
						bag("Temalar ve arayüz", "Themes and UI", "/rehber/temalar/"),
						bag("Eklentiler", "Plugins", "/rehber/eklentiler/"),
						bag("Markdown uyumu", "Markdown compatibility", "/rehber/markdown-uyumu/"),
						bag("Güvenlik", "Security", "/rehber/guvenlik/"),
						bag("Erişilebilirlik", "Accessibility", "/rehber/erisilebilirlik/"),
						bag(
							"Büyük belgeler ve performans",
							"Large documents and performance",
							"/rehber/performans/",
						),
					],
				},
				{
					label: "Framework’ler",
					translations: { en: "Frameworks" },
					items: [
						bag("Vanilla / TypeScript", "Vanilla / TypeScript", "/frameworkler/vanilla/"),
						bag("React", "React", "/frameworkler/react/"),
						bag("Vue", "Vue", "/frameworkler/vue/"),
						bag("Web Components", "Web Components", "/frameworkler/web-components/"),
						bag("Svelte", "Svelte", "/frameworkler/svelte/"),
						bag("Angular", "Angular", "/frameworkler/angular/"),
						bag("Next.js", "Next.js", "/frameworkler/nextjs/"),
						bag("Nuxt", "Nuxt", "/frameworkler/nuxt/"),
						bag("CDN (script etiketi)", "CDN (script tag)", "/frameworkler/cdn/"),
					],
				},
				{
					label: "Tarifler",
					translations: { en: "Recipes" },
					items: [
						bag("Otomatik kaydetme", "Autosave", "/tarifler/otomatik-kaydet/"),
						bag("Görsel yükleme", "Image upload", "/tarifler/gorsel-yukleme/"),
						bag("Salt okunur mod", "Read-only mode", "/tarifler/salt-okunur/"),
						bag("Kontrollü bileşen", "Controlled component", "/tarifler/kontrollu-bilesen/"),
						bag("Sunucuda Markdown", "Markdown on the server", "/tarifler/sunucuda-markdown/"),
					],
				},
				bag("Mimari", "Architecture", "/mimari/"),
				bag("Bilinen kısıtlar", "Known limitations", "/bilinen-kisitlar/"),
				typeDocSidebarGroup,
			],
		}),
	],
});
