// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

/**
 * Kalem dokümantasyon sitesi  (İş listesi: F6-01)
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
				{
					label: "Başlangıç",
					translations: { en: "Getting started" },
					link: "/baslangic/",
				},
				{
					label: "Rehber",
					translations: { en: "Guides" },
					items: [
						{
							label: "Viewer (salt okunur)",
							translations: { en: "Viewer (read-only)" },
							link: "/rehber/viewer/",
						},
						{ label: "Editör", translations: { en: "Editor" }, link: "/rehber/editor/" },
						{ label: "Temalar", translations: { en: "Themes" }, link: "/rehber/temalar/" },
						{
							label: "Eklentiler",
							translations: { en: "Plugins" },
							link: "/rehber/eklentiler/",
						},
						{
							label: "Markdown uyumu",
							translations: { en: "Markdown compatibility" },
							link: "/rehber/markdown-uyumu/",
						},
						{ label: "Güvenlik", translations: { en: "Security" }, link: "/rehber/guvenlik/" },
					],
				},
				{
					label: "Framework’ler",
					translations: { en: "Frameworks" },
					items: [
						{
							label: "Vanilla / TypeScript",
							translations: { en: "Vanilla / TypeScript" },
							link: "/frameworkler/vanilla/",
						},
						{ label: "React", translations: { en: "React" }, link: "/frameworkler/react/" },
						{ label: "Vue", translations: { en: "Vue" }, link: "/frameworkler/vue/" },
						{
							label: "CDN (script etiketi)",
							translations: { en: "CDN (script tag)" },
							link: "/frameworkler/cdn/",
						},
					],
				},
				{ label: "Mimari", translations: { en: "Architecture" }, link: "/mimari/" },
			],
		}),
	],
});
