/** Jenkins' REST API through Kalem (its proxy, the allowed address), with the user's API token. */
import { mapParameterDefinitions, parseJobPath, stripHtml } from "./params.js";

export class JenkinsError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

export function createClient(kalem, { baseUrl, username, token, t }) {
	const base = String(baseUrl ?? "")
		.trim()
		.replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(base))
		throw new JenkinsError(
			t("Set Jenkins' address (http:// or https://) in Settings › Extensions › Jenkins."),
		);
	if (!token)
		throw new JenkinsError(t("Save your Jenkins API token in Settings › Extensions › Jenkins."));
	const bytes = new TextEncoder().encode(`${username}:${token}`);
	const auth = `Basic ${btoa(String.fromCharCode(...bytes))}`;
	const url = (path) =>
		/^https?:\/\//i.test(path) ? path : `${base}/${String(path).replace(/^\/+/, "")}`;

	async function request(
		path,
		{ method = "GET", body = null, headers = {}, accept = "application/json" } = {},
	) {
		const target = url(path);
		const response = await kalem.http.fetch(target, {
			method,
			body,
			headers: { Authorization: auth, Accept: accept, ...headers },
			timeoutMs: 30_000,
		});
		if (response.status === 401)
			throw new JenkinsError(t("Jenkins did not accept the user or token (401)."), 401);
		if (response.status === 403)
			throw new JenkinsError(t("No permission for this in Jenkins (403)."), 403);
		if (response.status === 404) throw new JenkinsError(`${t("Not found (404)")}: ${target}`, 404);
		if (response.status >= 400) {
			throw new JenkinsError(
				`Jenkins ${response.status}: ${stripHtml(response.body).slice(0, 300)}`,
				response.status,
			);
		}
		return response;
	}

	const json = async (path) => JSON.parse((await request(path)).body || "{}");
	const slash = (address) => `${String(address).replace(/\/+$/, "")}/`;

	return {
		base,
		async test() {
			const response = await request("api/json?tree=mode");
			let user = "";
			try {
				const me = await json("me/api/json?tree=id,fullName");
				user = me.fullName || me.id || "";
			} catch {
				// Anonymous read.
			}
			return { version: response.headers["x-jenkins"] ?? "", user };
		},
		async job(input) {
			const jobPath = parseJobPath(input, base);
			const tree =
				"name,fullName,description,url,property[parameterDefinitions[name,type,description,defaultParameterValue[value],choices]]";
			const data = await json(`${jobPath}/api/json?tree=${encodeURIComponent(tree)}`);
			return {
				name: data.name,
				fullName: data.fullName ?? data.name,
				description: data.description ? stripHtml(data.description) : "",
				url: data.url,
				jobPath,
				parameters: mapParameterDefinitions(data.property),
			};
		},
		async trigger(jobPath, params) {
			const hasParams = Object.keys(params).length > 0;
			const response = await request(`${jobPath}/${hasParams ? "buildWithParameters" : "build"}`, {
				method: "POST",
				body: new URLSearchParams(params).toString(),
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			});
			const location = response.headers.location;
			if (!location)
				throw new JenkinsError(
					t("Jenkins did not say where the build was queued; it may have started."),
				);
			return slash(location);
		},
		queueItem: (queueUrl) =>
			json(`${slash(queueUrl)}api/json?tree=cancelled,why,executable[number,url]`),
		build: (buildUrl) =>
			json(
				`${slash(buildUrl)}api/json?tree=number,url,building,result,duration,estimatedDuration,timestamp,displayName,description`,
			),
		async consoleFrom(buildUrl, start = 0) {
			const response = await request(`${slash(buildUrl)}logText/progressiveText?start=${start}`, {
				accept: "text/plain",
			});
			return {
				text: response.body,
				next: Number(response.headers["x-text-size"] ?? start + response.body.length),
				more: response.headers["x-more-data"] === "true",
			};
		},
		async consoleTail(buildUrl, chars = 20_000) {
			const text = (await request(`${slash(buildUrl)}consoleText`, { accept: "text/plain" })).body;
			return text.length > chars ? text.slice(-chars) : text;
		},
		stop: (buildUrl) => request(`${slash(buildUrl)}stop`, { method: "POST" }),
		async cancelQueue(queueUrl) {
			const match = /\/queue\/item\/(\d+)/.exec(queueUrl);
			if (match) await request(`queue/cancelItem?id=${match[1]}`, { method: "POST" });
		},
		async jobs(folderPath = "") {
			const tree =
				"jobs[name,url,color,_class,description,lastBuild[number,result,timestamp,duration,building]]";
			const data = await json(
				`${folderPath ? `${folderPath}/` : ""}api/json?tree=${encodeURIComponent(tree)}`,
			);
			return (data.jobs ?? []).map((job) => ({
				name: job.name,
				url: job.url,
				color: job.color ?? "",
				folder: /folder|multibranch|organization/i.test(job._class ?? "") && !job.color,
				jobPath: `${folderPath ? `${folderPath}/` : ""}job/${encodeURIComponent(job.name)}`,
				lastBuild: job.lastBuild ?? null,
			}));
		},
		async builds(jobPath) {
			const tree = "builds[number,url,result,timestamp,duration,building,estimatedDuration]{0,25}";
			return (await json(`${jobPath}/api/json?tree=${encodeURIComponent(tree)}`)).builds ?? [];
		},
		async stages(buildUrl) {
			try {
				const data = await json(`${slash(buildUrl)}wfapi/describe`);
				return (data.stages ?? []).map((stage) => ({
					name: stage.name,
					status: stage.status,
					durationMillis: stage.durationMillis,
				}));
			} catch (error) {
				if (error.status === 404) return null;
				throw error;
			}
		},
	};
}
