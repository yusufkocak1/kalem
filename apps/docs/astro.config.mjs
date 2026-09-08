// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://kalem.dev",
	integrations: [
		starlight({
			title: "Kalem",
			tagline: "Word kadar kolay, Markdown kadar taşınabilir.",
			description: "Framework-bağımsız, küçük ve modüler bir WYSIWYG Markdown editör kütüphanesi.",
			defaultLocale: "root",
			locales: {
				root: { label: "Türkçe", lang: "tr" },
				en: { label: "English", lang: "en" },
			},
			social: {
				github: "https://github.com/kalem-editor/kalem",
			},
			customCss: ["./src/styles/kalem.css"],
			sidebar: [
				{ label: "Başlangıç", link: "/baslangic/" },
				{
					label: "Rehber",
					items: [
						{ label: "Viewer (salt okunur)", link: "/rehber/viewer/" },
						{ label: "Editör", link: "/rehber/editor/" },
						{ label: "Temalar", link: "/rehber/temalar/" },
						{ label: "Eklentiler", link: "/rehber/eklentiler/" },
						{ label: "Markdown uyumu", link: "/rehber/markdown-uyumu/" },
						{ label: "Güvenlik", link: "/rehber/guvenlik/" },
					],
				},
				{
					label: "Framework’ler",
					items: [
						{ label: "Vanilla / TypeScript", link: "/frameworkler/vanilla/" },
						{ label: "React", link: "/frameworkler/react/" },
						{ label: "Vue", link: "/frameworkler/vue/" },
						{ label: "CDN (script etiketi)", link: "/frameworkler/cdn/" },
					],
				},
				{ label: "Mimari", link: "/mimari/" },
			],
		}),
	],
});
