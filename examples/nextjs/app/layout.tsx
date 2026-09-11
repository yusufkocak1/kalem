import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@kalem/themes/tokens.css";
import "@kalem/themes/viewer.css";
import "@kalem/themes/editor.css";
import "./globals.css";

export const metadata: Metadata = {
	title: "Kalem — Next.js örneği",
	description: "@kalem/react, App Router ile",
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
};

/**
 * Kök düzen bir **sunucu** bileşeni: `'use client'` yok.
 *
 * Tema CSS'i buradan yükleniyor, yani stiller sunucu tarafında
 * çözülüyor ve ilk boyada hazır.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="tr">
			<body>{children}</body>
		</html>
	);
}
