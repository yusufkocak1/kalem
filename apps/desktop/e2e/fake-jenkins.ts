import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const JENKINS_USER = "demo";
export const JENKINS_TOKEN = "jk-token-123";

export interface Triggered {
	readonly job: string;
	readonly params: Record<string, string>;
	readonly number: number;
}

interface Build {
	readonly job: string;
	readonly number: number;
	readonly params: Record<string, string>;
	readonly started: number;
	readonly result: string;
	readonly log: string[];
	stopped: boolean;
}

const WL_PARAMS = [
	{
		_class: "hudson.model.ChoiceParameterDefinition",
		name: "action",
		description: "Uygulama üzerinde yapmak istediğiniz aksiyonu seçiniz.",
		defaultParameterValue: { value: "seçiniz" },
		choices: ["seçiniz", "Start", "Stop", "Restart", "Delete", "Fail"],
	},
	{
		_class: "hudson.model.StringParameterDefinition",
		name: "application_name",
		description: "Uygulamanın Weblogic konsoldaki ismini giriniz.",
		defaultParameterValue: { value: "" },
	},
	{
		_class: "hudson.model.StringParameterDefinition",
		name: "application_version",
		description: "(optional) Parantez içindeki versiyon.",
		defaultParameterValue: { value: "-" },
	},
	{
		_class: "hudson.model.StringParameterDefinition",
		name: "admin_url",
		description: "Weblogic konsol admin url giriniz.",
		defaultParameterValue: { value: "" },
	},
];

/** A small Jenkins: folder WL with two parameterized pipelines, a queue, builds that take `buildMs`, consoles and stages. */
export async function fakeJenkins(buildMs = 2500) {
	const triggered: Triggered[] = [];
	const builds: Build[] = [];
	const queue = new Map<number, { build: Build; at: number }>();
	let nextQueue = 100;
	let server: ReturnType<typeof createServer>;
	const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
	const jobs: Record<string, { description: string; params: typeof WL_PARAMS }> = {
		"WL/app-actions": {
			description:
				"Pipeline Weblogic Console Actions (Application <b>Start</b>, Stop, Restart and Delete)",
			params: WL_PARAMS,
		},
		"WL/datasource": { description: "Datasource reset", params: [] },
	};
	builds.push({
		job: "WL/datasource",
		number: 7,
		params: {},
		started: Date.now() - 3_600_000,
		result: "SUCCESS",
		log: ["Started by user demo", "Reset datasource jdbc/crm", "Finished: SUCCESS"],
		stopped: false,
	});
	const buildsOf = (job: string) =>
		builds.filter((build) => build.job === job).sort((a, b) => b.number - a.number);
	const building = (build: Build) => !build.stopped && Date.now() - build.started < buildMs;
	const resultOf = (build: Build) =>
		build.stopped ? "ABORTED" : building(build) ? null : build.result;
	const urlOf = (build: Build) =>
		`${base()}job/${build.job.split("/").join("/job/")}/${build.number}/`;
	const linesNow = (build: Build) => {
		const share = building(build)
			? Math.max(1, Math.floor(((Date.now() - build.started) / buildMs) * (build.log.length - 1)))
			: build.log.length;
		return `${build.log.slice(0, share).join("\n")}\n`;
	};
	const info = (build: Build) => ({
		_class: "org.jenkinsci.plugins.workflow.job.WorkflowRun",
		number: build.number,
		url: urlOf(build),
		building: building(build),
		result: resultOf(build),
		duration: building(build) ? 0 : buildMs,
		estimatedDuration: buildMs,
		timestamp: build.started,
		displayName: `#${build.number}`,
	});

	server = createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk) => {
			raw += chunk;
		});
		request.on("end", () => {
			const url = new URL(request.url ?? "/", "http://jenkins");
			const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
				response.writeHead(status, {
					"Content-Type":
						typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
					"X-Jenkins": "2.462.3",
					...headers,
				});
				response.end(typeof body === "string" ? body : JSON.stringify(body));
			};
			if (
				request.headers.authorization !==
				`Basic ${Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString("base64")}`
			) {
				return send(401, "Unauthorized");
			}
			const path = decodeURIComponent(url.pathname);
			if (path === "/api/json") {
				return send(200, {
					mode: "NORMAL",
					jobs: [
						{
							_class: "com.cloudbees.hudson.plugins.folder.Folder",
							name: "WL",
							url: `${base()}job/WL/`,
						},
					],
				});
			}
			if (path === "/me/api/json") return send(200, { id: "demo", fullName: "Demo User" });
			if (path === "/job/WL/api/json") {
				return send(200, {
					jobs: Object.keys(jobs).map((key) => {
						const last = buildsOf(key)[0];
						const name = key.split("/")[1] as string;
						return {
							_class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
							name,
							url: `${base()}job/WL/job/${name}/`,
							color: !last
								? "notbuilt"
								: building(last)
									? "blue_anime"
									: last.result === "SUCCESS"
										? "blue"
										: "red",
							lastBuild: last
								? {
										number: last.number,
										result: resultOf(last),
										timestamp: last.started,
										duration: buildMs,
										building: building(last),
									}
								: null,
						};
					}),
				});
			}
			const queueMatch = /^\/queue\/item\/(\d+)\/api\/json$/.exec(path);
			if (queueMatch) {
				const item = queue.get(Number(queueMatch[1]));
				if (!item) return send(404, "Not found");
				if (Date.now() - item.at < 400)
					return send(200, { why: "Waiting for next available executor" });
				return send(200, { executable: { number: item.build.number, url: urlOf(item.build) } });
			}
			const match = /^\/job\/WL\/job\/([^/]+)\/(.*)$/.exec(path);
			const job = match ? `WL/${match[1]}` : "";
			if (!match || !jobs[job]) return send(404, "Not found");
			const rest = match[2] as string;
			if (rest === "api/json") {
				if (url.searchParams.get("tree")?.startsWith("builds"))
					return send(200, { builds: buildsOf(job).map(info) });
				return send(200, {
					name: match[1],
					fullName: job,
					description: jobs[job].description,
					url: `${base()}job/WL/job/${match[1]}/`,
					property: [
						{
							_class: "hudson.model.ParametersDefinitionProperty",
							parameterDefinitions: jobs[job].params,
						},
					],
				});
			}
			if (request.method === "POST" && (rest === "buildWithParameters" || rest === "build")) {
				const params = Object.fromEntries(new URLSearchParams(raw));
				const number = (buildsOf(job)[0]?.number ?? 0) + 1;
				const fail = params.action === "Fail";
				const build: Build = {
					job,
					number,
					params,
					started: Date.now() + 400,
					result: fail ? "FAILURE" : "SUCCESS",
					log: [
						"Started by user Demo User",
						`[Pipeline] stage (Prepare)`,
						`Connecting to ${params.admin_url ?? "-"}`,
						`[Pipeline] stage (${params.action ?? "Build"})`,
						fail
							? `ERROR: ${params.application_name} could not be found on the server`
							: `${params.action ?? "Build"} ${params.application_name ?? ""} OK`,
						`Finished: ${fail ? "FAILURE" : "SUCCESS"}`,
					],
					stopped: false,
				};
				builds.push(build);
				triggered.push({ job, params, number });
				const id = nextQueue++;
				queue.set(id, { build, at: Date.now() });
				return send(201, "", { Location: `${base()}queue/item/${id}/` });
			}
			const buildMatch = /^(\d+|lastBuild|lastFailedBuild|lastSuccessfulBuild)\/(.*)$/.exec(rest);
			const wanted = buildMatch?.[1];
			const build = buildsOf(job).find((each) =>
				wanted === "lastBuild"
					? true
					: wanted === "lastFailedBuild"
						? resultOf(each) === "FAILURE"
						: wanted === "lastSuccessfulBuild"
							? resultOf(each) === "SUCCESS"
							: each.number === Number(wanted),
			);
			if (!build || !buildMatch) return send(404, "Not found");
			const what = buildMatch[2];
			if (what === "api/json") return send(200, info(build));
			if (what === "consoleText") return send(200, linesNow(build));
			if (what === "logText/progressiveText") {
				const text = linesNow(build);
				const start = Number(url.searchParams.get("start") ?? 0);
				return send(200, text.slice(start), {
					"X-Text-Size": String(text.length),
					...(building(build) ? { "X-More-Data": "true" } : {}),
				});
			}
			if (what === "wfapi/describe") {
				const done = !building(build);
				return send(200, {
					stages: [
						{ name: "Prepare", status: "SUCCESS", durationMillis: 310 },
						{
							name: build.params.action ?? "Build",
							status: done ? (resultOf(build) === "SUCCESS" ? "SUCCESS" : "FAILED") : "IN_PROGRESS",
							durationMillis: 1200,
						},
					],
				});
			}
			if (what === "stop" && request.method === "POST") {
				build.stopped = true;
				return send(200, "");
			}
			send(404, "Not found");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: base().replace(/\/$/, ""),
		triggered,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/** QuickPipeline's demo config.json, as a user would bring it. */
export function quickPipelineConfig(baseUrl: string) {
	const param = (name: string, type: string, defaultValue: string, choices?: string[]) => ({
		name,
		type,
		defaultValue,
		...(choices ? { choices } : {}),
		rawClass:
			type === "choice"
				? "hudson.model.ChoiceParameterDefinition"
				: "hudson.model.StringParameterDefinition",
	});
	const parameters = [
		param("action", "choice", "seçiniz", ["seçiniz", "Start", "Stop", "Restart", "Delete", "Fail"]),
		param("application_name", "string", ""),
		param("application_version", "string", "-"),
		param("admin_url", "string", ""),
	];
	return {
		version: 1,
		jenkins: { baseUrl, username: JENKINS_USER, tls: { rejectUnauthorized: true } },
		pipelines: [
			{
				id: "p_wlapp",
				name: "WL App Actions",
				jobPath: "job/WL/job/app-actions",
				description: "Weblogic actions",
				parameters,
				originalParameters: parameters,
			},
		],
		groups: [
			{
				id: "g_test",
				name: "Test Ortamı",
				parentId: null,
				variables: { admin_url: "t3://${host}:12000", host: "10.80.13.15" },
				order: 0,
			},
			{
				id: "g_crm",
				name: "CRM",
				parentId: "g_test",
				variables: { host: "10.80.13.21" },
				order: 0,
			},
			{ id: "g_bill", name: "Billing", parentId: "g_test", variables: {}, order: 1 },
			{
				id: "g_preprod",
				name: "Preprod",
				parentId: null,
				variables: { admin_url: "t3://10.51.38.121:12000" },
				order: 1,
			},
		],
		targets: [
			{
				id: "t1",
				name: "crm-web",
				groupId: "g_crm",
				pipelineId: "p_wlapp",
				params: { application_name: "${target.name}" },
				order: 0,
			},
			{
				id: "t2",
				name: "crm-api",
				groupId: "g_crm",
				pipelineId: "p_wlapp",
				params: { application_name: "${target.name}", application_version: "2.4" },
				order: 1,
			},
			{
				id: "t3",
				name: "billing-core",
				groupId: "g_bill",
				pipelineId: "p_wlapp",
				params: { application_name: "BillingCore" },
				order: 0,
			},
			{
				id: "t4",
				name: "crm-web",
				groupId: "g_preprod",
				pipelineId: "p_wlapp",
				params: { application_name: "crm-web" },
				order: 0,
			},
		],
		quickActions: [
			{
				id: "a_start",
				name: "Start",
				pipelineId: "p_wlapp",
				params: { action: "Start" },
				color: "success",
				order: 0,
			},
			{
				id: "a_stop",
				name: "Stop",
				pipelineId: "p_wlapp",
				params: { action: "Stop" },
				color: "warning",
				confirm: true,
				order: 1,
			},
			{
				id: "a_restart",
				name: "Restart",
				pipelineId: "p_wlapp",
				params: { action: "Restart" },
				color: "primary",
				order: 2,
			},
			{
				id: "a_fail",
				name: "Fail",
				pipelineId: "p_wlapp",
				params: { action: "Fail" },
				color: "error",
				order: 3,
			},
		],
		settings: { concurrency: 2, pollIntervalMs: 1000, confirmBulk: true, keepHistory: true },
	};
}
