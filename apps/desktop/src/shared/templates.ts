/**
 * Analysis templates: Markdown documents with a small front matter that
 * names the template, the sections a document made from it must have and
 * the ids its requirements take. The team's own templates are kept in a
 * workspace's `.kalem/templates` folder, the user's in the app's data; one
 * best-practice template comes with Kalem, to start from. Pure.
 */
import type { Lang } from "./i18n.js";

/** Where a template is kept. */
export type TemplateSource = "builtin" | "personal" | "workspace";

export interface TemplateMeta {
	/** Its name as the user gave it. */
	readonly name: string;
	/** Headings a document made from it must have. */
	readonly required: readonly string[];
	/** The prefixes of its ids, by kind: `{ FR: "FR-" }`. */
	readonly ids: Readonly<Record<string, string>>;
	/** The heading under which open questions go. */
	readonly questions: string;
}

export interface TemplateInfo extends TemplateMeta {
	/** `builtin:best-practice`, `personal:<file>`, `workspace:<folder>|<file>`. */
	readonly id: string;
	readonly source: TemplateSource;
	/** Its file; `null` for the built-in one. */
	readonly path: string | null;
}

export const BUILTIN_ID = "builtin:best-practice";

const FRONT = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A front matter value: a quoted or bare string, a `[a, b]` list, or a `{ A: "a-" }` map. */
function value(raw: string): string | string[] | Record<string, string> {
	const text = raw.trim();
	const unquote = (part: string): string => part.trim().replace(/^(["'])(.*)\1$/, "$2");
	if (text.startsWith("[") && text.endsWith("]")) {
		return text
			.slice(1, -1)
			.split(",")
			.map(unquote)
			.filter((part) => part !== "");
	}
	if (text.startsWith("{") && text.endsWith("}")) {
		const map: Record<string, string> = {};
		for (const pair of text.slice(1, -1).split(",")) {
			const at = pair.indexOf(":");
			if (at === -1) continue;
			const key = unquote(pair.slice(0, at));
			if (key !== "") map[key] = unquote(pair.slice(at + 1));
		}
		return map;
	}
	return unquote(text);
}

/** The template's own lines at its top, and its body. */
export function splitTemplate(text: string): { meta: Record<string, unknown>; body: string } {
	const match = FRONT.exec(text);
	if (match === null) return { meta: {}, body: text };
	const meta: Record<string, unknown> = {};
	let list: string | null = null;
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item !== null && list !== null) {
			(meta[list] as string[]).push(String(value(item[1] as string)));
			continue;
		}
		const pair = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
		if (pair === null) continue;
		const key = pair[1] as string;
		const rest = pair[2] as string;
		if (rest.trim() === "") {
			meta[key] = [];
			list = key;
		} else {
			meta[key] = value(rest);
			list = null;
		}
	}
	return { meta, body: text.slice(match[0].length) };
}

/** What a template says about itself; its file's name when it gives none. */
export function templateMeta(text: string, fallbackName: string): TemplateMeta {
	const { meta } = splitTemplate(text);
	const name = typeof meta["kalem-template"] === "string" ? (meta["kalem-template"] as string) : "";
	const required = Array.isArray(meta.required) ? (meta.required as string[]) : [];
	const ids =
		typeof meta.ids === "object" && meta.ids !== null && !Array.isArray(meta.ids)
			? (meta.ids as Record<string, string>)
			: {};
	const questions = typeof meta.questions === "string" ? (meta.questions as string) : "";
	return {
		name: (name || fallbackName).slice(0, 200),
		required: required.map((heading) => heading.slice(0, 200)).slice(0, 100),
		ids,
		questions: questions.slice(0, 200),
	};
}

/** A new document's text from a template: its front matter left out, `{{title}}` filled in. */
export function documentFromTemplate(text: string, title: string): string {
	return splitTemplate(text)
		.body.replace(/\{\{\s*(?:title|başlık|baslik)\s*\}\}/giu, title)
		.replace(/^\n+/, "");
}

/** A file name for a template's name. */
export function templateFileName(name: string): string {
	const base = name
		.normalize("NFC")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	return `${base === "" ? "template" : base}.md`;
}

/** A document made into a template: its front matter added when it has none. */
export function asTemplate(text: string, name: string): string {
	if (FRONT.test(text)) return text;
	return `---\nkalem-template: ${JSON.stringify(name)}\nrequired: []\n---\n\n${text.replace(/^\n+/, "")}`;
}

const BEST_PRACTICE_TR = `---
kalem-template: "Yazılım Analiz Dokümanı (best practice)"
required: [Amaç ve Kapsam, Terimler Sözlüğü, İş Kuralları, Fonksiyonel Gereksinimler, Fonksiyonel Olmayan Gereksinimler, Hata ve İstisna Senaryoları, Açık Sorular]
ids: { BR: "BR-", FR: "FR-", NFR: "NFR-" }
questions: Açık Sorular
---

# {{başlık}}

| Alan | Değer |
|---|---|
| Sürüm | 0.1 |
| Hazırlayan | |
| İlgili Jira | |
| Durum | Taslak |

## Amaç ve Kapsam

<!-- yönerge: İşin neden yapıldığını, kimin için olduğunu 2-3 cümleyle yazın. Kapsama girenleri ve girmeyenleri ayrı listeleyin. -->

**Kapsamda:**

-

**Kapsam dışı:**

-

## Paydaşlar

| Rol | Kişi / Ekip | Sorumluluk |
|---|---|---|
| | | |

## Terimler Sözlüğü

<!-- yönerge: Her iş terimini bir kez tanımlayın ve belge boyunca aynı adla kullanın. -->

| Terim | Tanım |
|---|---|
| | |

## Mevcut Durum

<!-- yönerge: Bugün süreç nasıl işliyor, sorun ne? -->

## İstenen Durum

<!-- yönerge: İş bittiğinde ne değişmiş olacak? Ölçülebilir başarı ölçütleri yazın. -->

## İş Kuralları

<!-- yönerge: Her kural tek bir şey söylesin; BR-01, BR-02 diye boşluksuz numaralayın. -->

- **BR-01:**

## Fonksiyonel Gereksinimler

<!-- yönerge: Her gereksinim için kabul kriterlerini Given/When/Then (Diyelim ki/Eğer/O zaman) biçiminde, hata durumlarıyla birlikte yazın. -->

### FR-01:

**Açıklama:**

**Kabul kriterleri:**

- Diyelim ki …, eğer …, o zaman …

## Fonksiyonel Olmayan Gereksinimler

<!-- yönerge: Sayı verin: yanıt süresi (p95), hacim, erişilebilirlik, saklama süresi, denetim kaydı. -->

- **NFR-01:**

## Veri Modeli

<!-- yönerge: Varlıklar, alanlar, tipleri ve kuralları. Birden çok varlık varsa Mermaid erDiagram ekleyin. -->

## Akışlar

<!-- yönerge: Ana akış ve alternatifler. Her karar noktasının tüm cevapları gösterilsin. -->

## Ekranlar ve Mesajlar

## Entegrasyonlar

<!-- yönerge: Kim kimi çağırıyor, biçim, hata ve yeniden deneme davranışı. -->

## Yetkilendirme ve Roller

## Güvenlik ve Kişisel Veriler

<!-- yönerge: KVKK/GDPR kapsamındaki veriler, maskeleme, saklama ve silme. -->

## Hata ve İstisna Senaryoları

| Senaryo | Beklenen davranış | Kullanıcıya mesaj |
|---|---|---|
| | | |

## Veri Taşıma

## Riskler, Varsayımlar ve Bağımlılıklar

## Açık Sorular

- [ ]

## İzlenebilirlik

| Gereksinim | Jira | Test | Not |
|---|---|---|---|
| FR-01 | | | |
`;

const BEST_PRACTICE_EN = `---
kalem-template: "Software Analysis Document (best practice)"
required: [Purpose and Scope, Glossary, Business Rules, Functional Requirements, Non-Functional Requirements, Errors and Exceptions, Open Questions]
ids: { BR: "BR-", FR: "FR-", NFR: "NFR-" }
questions: Open Questions
---

# {{title}}

| Field | Value |
|---|---|
| Version | 0.1 |
| Author | |
| Jira | |
| Status | Draft |

## Purpose and Scope

<!-- guide: Why this work, for whom, in 2-3 sentences. List what is in and out of scope. -->

**In scope:**

-

**Out of scope:**

-

## Stakeholders

| Role | Person / Team | Responsibility |
|---|---|---|
| | | |

## Glossary

<!-- guide: Define each business term once and use the same name everywhere. -->

| Term | Definition |
|---|---|
| | |

## Current State

## Target State

<!-- guide: What will have changed when this is done? Give measurable success criteria. -->

## Business Rules

- **BR-01:**

## Functional Requirements

<!-- guide: Acceptance criteria as Given/When/Then for each requirement, error cases included. -->

### FR-01:

**Description:**

**Acceptance criteria:**

- Given …, when …, then …

## Non-Functional Requirements

<!-- guide: Give numbers: response time (p95), volume, availability, retention, audit. -->

- **NFR-01:**

## Data Model

## Flows

## Screens and Messages

## Integrations

## Permissions and Roles

## Security and Personal Data

## Errors and Exceptions

| Case | Expected behaviour | Message to the user |
|---|---|---|
| | | |

## Data Migration

## Risks, Assumptions and Dependencies

## Open Questions

- [ ]

## Traceability

| Requirement | Jira | Test | Note |
|---|---|---|---|
| FR-01 | | | |
`;

const AGENT_SPEC_TR = `---
kalem-template: "Kodlama Ajanı için Spec"
required: [Amaç, Kapsam, Fonksiyonel Gereksinimler, Fonksiyonel Olmayan Gereksinimler, Kod Bağlamı, Açık Sorular]
ids: { BR: "BR-", FR: "FR-", NFR: "NFR-" }
questions: Açık Sorular
---

# {{başlık}}

<!-- yönerge: Bu belge bir kodlama ajanının (Claude Code, Copilot, Cursor…) okuyup uygulayacağı bir spec'e dönüşür. Bitince asistana Prompt Hazırla modunda "spec olarak kaydet" deyin: gereksinimler, tasarım ve görev listesi depoya yazılır. -->

## Amaç

<!-- yönerge: Ne değişecek ve neden? İki üç cümle; iş bittiğinde neyin ölçüleceğini de yazın. -->

## Kapsam

**Kapsamda:**

-

**Kapsam dışı:**

-

## Terimler

| Terim | Tanım |
|---|---|
| | |

## İş Kuralları

- **BR-01:**

## Fonksiyonel Gereksinimler

<!-- yönerge: Her gereksinim tek bir davranış anlatsın. Kabul kriterlerini "… OLDUĞUNDA sistem … MALIDIR" kalıbıyla, hata durumlarıyla birlikte yazın; ajan her kriterden bir test çıkarır. -->

### FR-01:

**Kullanıcı hikâyesi:** Bir … olarak, … istiyorum, böylece …

**Kabul kriterleri:**

- … OLDUĞUNDA sistem … MALIDIR.
- … geçersiz OLDUĞUNDA sistem … hatası vermeli ve … MALIDIR.

## Fonksiyonel Olmayan Gereksinimler

<!-- yönerge: Sayı verin: yanıt süresi (p95), hacim, güvenlik, geriye uyumluluk. -->

- **NFR-01:**

## Kod Bağlamı

<!-- yönerge: Dokunulacak modüller ve dosyalar, izlenecek mevcut kalıplar, kullanılacak servisler. Bilmiyorsanız boş bırakın; asistan çalışma alanından bulur. -->

## Kısıtlar ve Varsayımlar

## Test Yaklaşımı

<!-- yönerge: Hangi testler yazılacak (birim, entegrasyon, uçtan uca), hangi veriyle? -->

## Açık Sorular

- [ ]
`;

const AGENT_SPEC_EN = `---
kalem-template: "Spec for a Coding Agent"
required: [Goal, Scope, Functional Requirements, Non-Functional Requirements, Code Context, Open Questions]
ids: { BR: "BR-", FR: "FR-", NFR: "NFR-" }
questions: Open Questions
---

# {{title}}

<!-- guide: This document becomes a spec a coding agent (Claude Code, Copilot, Cursor…) reads and builds. When it is done, ask the assistant in the Prepare Prompt mode to "keep it as a spec": the requirements, design and task list are written into the repository. -->

## Goal

<!-- guide: What changes, and why, in two or three sentences; what will be measured when it is done. -->

## Scope

**In scope:**

-

**Out of scope:**

-

## Glossary

| Term | Definition |
|---|---|
| | |

## Business Rules

- **BR-01:**

## Functional Requirements

<!-- guide: One behaviour for each requirement. Write the acceptance criteria as "WHEN … THE SYSTEM SHALL …", error cases included; the agent makes a test of each. -->

### FR-01:

**User story:** As a …, I want …, so that …

**Acceptance criteria:**

- WHEN … THE SYSTEM SHALL …
- WHEN … is invalid THE SYSTEM SHALL reject it with … and …

## Non-Functional Requirements

<!-- guide: Give numbers: response time (p95), volume, security, backward compatibility. -->

- **NFR-01:**

## Code Context

<!-- guide: The modules and files it touches, the patterns to follow, the services it uses. Leave it empty when you do not know: the assistant finds them in the workspace. -->

## Constraints and Assumptions

## Test Approach

<!-- guide: Which tests (unit, integration, end-to-end), with what data? -->

## Open Questions

- [ ]
`;

/** The template for a spec a coding agent works from. */
export const AGENT_SPEC_ID = "builtin:agent-spec";

/** The templates that come with Kalem, the default one first. */
export const BUILTIN_TEMPLATE_IDS: readonly string[] = [BUILTIN_ID, AGENT_SPEC_ID];

export const isBuiltinTemplate = (id: string): boolean => BUILTIN_TEMPLATE_IDS.includes(id);

/** A template that comes with Kalem, in the interface's language: the best-practice one unless named. */
export function builtinTemplate(lang: Lang, id: string = BUILTIN_ID): string {
	if (id === AGENT_SPEC_ID) return lang === "tr" ? AGENT_SPEC_TR : AGENT_SPEC_EN;
	return lang === "tr" ? BEST_PRACTICE_TR : BEST_PRACTICE_EN;
}
