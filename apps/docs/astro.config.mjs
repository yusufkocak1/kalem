// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

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
 */

/** Bir kenar çubuğu girdisi; etiket iki dilde de yazılı. */
const bag = (label, en, link) => ({ label, translations: { en }, link });

export default defineConfig({
	site: "https://kalem.dev",
	integrations: [
		starlight({
			title: "Kalem",
			description: "Framework-bağımsız, küçük ve modüler bir WYSIWYG Markdown editör kütüphanesi.",
			defaultLocale: "root",
			locales: {
				root: { label: "Türkçe", lang: "tr" },
				en: { label: "English", lang: "en" },
			},
			social: [{ icon: "github", label: "GitHub", href: "https://github.com/kalem-editor/kalem" }],
			customCss: ["./src/styles/kalem.css"],
			// Kenar çubuğu etiketleri de çeviriliyor; dil değiştiren okuyucu
			// Türkçe bir menüyle karşılaşmıyor.
			sidebar: [
				bag("Başlangıç", "Getting started", "/baslangic/"),
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
			],
		}),
	],
});
