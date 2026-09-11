/**
 * Dil paketi — HTML / XML  (İş listesi: F4-02)
 *
 * Etiketin içi ve dışı ayırt edilmiyor (durum tutulmuyor), o yüzden düz
 * metindeki `ad = değer` kalıbı da öznitelik rengine giriyor. Bir
 * işaretleme dilinde metnin çoğu etiketlerin içinde; kayıp küçük.
 *
 * `<script>` / `<style>` içeriği için iç gramer yok: onu yapmak
 * belirteçleyiciyi iç içe hâle getirmek demek. İhtiyacı olan `js` ya da
 * `css` bloğu açıyor.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "html",
	rules: [
		{ type: "comment", pattern: /<!--[\s\S]*?-->/ },
		{ type: "keyword", pattern: /<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>/i },
		{ type: "string", pattern: /"[^"]*"|'[^']*'/ },
		{ type: "tag", pattern: /<\/?[A-Za-z][\w:.-]*|\/?>/ },
		{ type: "attr", pattern: /[A-Za-z_:@#][\w:.-]*(?=\s*=)/ },
		{ type: "boolean", pattern: /&[\w#]+;/ },
		{ type: "operator", pattern: /=/ },
	],
};
