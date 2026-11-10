/**
 * Where analysis templates are kept: the user's own in the app's data
 * folder, the team's in each open folder's `.kalem/templates`, and the
 * best-practice one that comes with Kalem. A team's template wins over a
 * personal one of the same name: it is the team's standard.
 */
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { Lang } from "../shared/i18n.js";
import type { TemplateInfo, TemplateSource } from "../shared/templates.js";
import {
	BUILTIN_ID,
	builtinTemplate,
	templateFileName,
	templateMeta,
} from "../shared/templates.js";

export const WORKSPACE_TEMPLATES = join(".kalem", "templates");

const MAX_TEMPLATE = 1_000_000;

export interface TemplateStoreOptions {
	/** The user's own templates. */
	readonly folder: string;
	/** The open folders, whose `.kalem/templates` the team keeps. */
	workspaces(): readonly string[];
	language(): Lang;
}

export class TemplateStore {
	readonly #options: TemplateStoreOptions;

	constructor(options: TemplateStoreOptions) {
		this.#options = options;
	}

	/** The folders templates are read from, the team's first. */
	#folders(): { source: Exclude<TemplateSource, "builtin">; folder: string }[] {
		return [
			...this.#options
				.workspaces()
				.map((root) => ({ source: "workspace" as const, folder: join(root, WORKSPACE_TEMPLATES) })),
			{ source: "personal" as const, folder: this.#options.folder },
		];
	}

	/** Whether a path is a template file Kalem keeps: in one of the folders, a `.md` file. */
	#isTemplate(path: string): boolean {
		return (
			path.toLowerCase().endsWith(".md") && // kalem-locale-ok: a file extension
			this.#folders().some(({ folder }) => {
				const below = relative(folder, path);
				return below !== "" && !below.startsWith("..") && !below.includes(sep);
			})
		);
	}

	async list(): Promise<TemplateInfo[]> {
		const found: TemplateInfo[] = [];
		const names = new Set<string>();
		for (const { source, folder } of this.#folders()) {
			let entries: string[];
			try {
				entries = await readdir(folder);
			} catch {
				continue;
			}
			for (const entry of entries.sort()) {
				if (!entry.toLowerCase().endsWith(".md")) continue; // kalem-locale-ok: a file extension
				const path = join(folder, entry);
				let text: string;
				try {
					text = (await readFile(path, "utf8")).slice(0, MAX_TEMPLATE);
				} catch {
					continue;
				}
				const meta = templateMeta(text, entry.replace(/\.md$/i, ""));
				const key = meta.name.toLocaleLowerCase("tr");
				if (names.has(key)) continue;
				names.add(key);
				found.push({ ...meta, id: path, source, path });
			}
		}
		const builtin = templateMeta(builtinTemplate(this.#options.language()), "");
		found.push({ ...builtin, id: BUILTIN_ID, source: "builtin", path: null });
		return found;
	}

	async read(id: string): Promise<{ info: TemplateInfo; text: string }> {
		const info = (await this.list()).find((template) => template.id === id);
		if (info === undefined) throw new Error("There is no such template.");
		if (info.path === null) return { info, text: builtinTemplate(this.#options.language()) };
		return { info, text: (await readFile(info.path, "utf8")).slice(0, MAX_TEMPLATE) };
	}

	/** The template a name or id means: the same id, the same name, or one whose name has it. */
	async find(nameOrId: string): Promise<TemplateInfo | null> {
		const all = await this.list();
		const wanted = nameOrId.trim().toLocaleLowerCase("tr");
		return (
			all.find((template) => template.id === nameOrId) ??
			all.find((template) => template.name.toLocaleLowerCase("tr") === wanted) ??
			all.find((template) => template.name.toLocaleLowerCase("tr").includes(wanted)) ??
			null
		);
	}

	/** Saves a template where the user keeps theirs, or with the team in the first open folder. */
	async save(
		where: Exclude<TemplateSource, "builtin">,
		name: string,
		text: string,
	): Promise<TemplateInfo> {
		const folder =
			where === "workspace"
				? (() => {
						const root = this.#options.workspaces()[0];
						if (root === undefined)
							throw new Error("Open a folder to keep the team's templates in it.");
						return join(root, WORKSPACE_TEMPLATES);
					})()
				: this.#options.folder;
		await mkdir(folder, { recursive: true });
		let path = join(folder, templateFileName(name));
		for (let n = 2; await exists(path); n++) {
			path = join(folder, templateFileName(`${name} ${n}`));
		}
		await writeFile(path, text.slice(0, MAX_TEMPLATE), { flag: "wx" });
		return { ...templateMeta(text, basename(path, ".md")), id: path, source: where, path };
	}

	async remove(id: string): Promise<void> {
		if (id === BUILTIN_ID || !this.#isTemplate(id))
			throw new Error("This template cannot be removed.");
		await rm(id);
	}

	/** Whether the id is a template file of these folders (for opening it in a tab). */
	isFile(id: string): boolean {
		return id !== BUILTIN_ID && this.#isTemplate(id);
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
