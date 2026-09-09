/**
 * Word'ün pano çıktısı  (İş listesi: F3-07 kabul kriteri)
 *
 * ## Bu gerçek Word değil, gerçek Word'ün *çıktısı*
 *
 * Kabul kriteri "Word'den kopyalanan 3 sayfalık biçimli doküman" diyor.
 * Playwright'a Word kurulamıyor; ölçülebilecek olan, Word'ün panoya
 * yazdığı HTML'in doğru işlenmesi. Aşağıdaki metin o HTML'in yapısını
 * birebir taşıyor: `urn:schemas-microsoft-com` ad alanları,
 * `<meta name=Generator content="Microsoft Word 15">`, `class=MsoNormal`,
 * `mso-list` ile sahte listeler, `mso-list:Ignore` madde imleri, iç içe
 * boş `<span>`'lar, `<o:p>` etiketleri ve `<style>` blokları.
 *
 * Bu bir taklit ve öyle olduğu biliniyor: gerçek bir Word sürümü yarın
 * tanımadığımız bir şey üretebilir. Ama tanıdığımız her şeyi bu dosya
 * kapsıyor ve regresyonu yakalıyor.
 *
 * Belge kasten uzun: başlık hiyerarşisi, biçimli paragraflar, sırasız ve
 * sıralı listeler, iç içe liste, bağlantı ve tablo — Word'den yapıştırılan
 * bir raporun içinde olan her şey.
 */

/** Word'ün her paragrafı sardığı boş kabuk. */
const kabuk = (icerik: string) => `<span style='font-size:11.0pt;font-family:"Calibri",sans-serif;
mso-ascii-theme-font:minor-latin'>${icerik}<o:p></o:p></span>`;

/** Sahte liste maddesi. */
const madde = (im: string, metin: string, level = 1) =>
	`<p class=MsoListParagraphCxSpMiddle style='margin-left:${level * 36}.0pt;mso-add-space:auto;
text-indent:-18.0pt;mso-list:l0 level${level} lfo1'><span style='mso-list:Ignore'>${im}<span
style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;</span></span>${kabuk(metin)}</p>`;

export const WORD_HTML = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=Generator content="Microsoft Word 15 (filtered medium)">
<style>
<!--
 /* Font Definitions */
 @font-face {font-family:"Cambria Math"; panose-1:2 4 5 3 5 4 6 3 2 4;}
p.MsoNormal, li.MsoNormal, div.MsoNormal
	{mso-style-unhide:no; margin:0cm; font-size:11.0pt;}
-->
</style>
</head>
<body lang=TR style='word-wrap:break-word'>
<!--StartFragment-->

<h1><span style='mso-fareast-font-family:"Times New Roman"'>Yıllık Değerlendirme<o:p></o:p></span></h1>

<p class=MsoNormal>${kabuk("Bu rapor geçen yılın ")}<b><span style='font-weight:700'>öne çıkan
başlıklarını</span></b>${kabuk(" ve gelecek yılın ")}<i><span style='font-style:italic'>planını</span></i>${kabuk(" özetliyor.")}</p>

<p class=MsoNormal><o:p>&nbsp;</o:p></p>

<h2><span lang=TR>Başarılar<o:p></o:p></span></h2>

<p class=MsoNormal>${kabuk("Üç alanda ilerleme kaydedildi:")}</p>

${madde("·", "Gelirde artış")}
${madde("·", "Müşteri memnuniyeti")}
${madde("o", "Destek süresi kısaldı", 2)}
${madde("o", "Şikâyet oranı düştü", 2)}
${madde("·", "Yeni pazarlar")}

<p class=MsoNormal>${kabuk("Ayrıntılar ")}<a href="https://ornek.com/rapor"><span
style='color:#0563C1;text-decoration:underline'>rapor sayfasında</span></a>${kabuk(".")}</p>

<h2><span lang=TR>Öncelikler<o:p></o:p></span></h2>

<p class=MsoNormal>${kabuk("Sıralama aşağıdaki gibidir.")}</p>

${madde("1.", "Altyapı yenileme")}
${madde("2.", "Ekip büyütme")}
${madde("3.", "Süreç iyileştirme")}

<h3><span lang=TR>Bütçe<o:p></o:p></span></h3>

<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
 style='border-collapse:collapse;border:none'>
 <tr>
  <td width=200 style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>
  <p class=MsoNormal>${kabuk("Kalem")}</p></td>
  <td width=200 style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>
  <p class=MsoNormal>${kabuk("Tutar")}</p></td>
 </tr>
 <tr>
  <td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>
  <p class=MsoNormal>${kabuk("Altyapı")}</p></td>
  <td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>
  <p class=MsoNormal>${kabuk("1.200.000")}</p></td>
 </tr>
</table>

<p class=MsoNormal><o:p>&nbsp;</o:p></p>

<h2><span lang=TR>Sonuç<o:p></o:p></span></h2>

<p class=MsoNormal>${kabuk("Hedeflerin ")}<b><span style='font-weight:bold'>tamamına</span></b>${kabuk(" ulaşıldı.")}</p>

<!--EndFragment-->
</body>
</html>`;

/** Word aynı içeriği düz metin olarak da yazar. */
export const WORD_TEXT = `Yıllık Değerlendirme
Bu rapor geçen yılın öne çıkan başlıklarını ve gelecek yılın planını özetliyor.
Başarılar
Üç alanda ilerleme kaydedildi:
Gelirde artış
Müşteri memnuniyeti
Destek süresi kısaldı
Şikâyet oranı düştü
Yeni pazarlar`;
