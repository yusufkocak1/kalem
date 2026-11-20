/**
 * The files a repository keeps its rules for coding agents in: AGENTS.md
 * (read by most agents), and the ones some agents read instead (CLAUDE.md,
 * Copilot's instructions, GEMINI.md). The assistant reads them so the
 * prompts and specs it writes keep to them; a new AGENTS.md starts from a
 * short outline the team fills in. Pure.
 */
import type { Lang } from "./i18n.js";

/** Where the rules may be, relative to a workspace folder, the one most agents read first. */
export const AGENT_RULE_FILES: readonly string[] = [
	"AGENTS.md",
	"CLAUDE.md",
	".github/copilot-instructions.md",
	"GEMINI.md",
];

/** How much of each file the model is given. */
export const MAX_RULES = 12_000;

/** The rules found, as the model reads them: each file under its path, cut to a size. */
export function agentRulesText(found: readonly { path: string; text: string }[]): string {
	if (found.length === 0) {
		return `The workspace has none of ${AGENT_RULE_FILES.join(", ")}: there are no written rules for coding agents. agent_rules_open can start an AGENTS.md when the user wants one.`;
	}
	return found
		.map(({ path, text }) => {
			const cut = text.length > MAX_RULES;
			return `<rules file="${path}">\n${cut ? `${text.slice(0, MAX_RULES)}\n… (cut; read_file has the rest)` : text}\n</rules>`;
		})
		.join("\n\n");
}

const STARTER_TR = `# AGENTS.md

Bu dosya, bu depoda çalışan kodlama ajanlarına (Claude Code, Copilot, Codex, Cursor…) projenin kurallarını anlatır. Kısa ve güncel tutun; her madde bir kural olsun.

## Proje

<!-- Proje ne yapar, kimin için? İki üç cümle. -->

## Kurulum ve komutlar

- Bağımlılıkları kur: \`\`
- Testler: \`\`
- Lint / biçim: \`\`
- Derleme: \`\`

## Kod düzeni

<!-- Klasörler ve ne içerdikleri; yeni kodun nereye yazılacağı. -->

## Kod kuralları

- 

## Testler

<!-- Hangi değişiklik hangi testi ister; testler nerede, nasıl adlandırılır? -->

## Yapılmaması gerekenler

- 

## Gereksinimler ve spec'ler

- Analizler ve spec'ler \`specs/\` altındadır; bir göreve başlamadan önce ilgili \`spec.md\` ve \`tasks.md\` dosyalarını okuyun.
- Bitirdiğiniz görevi \`tasks.md\` içinde \`- [x]\` olarak işaretleyin.
- Commit mesajında görevin gereksinim kimliğini (\`FR-…\`) geçirin.
`;

const STARTER_EN = `# AGENTS.md

This file tells coding agents working in this repository (Claude Code, Copilot, Codex, Cursor…) the project's rules. Keep it short and current; one rule per item.

## Project

<!-- What the project does, and for whom, in two or three sentences. -->

## Setup and commands

- Install: \`\`
- Tests: \`\`
- Lint / format: \`\`
- Build: \`\`

## Code layout

<!-- The folders and what is in them; where new code goes. -->

## Code rules

- 

## Tests

<!-- Which change needs which test; where tests are and how they are named. -->

## Do not

- 

## Requirements and specs

- Analyses and specs are under \`specs/\`; read the \`spec.md\` and \`tasks.md\` of a task before starting it.
- Mark a task you finished as \`- [x]\` in \`tasks.md\`.
- Name the task's requirement id (\`FR-…\`) in the commit message.
`;

/** A new AGENTS.md: an outline the team fills in, in the interface's language. */
export function agentsStarter(lang: Lang): string {
	return lang === "tr" ? STARTER_TR : STARTER_EN;
}
