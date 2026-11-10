import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelOption } from "../shared/models.js";
import { copilotModelsOf, copilotOauthToken } from "../shared/models.js";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** How long the account's Copilot models are used before GitHub is asked again. */
const COPILOT_LIFETIME = 30 * 60_000;

/** Where the Copilot plugins (VS Code's, JetBrains', Vim's) keep their GitHub login. */
function copilotLoginFiles(): string[] {
	const base =
		process.platform === "win32"
			? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
			: (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
	return ["apps.json", "hosts.json"].map((name) => join(base, "github-copilot", name));
}

/** The GitHub CLI's token, when it is installed and signed in; `null` otherwise. */
function ghToken(): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("gh", ["auth", "token"], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
			const token = String(stdout ?? "").trim();
			resolve(error === null && token !== "" ? token : null);
		});
	});
}

/**
 * The models the assistant's services offer beyond what their CLIs say:
 * the model each Claude Code alias answered with last (kept between runs),
 * and the GitHub account's Copilot models, as VS Code lists them.
 */
export class ModelCatalog {
	readonly #file: string;
	readonly #fetch: Fetch;
	#learned: Record<string, string> | null = null;
	#copilot: { until: number; models: Promise<ModelOption[]> } | null = null;

	constructor(file: string, fetchImpl: Fetch) {
		this.#file = file;
		this.#fetch = fetchImpl;
	}

	/** Claude Code's aliases and the model each answered with last (`opus` → `claude-opus-5-5`). */
	async learned(): Promise<Record<string, string>> {
		if (this.#learned !== null) return this.#learned;
		try {
			const raw: unknown = JSON.parse(await readFile(this.#file, "utf8"));
			const kept: Record<string, string> = {};
			for (const [alias, model] of Object.entries(
				typeof raw === "object" && raw !== null ? raw : {},
			)) {
				if (typeof model === "string" && /^[\w.:[\]/@-]{1,120}$/.test(model))
					kept[alias.slice(0, 60)] = model;
			}
			this.#learned = kept;
		} catch {
			this.#learned = {};
		}
		return this.#learned;
	}

	/** What an alias (or "default", when none was chosen) answered with. */
	async learn(alias: string, model: string): Promise<void> {
		const learned = await this.learned();
		const key = alias === "" ? "default" : alias;
		if (learned[key] === model) return;
		learned[key] = model;
		await mkdir(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		await writeFile(temp, JSON.stringify(learned, null, "\t"));
		await rename(temp, this.#file);
	}

	/**
	 * The GitHub account's Copilot models, as VS Code lists them (an
	 * organization's own included); empty when no GitHub login is found or
	 * GitHub says no. The login is looked for in the environment
	 * (COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN), the Copilot plugins'
	 * files and the GitHub CLI; it is only sent to GitHub.
	 */
	copilotModels(): Promise<ModelOption[]> {
		if (process.env.KALEM_COPILOT_MODELS === "off") return Promise.resolve([]);
		const now = Date.now();
		if (this.#copilot !== null && this.#copilot.until > now) return this.#copilot.models;
		const models = this.#askCopilot().catch(() => []);
		this.#copilot = { until: now + COPILOT_LIFETIME, models };
		// An empty answer is asked again sooner: the user may sign in meanwhile.
		void models.then((found) => {
			if (found.length === 0 && this.#copilot?.models === models) {
				this.#copilot = { until: Date.now() + 60_000, models };
			}
		});
		return models;
	}

	async #githubTokens(): Promise<string[]> {
		const tokens: string[] = [];
		for (const name of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
			const value = process.env[name]?.trim();
			if (value) tokens.push(value);
		}
		for (const file of copilotLoginFiles()) {
			try {
				const token = copilotOauthToken(JSON.parse(await readFile(file, "utf8")));
				if (token !== null) tokens.push(token);
			} catch {
				// Not there: the next place is looked at.
			}
		}
		const gh = await ghToken();
		if (gh !== null) tokens.push(gh);
		return [...new Set(tokens)];
	}

	async #askCopilot(): Promise<ModelOption[]> {
		for (const github of await this.#githubTokens()) {
			// GitHub gives a short-lived Copilot token for the login, and the address of its API.
			const exchange = await this.#fetch("https://api.github.com/copilot_internal/v2/token", {
				headers: { Authorization: `token ${github}`, Accept: "application/json" },
			}).catch(() => null);
			if (exchange === null || !exchange.ok) continue;
			const grant = (await exchange.json().catch(() => ({}))) as {
				token?: unknown;
				endpoints?: { api?: unknown };
			};
			if (typeof grant.token !== "string") continue;
			const api =
				typeof grant.endpoints?.api === "string" && /^https:\/\//.test(grant.endpoints.api)
					? grant.endpoints.api.replace(/\/+$/, "")
					: "https://api.githubcopilot.com";
			const listed = await this.#fetch(`${api}/models`, {
				headers: {
					Authorization: `Bearer ${grant.token}`,
					Accept: "application/json",
					"Copilot-Integration-Id": "vscode-chat",
					"Editor-Version": "Kalem/1",
				},
			}).catch(() => null);
			if (listed === null || !listed.ok) continue;
			const models = copilotModelsOf(await listed.json().catch(() => ({})));
			if (models.length > 0) return models;
		}
		return [];
	}
}
