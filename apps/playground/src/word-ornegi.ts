/**
 * "Word'den yapıştır" senaryosu  (İş listesi: F6-06)
 *
 * ## Neden panoya yazmıyoruz
 *
 * Tarayıcı, kullanıcının izni olmadan panoya yazdırmıyor — ve izin istese
 * bile kullanıcının kendi panosunu ezmek kaba olurdu. Bunun yerine
 * Word'ün panoya koyduğu veri **doğrudan bir `paste` olayı olarak**
 * editöre gönderiliyor. Editörün gördüğü şey, gerçek bir yapıştırmada
 * gördüğünün aynısı: `text/html` ve `text/plain` taşıyan bir
 * `DataTransfer`.
 *
 * ## Bu gerçek Word değil, Word'ün *çıktısı*
 *
 * Aşağıdaki HTML, Word'ün panoya yazdığı biçimi taşıyor:
 * `urn:schemas-microsoft-com` ad alanları, `class=MsoNormal`,
 * `mso-list` ile sahte listeler, `mso-list:Ignore` içindeki madde
 * imleri, iç içe boş `<span>`lar ve `<o:p>` etiketleri. Başlıklar gerçek
 * `<h1>`/`<h2>` — Word, başlık **stili** uygulanmış paragrafları böyle
 * yazıyor. (İlk denemede `mso-outline-level` kullanılmıştı; o, Word'ün
 * elle anahat seviyesi verilmiş gövde metni için ürettiği biçim ve
 * başlık olarak değil kalın paragraf olarak geliyordu — doğru davranış,
 * yanlış örnek.)
 *
 * Bunların hiçbiri Markdown değil; editörün işi bu çorbadan başlık,
 * liste ve kalın metin çıkarmak.
 *
 * Daha uzun ve daha zorlu bir sürümü tarayıcı testlerinde
 * (`e2e/fixtures/word-clipboard.ts`); buradaki okunmak için kısaltıldı.
 */

export const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoNormal {margin:0cm; font-size:11.0pt;} --></style></head>
<body lang=TR>
<h1><span style='mso-fareast-font-family:"Times New Roman"'>Çeyrek Raporu<o:p></o:p></span></h1>
<p class=MsoNormal><span style='mso-fareast-font-family:"Times New Roman"'>Bu
bölümde <b>üç</b> bulgu var ve hepsi <i>ölçüldü</i>.<o:p></o:p></span></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><span
style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;
</span></span>Gelir beklentinin üstünde<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><span
style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;
</span></span>Maliyet sabit kaldı<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><span
style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;
</span></span>Yeni pazar: <a href="https://ornek.com/rapor">detaylı rapor</a><o:p></o:p></p>
<h2><span lang=TR>Sonraki adımlar<o:p></o:p></span></h2>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><span
style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;
</span></span>Bütçe gözden geçirilecek<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><span
style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;
</span></span>Ekip bilgilendirilecek<o:p></o:p></p>
</body></html>`;

/** Word aynı anda düz metin de koyuyor; editör hangisini kullanacağına kendisi karar veriyor. */
export const WORD_TEXT = `Çeyrek Raporu
Bu bölümde üç bulgu var ve hepsi ölçüldü.
· Gelir beklentinin üstünde
· Maliyet sabit kaldı
· Yeni pazar: detaylı rapor
Sonraki adımlar
1. Bütçe gözden geçirilecek
2. Ekip bilgilendirilecek`;

/**
 * Word'den yapıştırmayı benzetir.
 *
 * Olay editörün **düzenlenebilir bloğuna** gönderiliyor, kapsayıcıya
 * değil: editörün yapıştırma işleyicisi imlecin hangi blokta olduğunu
 * okuyor ve kapsayıcıdan gelen bir olayda imleç bilgisi olmuyor.
 */
export function wordYapistir(editor: { focus(): void; getElement(): HTMLElement }): boolean {
	editor.focus();

	const hedef = document.activeElement;
	if (!(hedef instanceof HTMLElement) || !editor.getElement().contains(hedef)) return false;

	const veri = new DataTransfer();
	veri.setData("text/html", WORD_HTML);
	veri.setData("text/plain", WORD_TEXT);

	return hedef.dispatchEvent(
		new ClipboardEvent("paste", { clipboardData: veri, bubbles: true, cancelable: true }),
	);
}
