import { translator } from "./i18n.js";
import { appendText, entryMatches, searchPattern } from "./parse.js";

const CHUNK = 1024 * 1024;
const FIRST_LOAD = 512 * 1024;
const SEARCH_BYTES = 4 * 1024 * 1024;

const nameOf = (path) => path.split(/[\\/]/).pop() || path;

export async function activate(kalem) {
	const t = translator(kalem.language);
	let files = (await kalem.storage.get("files")) ?? [];
	let recent = (await kalem.storage.get("recent")) ?? [];

	const remember = async () => {
		await kalem.storage.set("files", files);
		await kalem.storage.set("recent", recent);
	};

	async function add(raw) {
		const path = await kalem.fs.resolve(String(raw ?? ""));
		const info = await kalem.fs.stat(path);
		if (info === null) throw new Error(t("{0} is not there.", path));
		if (info.type !== "file") throw new Error(t("{0} is a folder, not a file.", path));
		if (!files.some((file) => file.path === path)) files = [...files, { path, name: nameOf(path) }];
		recent = [path, ...recent.filter((each) => each !== path)].slice(0, 12);
		await remember();
		return { files, path };
	}

	async function pick() {
		const path = await kalem.ui.pickPath({ title: t("Open a Log File…") });
		return path === null ? null : add(path);
	}

	const ui = (name, handler) => kalem.ui.handle(name, handler);
	await ui("state", async () => ({ files, recent, settings: await kalem.settings.all() }));
	await ui("pick", () => pick());
	await ui("add", (path) => add(path));
	await ui("remove", async (path) => {
		files = files.filter((file) => file.path !== path);
		await remember();
		return files;
	});
	await ui("forget", async (path) => {
		recent = recent.filter((each) => each !== path);
		await remember();
		return recent;
	});
	await ui("tail", (path) => kalem.fs.readRange(String(path), { tail: FIRST_LOAD }));
	await ui("before", ({ path, end }) => {
		const start = Math.max(0, Number(end) - CHUNK);
		return kalem.fs.readRange(String(path), { start, length: Number(end) - start, align: true });
	});
	/** What was written since `offset`; when the file got shorter (rotated, truncated) its end again. */
	await ui("poll", async ({ path, offset }) => {
		const info = await kalem.fs.stat(String(path));
		if (info === null) return { missing: true };
		if (info.size < offset)
			return { rotated: true, ...(await kalem.fs.readRange(String(path), { tail: FIRST_LOAD })) };
		if (info.size === offset) return { text: "", start: offset, end: offset, size: info.size };
		return kalem.fs.readRange(String(path), { start: offset, length: CHUNK });
	});

	await kalem.commands.register("open", () => kalem.ui.showPane("logs"));
	await kalem.commands.register("openFile", async () => {
		const opened = await pick();
		if (opened === null) return;
		await kalem.ui.showPane("logs");
		await kalem.ui.post({ type: "opened", ...opened });
	});

	// --- The assistant's tools ------------------------------------------------------------

	const fileFor = async (input) => {
		const wanted = input?.file ? String(input.file) : "";
		if (wanted === "") {
			if (files.length === 0)
				throw new Error("No log file is open in the Log Viewer; give a path.");
			return files[0].path;
		}
		const open = files.find((file) => file.path === wanted || file.name === wanted);
		return open ? open.path : kalem.fs.resolve(wanted);
	};
	const describe = (entry) =>
		[
			entry.line,
			...entry.more.slice(0, 12),
			...(entry.more.length > 12 ? [`\t... ${entry.more.length - 12} more lines`] : []),
		].join("\n");

	await kalem.assistant.registerTool(
		{
			name: "log_files",
			description:
				"The log files open in the Log Viewer, with their size and when they last changed.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		async () => {
			if (files.length === 0) return "No log file is open.";
			const lines = [];
			for (const file of files) {
				const info = await kalem.fs.stat(file.path);
				lines.push(
					info
						? `${file.path} (${Math.round(info.size / 1024)} KB, changed ${new Date(info.modified).toISOString()})`
						: `${file.path} (missing)`,
				);
			}
			return lines.join("\n");
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "log_tail",
			description:
				"The last entries of a log file (a line with its stack trace is one entry), optionally only some levels. By default the first file open in the Log Viewer.",
			parameters: {
				type: "object",
				properties: {
					file: {
						type: "string",
						description: "A path, or the name of a file open in the Log Viewer.",
					},
					entries: {
						type: "integer",
						description: "How many of the last entries (default 50, at most 300).",
					},
					levels: {
						type: "array",
						items: { type: "string", enum: ["fatal", "error", "warn", "info", "debug", "trace"] },
					},
				},
				required: [],
			},
		},
		async (input) => {
			const path = await fileFor(input);
			const range = await kalem.fs.readRange(path, { tail: SEARCH_BYTES });
			const entries = [];
			appendText(entries, range.text);
			const levels =
				Array.isArray(input?.levels) && input.levels.length > 0 ? new Set(input.levels) : null;
			const count = Math.min(Math.max(Number(input?.entries) || 50, 1), 300);
			const picked = entries
				.filter((entry) => levels === null || levels.has(entry.level))
				.slice(-count);
			return `${path}: ${picked.length} entr${picked.length === 1 ? "y" : "ies"}\n\n${picked.map(describe).join("\n")}`;
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "log_search",
			description:
				"Searches the last 4 MB of a log file for text or a regular expression; returns the matching entries with their stack traces.",
			parameters: {
				type: "object",
				properties: {
					file: {
						type: "string",
						description: "A path, or the name of a file open in the Log Viewer.",
					},
					query: { type: "string" },
					regex: { type: "boolean", description: "Take the query as a regular expression." },
					limit: {
						type: "integer",
						description: "At most this many entries (default 30, at most 200).",
					},
				},
				required: ["query"],
			},
		},
		async (input) => {
			const path = await fileFor(input);
			const pattern = searchPattern(String(input?.query ?? ""), { regex: input?.regex === true });
			const range = await kalem.fs.readRange(path, { tail: SEARCH_BYTES });
			const entries = [];
			appendText(entries, range.text);
			const found = entries.filter((entry) => entryMatches(entry, pattern));
			const limit = Math.min(Math.max(Number(input?.limit) || 30, 1), 200);
			const shown = found.slice(-limit);
			return `${found.length} matching entr${found.length === 1 ? "y" : "ies"} in ${path}${found.length > shown.length ? ` (the last ${shown.length})` : ""}\n\n${shown.map(describe).join("\n")}`;
		},
	);
}
