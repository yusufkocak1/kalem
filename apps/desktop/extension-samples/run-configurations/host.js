import { translator } from "./i18n.js";
import {
	localUrlIn,
	parseEnv,
	parseStore,
	pathTools,
	problemsOf,
	STORE_VERSION,
	TYPES,
	typeSchemas,
} from "./types.js";

const MAX_OUTPUT = 2_000_000;
const MAX_SESSIONS = 20;
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

export async function activate(kalem) {
	const platform = kalem.platform;
	const t = translator(kalem.language);
	const paths = pathTools(platform);
	let folder = null;
	let configurations = [];
	let selected = null;
	const sessions = [];
	let next = 0;

	async function load() {
		const folders = await kalem.workspace.folders();
		folder = folders[0] ?? null;
		if (folder === null) {
			configurations = [];
			return;
		}
		const file = paths.join(folder, ".kalem", "run.json");
		const text = (await kalem.fs.exists(file)) ? await kalem.fs.readText(file) : "{}";
		configurations = parseStore(text).configurations;
		if (!configurations.some((each) => each.name === selected))
			selected = configurations[0]?.name ?? null;
	}

	async function save(list) {
		if (folder === null)
			throw new Error(t("Open a folder first: the configurations are kept in it."));
		const names = list.map((each) => each.name);
		for (const config of list) {
			const problems = problemsOf(config, names, t);
			if (problems.length > 0)
				throw new Error(`${config.name || "A configuration"}: ${problems.join(" ")}`);
		}
		if (new Set(names).size !== names.length)
			throw new Error(t("Two configurations have the same name."));
		await kalem.fs.writeText(
			paths.join(folder, ".kalem", "run.json"),
			`${JSON.stringify({ version: STORE_VERSION, configurations: list }, null, "\t")}\n`,
		);
		configurations = list;
		if (!names.includes(selected)) selected = names[0] ?? null;
		await refreshStatus();
	}

	const summary = (session) => ({
		id: session.id,
		name: session.name,
		type: session.type,
		status: session.status,
		code: session.code,
		startedAt: session.startedAt,
		url: session.url,
		parent: session.parent,
	});

	const publish = (session) => kalem.ui.post({ type: "session", session: summary(session) });

	function append(session, stream, text) {
		if (text === "") return;
		session.output.push({ stream, text });
		session.size += text.length;
		while (session.size > MAX_OUTPUT && session.output.length > 1)
			session.size -= session.output.shift().text.length;
		kalem.ui.post({ type: "output", session: session.id, stream, text });
		if (session.watch !== null) session.watch(text);
	}

	const running = (name) =>
		sessions.find((each) => each.name === name && each.status === "running");

	async function refreshStatus() {
		if (selected === null) {
			await kalem.ui.setStatusItem("run", null);
			return;
		}
		const busy = running(selected) !== undefined;
		await kalem.ui.setStatusItem("run", {
			text: `${busy ? "■" : "▶"} ${selected}`,
			tooltip: busy ? t("Stop {0}", selected) : t("Run {0}", selected),
			command: busy ? "stop" : "run",
		});
	}

	/** Runs a program within a session; resolves with its exit code. */
	function runProgram(session, spec, cwd) {
		return new Promise((resolve, reject) => {
			kalem.process
				.spawn(
					{
						command: spec.command,
						args: spec.args ?? [],
						cwd,
						env: spec.env ?? {},
						shell: spec.shell === true,
						encoding: spec.encoding ?? "utf-8",
					},
					(event) => {
						if (event.type === "output") append(session, event.stream, event.text);
						else if (event.type === "error") {
							append(session, "system", `\n${event.message}\n`);
							resolve(-1);
						} else resolve(event.code ?? -1);
					},
				)
				.then((id) => {
					session.process = id;
				}, reject);
		});
	}

	async function start(name, parent = null) {
		await load();
		const config = configurations.find((each) => each.name === name);
		if (config === undefined) throw new Error(t('There is no configuration named "{0}".', name));
		const problems = problemsOf(
			config,
			configurations.map((each) => each.name),
			t,
		);
		if (problems.length > 0) throw new Error(`${name}: ${problems.join(" ")}`);
		const already = running(name);
		if (already !== undefined) await stop(already.id);

		const session = {
			id: `s${++next}`,
			name,
			type: config.type,
			status: "running",
			code: null,
			startedAt: Date.now(),
			url: null,
			output: [],
			size: 0,
			process: null,
			children: [],
			stopped: false,
			watch: null,
			parent: parent?.id ?? null,
		};
		sessions.push(session);
		while (sessions.length > MAX_SESSIONS) {
			const old = sessions.findIndex((each) => each.status !== "running");
			if (old === -1) break;
			sessions.splice(old, 1);
		}
		if (parent !== null) parent.children.push(session);
		publish(session);
		await refreshStatus();
		void execute(session, config).catch((error) => {
			append(session, "system", `\n${error.message}\n`);
			finish(session, -1);
		});
		return session;
	}

	function finish(session, code) {
		if (session.status !== "running") return;
		session.status = session.stopped ? "stopped" : code === 0 ? "done" : "failed";
		session.code = code;
		session.process = null;
		append(session, "system", `\n${t("Process finished with exit code {0}", code)}\n`);
		publish(session);
		void refreshStatus();
	}

	async function execute(session, config) {
		const type = TYPES[config.type];
		if (config.type === "compound") {
			for (const name of config.configurations ?? []) await start(name, session);
			append(session, "system", `${t("Started: {0}", (config.configurations ?? []).join(", "))}\n`);
			await Promise.all(
				session.children.map(
					(child) =>
						new Promise((resolve) => {
							const check = setInterval(() => {
								if (child.status !== "running") {
									clearInterval(check);
									resolve();
								}
							}, 300);
						}),
				),
			);
			finish(session, session.children.every((child) => child.code === 0) ? 0 : 1);
			return;
		}

		for (const before of config.beforeLaunch ?? []) {
			append(session, "system", `${t("Before launch: {0}", before)}\n`);
			const child = await start(before, session);
			const code = await new Promise((resolve) => {
				const check = setInterval(() => {
					if (child.status !== "running" || session.stopped) {
						clearInterval(check);
						resolve(child.code);
					}
				}, 200);
			});
			if (session.stopped) return finish(session, -1);
			if (code !== 0) {
				append(
					session,
					"system",
					`${t('"{0}" failed (exit code {1}): {2} is not run.', before, code, config.name)}\n`,
				);
				return finish(session, code ?? -1);
			}
		}

		const ctx = { folder, platform, paths, fs: kalem.fs, t };
		const spec = await type.build(config, ctx, config.name);
		const cwd = paths.resolve(folder, config.workingDir);
		const env = { ...(spec.env ?? {}), ...parseEnv(config.env) };

		for (const step of spec.steps ?? []) {
			append(session, "system", `${step.title}\n`);
			const code = await runProgram(session, { ...step, env }, step.cwd ?? cwd);
			if (session.stopped) return finish(session, -1);
			if (code !== 0) return finish(session, code);
			await step.after?.();
		}
		if (spec.prepare) await spec.prepare();
		if (session.stopped) return finish(session, -1);

		const args = typeof spec.args === "function" ? spec.args() : (spec.args ?? []);
		append(session, "system", `${[spec.command, ...args].map(quote).join(" ")}\n\n`);
		let ready = spec.ready === undefined;
		let seen = "";
		session.watch = (text) => {
			seen = (seen + text.replace(ANSI, "")).slice(-4000);
			if (!ready && spec.ready.test(seen)) ready = true;
			if (!ready || session.url !== null || !spec.openUrl) return;
			const url = spec.openUrl === "detect" ? localUrlIn(seen) : spec.openUrl;
			if (url === null) return;
			session.url = url;
			publish(session);
			void kalem.ui.openExternal(url).catch(() => {});
		};
		const code = await runProgram(session, { ...spec, args, env }, cwd);
		finish(session, code);
	}

	const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

	async function stop(id) {
		const session = sessions.find((each) => each.id === id);
		if (session === undefined || session.status !== "running") return;
		session.stopped = true;
		for (const child of session.children) await stop(child.id);
		if (session.process !== null) await kalem.process.kill(session.process);
		else if (session.type === "compound") finish(session, -1);
	}

	async function stopByName(name) {
		const session = running(name);
		if (session === undefined) throw new Error(`${name} is not running.`);
		await stop(session.id);
	}

	async function state() {
		await load();
		return {
			folder,
			platform,
			configurations,
			selected,
			types: typeSchemas(),
			sessions: sessions.map(summary),
		};
	}

	await load();
	await refreshStatus();

	await kalem.ui.handle("state", state);
	await kalem.ui.handle("save", async (input) => {
		await save(Array.isArray(input?.configurations) ? input.configurations : []);
		if (typeof input?.selected === "string") selected = input.selected;
		await refreshStatus();
		return state();
	});
	await kalem.ui.handle("select", async (name) => {
		selected = typeof name === "string" ? name : selected;
		await refreshStatus();
		return null;
	});
	await kalem.ui.handle("run", async (name) => summary(await start(String(name ?? selected))));
	await kalem.ui.handle("stop", (id) => stop(String(id)));
	await kalem.ui.handle("output", (id) => sessions.find((each) => each.id === id)?.output ?? []);
	await kalem.ui.handle("forget", (id) => {
		const at = sessions.findIndex((each) => each.id === id && each.status !== "running");
		if (at !== -1) sessions.splice(at, 1);
		return null;
	});
	await kalem.ui.handle("pick", (input) => kalem.ui.pickPath(input ?? {}));
	await kalem.ui.handle("scripts", async (input) => {
		const cwd = paths.resolve(folder ?? "", input?.workingDir);
		const file = paths.join(cwd, "package.json");
		if (!(await kalem.fs.exists(file))) return [];
		try {
			return Object.keys(JSON.parse(await kalem.fs.readText(file)).scripts ?? {});
		} catch {
			return [];
		}
	});

	await kalem.commands.register("run", async () => {
		await load();
		if (selected === null) {
			await kalem.ui.showPane("run");
			await kalem.ui.post({ type: "edit" });
			return;
		}
		await kalem.ui.showPane("run");
		await start(selected);
	});
	await kalem.commands.register("stop", async () => {
		const session = selected === null ? undefined : running(selected);
		if (session !== undefined) await stop(session.id);
	});
	await kalem.commands.register("edit", async () => {
		await kalem.ui.showPane("run");
		await kalem.ui.post({ type: "edit" });
	});

	const lastLines = (session, count) => {
		const text = session.output
			.map((each) => each.text)
			.join("")
			.replace(ANSI, "");
		return text.split("\n").slice(-count).join("\n");
	};

	await kalem.assistant.registerTool(
		{
			name: "run_configurations",
			description:
				"Lists the open folder's run configurations (Tomcat, Java, Maven, Gradle, npm, commands) and what is running now.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		async () => {
			await load();
			if (folder === null) return "No folder is open.";
			if (configurations.length === 0) return "The folder has no run configurations.";
			return configurations
				.map((config) => {
					const session = [...sessions].reverse().find((each) => each.name === config.name);
					const state =
						session === undefined
							? "not run"
							: session.status === "running"
								? "running"
								: `${session.status} (exit code ${session.code})`;
					return `- ${config.name} [${TYPES[config.type].title}]: ${state}`;
				})
				.join("\n");
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "run_configuration_start",
			description:
				"Runs one of the folder's run configurations by its name (stopping it first if it runs). The user is asked first.",
			parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
			writes: true,
		},
		async (input) => {
			const session = await start(String(input?.name ?? ""));
			await new Promise((resolve) => setTimeout(resolve, 3000));
			return `${session.name}: ${session.status}.\n${lastLines(session, 40)}`;
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "run_configuration_stop",
			description: "Stops a running run configuration by its name. The user is asked first.",
			parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
			writes: true,
		},
		async (input) => {
			await stopByName(String(input?.name ?? ""));
			return `Stopped ${input.name}.`;
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "run_configuration_output",
			description:
				"Returns the last lines a run configuration printed in its latest run (errors, stack traces, startup logs), to see why it failed.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					lines: {
						type: "integer",
						description: "How many of the last lines (default 200, at most 2000).",
					},
				},
				required: ["name"],
			},
		},
		async (input) => {
			const session = [...sessions].reverse().find((each) => each.name === input?.name);
			if (session === undefined) return `${input?.name} has not been run since Kalem started.`;
			const count = Math.min(Math.max(Number(input?.lines) || 200, 1), 2000);
			return `${session.name}: ${session.status}${session.code === null ? "" : ` (exit code ${session.code})`}\n${lastLines(session, count)}`;
		},
	);
}
