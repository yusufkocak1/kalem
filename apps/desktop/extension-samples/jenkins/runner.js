/** QuickPipeline's build queue: runs start up to the concurrency, each watched from queue to result. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const QUEUE_TIMEOUT_MS = 30 * 60 * 1000;
const BUILD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
export const FINAL = [
	"SUCCESS",
	"FAILURE",
	"ABORTED",
	"UNSTABLE",
	"NOT_BUILT",
	"CANCELLED",
	"ERROR",
];
export const isFinal = (status) => FINAL.includes(status);

let counter = 0;
export const newId = (prefix) =>
	`${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createRunner({ client, concurrency, pollMs, onUpdate, onFinished }) {
	const runs = new Map();
	const inflight = new Set();
	let active = 0;

	const update = (run, patch) => {
		Object.assign(run, patch);
		onUpdate({ ...run });
		if (isFinal(run.status)) onFinished?.({ ...run });
	};

	const pump = () => {
		while (active < Math.max(1, concurrency())) {
			const next = [...runs.values()].find(
				(run) => run.status === "pending" && !inflight.has(run.id),
			);
			if (!next) break;
			active++;
			inflight.add(next.id);
			void execute(next).finally(() => {
				inflight.delete(next.id);
				active--;
				pump();
			});
		}
	};

	async function execute(run) {
		let jenkins;
		try {
			jenkins = await client();
		} catch (error) {
			update(run, { status: "ERROR", error: error.message, finishedAt: new Date().toISOString() });
			return;
		}
		try {
			update(run, { startedAt: new Date().toISOString() });
			const queueUrl = await jenkins.trigger(run.jobPath, run.params);
			update(run, { status: "queued", queueUrl });
			const queued = Date.now();
			let buildUrl;
			while (!buildUrl) {
				if (run.status === "CANCELLED") return;
				await sleep(Math.min(pollMs(), 2000));
				const item = await jenkins.queueItem(queueUrl);
				if (item.cancelled) {
					update(run, { status: "CANCELLED", finishedAt: new Date().toISOString() });
					return;
				}
				if (item.executable) {
					buildUrl = item.executable.url;
					update(run, { status: "running", buildNumber: item.executable.number, buildUrl });
				} else {
					if (item.why && item.why !== run.why) update(run, { why: item.why });
					if (Date.now() - queued > QUEUE_TIMEOUT_MS)
						throw new Error(`Waited too long in the queue${item.why ? `: ${item.why}` : ""}`);
				}
			}
			const started = Date.now();
			while (true) {
				await sleep(pollMs());
				const info = await jenkins.build(buildUrl);
				if (!info.building) {
					update(run, {
						status: info.result ?? "ERROR",
						durationMs: info.duration,
						estimatedDurationMs: info.estimatedDuration,
						finishedAt: new Date().toISOString(),
					});
					return;
				}
				if (info.estimatedDuration !== run.estimatedDurationMs)
					update(run, { estimatedDurationMs: info.estimatedDuration });
				if (Date.now() - started > BUILD_TIMEOUT_MS)
					throw new Error("Watching the build timed out.");
			}
		} catch (error) {
			update(run, { status: "ERROR", error: error.message, finishedAt: new Date().toISOString() });
		}
	}

	return {
		list: () =>
			[...runs.values()]
				.map((run) => ({ ...run }))
				.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
		get: (id) => runs.get(id),
		enqueue(requests) {
			const batchId = newId("batch");
			const now = new Date().toISOString();
			const created = requests.map((request) => ({
				...request,
				id: newId("run"),
				batchId,
				status: "pending",
				createdAt: now,
			}));
			for (const run of created) {
				runs.set(run.id, run);
				onUpdate({ ...run });
			}
			pump();
			return created.map((run) => ({ ...run }));
		},
		async stop(id) {
			const run = runs.get(id);
			if (!run || isFinal(run.status)) return;
			if (run.status === "pending") {
				update(run, { status: "CANCELLED", finishedAt: new Date().toISOString() });
				return;
			}
			const jenkins = await client();
			if (run.status === "queued" && run.queueUrl) await jenkins.cancelQueue(run.queueUrl);
			else if (run.status === "running" && run.buildUrl) await jenkins.stop(run.buildUrl);
		},
		clearFinished() {
			for (const [id, run] of runs) if (isFinal(run.status)) runs.delete(id);
		},
	};
}
