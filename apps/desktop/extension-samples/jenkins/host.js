import { createClient } from "./client.js";
import { translator } from "./i18n.js";
import { jobLabel, parseJobPath } from "./params.js";
import { groupChain, resolveParams, targetsInSubtree } from "./resolve.js";
import { createRunner, isFinal } from "./runner.js";
import { emptyConfig, importSummary, normalizeConfig } from "./store.js";

const MAX_HISTORY = 200;
const MAX_LOG_LINES = 400;

export async function activate(kalem) {
	const t = translator(kalem.language);
	let config = normalizeConfig((await kalem.storage.get("config")) ?? emptyConfig());
	let history = (await kalem.storage.get("history")) ?? [];
	let settings = await kalem.settings.all();

	const refreshSettings = async () => {
		settings = await kalem.settings.all();
		return settings;
	};
	const client = async () => {
		await refreshSettings();
		return createClient(kalem, {
			baseUrl: settings.url,
			username: settings.username,
			token: await kalem.secrets.get("token"),
			t,
		});
	};

	const saveConfig = async (next) => {
		config = normalizeConfig(next);
		await kalem.storage.set("config", config);
		return config;
	};

	const groupPath = (groupId) =>
		groupChain(groupId, config.groups)
			.reverse()
			.map((group) => group.name)
			.join(" / ");

	async function showActivity() {
		const active = runner.list().filter((run) => !isFinal(run.status)).length;
		await kalem.ui.setStatusItem(
			"runs",
			active === 0
				? null
				: { text: `Jenkins ▶ ${active}`, tooltip: t("Jenkins builds running"), command: "open" },
		);
	}

	const runner = createRunner({
		client,
		concurrency: () => Number(settings.concurrency) || 2,
		pollMs: () => Math.max(500, (Number(settings.pollSeconds) || 2) * 1000),
		onUpdate: (run) => {
			void kalem.ui.post({ type: "run", run });
			void showActivity();
		},
		onFinished: async (run) => {
			history = [run, ...history.filter((each) => each.id !== run.id)].slice(0, MAX_HISTORY);
			await kalem.storage.set("history", history);
		},
	});

	/** What would run: for each target its resolved parameters, and what could not be resolved. */
	function plan({ targetIds = [], groupId = null, actionId = null, overrides = {} }) {
		const action = actionId ? config.quickActions.find((each) => each.id === actionId) : undefined;
		const targets = groupId
			? targetsInSubtree(groupId, config.groups, config.targets)
			: config.targets.filter((target) => targetIds.includes(target.id));
		return targets
			.filter((target) => action === undefined || target.pipelineId === action.pipelineId)
			.map((target) => {
				const pipeline = config.pipelines.find((each) => each.id === target.pipelineId);
				const resolved = resolveParams({
					pipeline,
					target,
					groups: config.groups,
					action,
					overrides,
				});
				return {
					target: { id: target.id, name: target.name, group: groupPath(target.groupId) },
					pipeline: { id: pipeline.id, name: pipeline.name, jobPath: pipeline.jobPath },
					action: action ? { id: action.id, name: action.name } : null,
					params: resolved.params.map(({ def, ...rest }) => ({
						...rest,
						type: def.type,
						sensitive: def.type === "password",
					})),
					values: resolved.values,
					warnings: resolved.warnings,
				};
			});
	}

	function run(input) {
		const planned = plan(input);
		return runner.enqueue(
			planned.map((item) => ({
				targetId: item.target.id,
				targetName: item.target.name,
				group: item.target.group,
				pipelineId: item.pipeline.id,
				pipelineName: item.pipeline.name,
				jobPath: item.pipeline.jobPath,
				actionId: item.action?.id,
				actionName: item.action?.name,
				params: item.values,
			})),
		);
	}

	function exportConfig() {
		return {
			version: 1,
			jenkins: {
				baseUrl: settings.url ?? "",
				username: settings.username ?? "",
				tls: { rejectUnauthorized: true },
			},
			...config,
			settings: {
				concurrency: Number(settings.concurrency) || 2,
				pollIntervalMs: (Number(settings.pollSeconds) || 2) * 1000,
				confirmBulk: settings.confirmBulk !== false,
				keepHistory: true,
			},
		};
	}

	const ui = (name, handler) => kalem.ui.handle(name, handler);
	await ui("state", async () => ({
		config,
		runs: runner.list(),
		history,
		settings: {
			...(await refreshSettings()),
			hasToken: (await kalem.secrets.get("token")) !== null,
		},
	}));
	await ui("saveConfig", (next) => saveConfig(next));
	await ui("test", async () => (await client()).test());
	await ui("fetchJob", async (input) => (await client()).job(String(input)));
	await ui("plan", (input) => plan(input ?? {}));
	await ui("run", (input) => run(input ?? {}));
	await ui("runJob", async (input) => {
		const jobPath = parseJobPath(String(input?.jobPath ?? ""), settings.url ?? "");
		return runner.enqueue([
			{
				targetId: null,
				targetName: jobLabel(jobPath),
				group: "",
				pipelineId: null,
				pipelineName: jobLabel(jobPath),
				jobPath,
				params: input?.params ?? {},
			},
		]);
	});
	await ui("stop", (id) => runner.stop(String(id)));
	await ui("clearFinished", () => {
		runner.clearFinished();
		return runner.list();
	});
	await ui("clearHistory", async () => {
		history = [];
		await kalem.storage.set("history", []);
		return history;
	});
	await ui("console", async (input) =>
		(await client()).consoleFrom(String(input?.buildUrl), Number(input?.start) || 0),
	);
	await ui("jobs", async (folder) => (await client()).jobs(folder ? String(folder) : ""));
	await ui("builds", async (jobPath) => (await client()).builds(String(jobPath)));
	await ui("stages", async (buildUrl) => (await client()).stages(String(buildUrl)));
	await ui("export", () => JSON.stringify(exportConfig(), null, 2));
	await ui("import", async (input) => {
		let raw;
		try {
			raw = JSON.parse(String(input?.text ?? ""));
		} catch {
			throw new Error(t("This is not a QuickPipeline config.json (not JSON)."));
		}
		const incoming = normalizeConfig(raw);
		if (incoming.pipelines.length === 0 && incoming.groups.length === 0)
			throw new Error(t("There is nothing to import in this file."));
		const merged =
			input?.mode === "merge"
				? {
						pipelines: [
							...config.pipelines.filter(
								(each) => !incoming.pipelines.some((other) => other.id === each.id),
							),
							...incoming.pipelines,
						],
						groups: [
							...config.groups.filter(
								(each) => !incoming.groups.some((other) => other.id === each.id),
							),
							...incoming.groups,
						],
						targets: [
							...config.targets.filter(
								(each) => !incoming.targets.some((other) => other.id === each.id),
							),
							...incoming.targets,
						],
						quickActions: [
							...config.quickActions.filter(
								(each) => !incoming.quickActions.some((other) => other.id === each.id),
							),
							...incoming.quickActions,
						],
					}
				: incoming;
		await saveConfig(merged);
		return {
			config,
			summary: importSummary(raw),
			counts: {
				pipelines: incoming.pipelines.length,
				groups: incoming.groups.length,
				targets: incoming.targets.length,
				actions: incoming.quickActions.length,
			},
		};
	});
	await kalem.commands.register("open", () => kalem.ui.showPane("jenkins"));
	await showActivity();

	// --- The assistant's tools ------------------------------------------------------------

	const findGroup = (name) => {
		const wanted = String(name ?? "").trim();
		return (
			config.groups.find((group) => group.name === wanted || groupPath(group.id) === wanted) ?? null
		);
	};

	await kalem.assistant.registerTool(
		{
			name: "jenkins_targets",
			description:
				"Lists the Jenkins extension's groups (environments) with their targets (applications), each target's pipeline, and the quick actions (Start, Stop, Restart…) each pipeline offers.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		() => {
			const lines = [];
			for (const group of config.groups) {
				const targets = config.targets.filter((target) => target.groupId === group.id);
				lines.push(`${groupPath(group.id)}${targets.length ? "" : " (no targets)"}`);
				for (const target of targets) {
					const pipeline = config.pipelines.find((each) => each.id === target.pipelineId);
					lines.push(`  - ${target.name} [${pipeline?.name}]`);
				}
			}
			const actions = config.pipelines.map(
				(pipeline) =>
					`${pipeline.name} (${jobLabel(pipeline.jobPath)}): ${
						config.quickActions
							.filter((action) => action.pipelineId === pipeline.id)
							.map((action) => action.name)
							.join(", ") || "no quick actions"
					}`,
			);
			return `Groups and targets:\n${lines.join("\n") || "(none)"}\n\nPipelines and quick actions:\n${actions.join("\n") || "(none)"}`;
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "jenkins_run_action",
			description:
				"Runs a quick action (e.g. Restart) on targets in Jenkins: on one target, or on every target under a group. Returns the builds queued. The user is asked first.",
			parameters: {
				type: "object",
				properties: {
					action: { type: "string", description: "The quick action's name, e.g. Restart." },
					group: {
						type: "string",
						description: "A group's name or path (Test / CRM): every target under it.",
					},
					target: {
						type: "string",
						description: "A target's name, to run on it alone (with group, the one in that group).",
					},
				},
				required: ["action"],
			},
			writes: true,
		},
		(input) => {
			const group = input?.group ? findGroup(input.group) : null;
			if (input?.group && group === null) return `There is no group named "${input.group}".`;
			const scope = group
				? targetsInSubtree(group.id, config.groups, config.targets)
				: config.targets;
			const targets = input?.target
				? scope.filter((target) => target.name === input.target)
				: scope;
			if (targets.length === 0) return "No target matches.";
			const runs = [];
			for (const target of targets) {
				const action = config.quickActions.find(
					(each) => each.name === input.action && each.pipelineId === target.pipelineId,
				);
				if (action === undefined) continue;
				runs.push(...run({ targetIds: [target.id], actionId: action.id }));
			}
			if (runs.length === 0) return `No target there has a quick action named "${input.action}".`;
			return `Queued ${runs.length} build(s):\n${runs.map((each) => `- ${each.group} / ${each.targetName}: ${each.actionName} → ${jobLabel(each.jobPath)}`).join("\n")}\nCall jenkins_runs to follow them.`;
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "jenkins_runs",
			description:
				"The builds started from Kalem: queued, running and recently finished, with their result, build number and duration.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		() => {
			const all = [...runner.list(), ...history.filter((each) => !runner.get(each.id))].slice(
				0,
				30,
			);
			if (all.length === 0) return "No builds were started from Kalem yet.";
			return all
				.map(
					(each) =>
						`- ${each.group ? `${each.group} / ` : ""}${each.targetName}${each.actionName ? ` · ${each.actionName}` : ""}: ${each.status}${each.buildNumber ? ` #${each.buildNumber}` : ""}${each.durationMs ? ` in ${Math.round(each.durationMs / 1000)} s` : ""}${each.error ? ` (${each.error})` : ""}${each.buildUrl ? ` ${each.buildUrl}` : ""}`,
				)
				.join("\n");
		},
	);

	const buildOf = async (jenkins, input) => {
		const jobPath = parseJobPath(String(input?.job ?? ""), jenkins.base);
		const which = String(input?.build ?? "lastBuild");
		const name = /^\d+$/.test(which)
			? which
			: ({
					last: "lastBuild",
					lastFailed: "lastFailedBuild",
					lastSuccessful: "lastSuccessfulBuild",
				}[which] ?? "lastBuild");
		return { jobPath, url: `${jenkins.base}/${jobPath}/${name}/` };
	};

	await kalem.assistant.registerTool(
		{
			name: "jenkins_build_log",
			description:
				"Reads the end of a Jenkins build's console log, to see why it failed: by job (its address or Folder/job) and build (a number, last, lastFailed or lastSuccessful).",
			parameters: {
				type: "object",
				properties: {
					job: { type: "string" },
					build: {
						type: "string",
						description: "A number, last (default), lastFailed or lastSuccessful.",
					},
					lines: {
						type: "integer",
						description: `How many of the last lines (default 200, at most ${MAX_LOG_LINES}).`,
					},
				},
				required: ["job"],
			},
		},
		async (input) => {
			const jenkins = await client();
			const { url } = await buildOf(jenkins, input);
			const info = await jenkins.build(url);
			const count = Math.min(Math.max(Number(input?.lines) || 200, 10), MAX_LOG_LINES);
			const log = (await jenkins.consoleTail(info.url ?? url, 60_000))
				.split("\n")
				.slice(-count)
				.join("\n");
			const stages = await jenkins.stages(info.url ?? url).catch(() => null);
			const stageLine = stages
				? `\nStages: ${stages.map((stage) => `${stage.name}=${stage.status}`).join(", ")}`
				: "";
			return `${info.displayName ?? `#${info.number}`}: ${info.building ? "BUILDING" : info.result} (${Math.round((info.duration || 0) / 1000)} s)${stageLine}\n\n${log}`;
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "jenkins_job_status",
			description:
				"A Jenkins job's recent builds (result, number, when, how long), or the jobs of a folder with their state when the path is a folder or empty.",
			parameters: {
				type: "object",
				properties: {
					job: { type: "string", description: "A job or folder; empty for the top level." },
				},
				required: [],
			},
		},
		async (input) => {
			const jenkins = await client();
			const path = input?.job ? parseJobPath(String(input.job), jenkins.base) : "";
			const builds = path ? await jenkins.builds(path).catch(() => null) : null;
			if (builds !== null && builds.length > 0) {
				return builds
					.slice(0, 15)
					.map(
						(build) =>
							`#${build.number} ${build.building ? "BUILDING" : build.result} ${new Date(build.timestamp).toISOString()} (${Math.round(build.duration / 1000)} s)`,
					)
					.join("\n");
			}
			const jobs = await jenkins.jobs(path);
			return jobs
				.map(
					(job) =>
						`- ${job.name}${job.folder ? "/" : ""}: ${job.folder ? "folder" : job.lastBuild ? `#${job.lastBuild.number} ${job.lastBuild.building ? "BUILDING" : job.lastBuild.result}` : "never built"}`,
				)
				.join("\n");
		},
	);
}
