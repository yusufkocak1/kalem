/** The configuration as QuickPipeline keeps it (pipelines, groups, targets, quick actions), checked as it is read. */

const text = (value) =>
	typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
const record = (value) =>
	Object.fromEntries(
		Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {}).map(
			([key, item]) => [key, text(item)],
		),
	);
const list = (value) =>
	Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
const COLORS = ["default", "primary", "info", "success", "warning", "error"];

export const emptyConfig = () => ({ pipelines: [], groups: [], targets: [], quickActions: [] });

function param(raw) {
	return {
		name: text(raw.name),
		type: ["string", "text", "choice", "boolean", "password", "unknown"].includes(raw.type)
			? raw.type
			: "string",
		...(raw.description ? { description: text(raw.description) } : {}),
		...(raw.defaultValue !== undefined ? { defaultValue: text(raw.defaultValue) } : {}),
		...(Array.isArray(raw.choices) ? { choices: raw.choices.map(text) } : {}),
		rawClass: text(raw.rawClass),
	};
}

/** A configuration from the extension's storage, or from QuickPipeline's config.json. */
export function normalizeConfig(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	const pipelines = list(source.pipelines)
		.filter((item) => item.id && item.jobPath)
		.map((item) => ({
			id: text(item.id),
			name: text(item.name) || text(item.jobPath),
			jobPath: text(item.jobPath),
			description: text(item.description),
			parameters: list(item.parameters)
				.filter((p) => p.name)
				.map(param),
			originalParameters: list(item.originalParameters ?? item.parameters)
				.filter((p) => p.name)
				.map(param),
			syncedAt: item.syncedAt ? text(item.syncedAt) : undefined,
		}));
	const pipelineIds = new Set(pipelines.map((item) => item.id));
	const groups = list(source.groups)
		.filter((item) => item.id)
		.map((item, index) => ({
			id: text(item.id),
			name: text(item.name) || "?",
			parentId: item.parentId ? text(item.parentId) : null,
			variables: record(item.variables),
			order: Number.isFinite(item.order) ? item.order : index,
		}));
	const groupIds = new Set(groups.map((item) => item.id));
	for (const group of groups)
		if (group.parentId && !groupIds.has(group.parentId)) group.parentId = null;
	const targets = list(source.targets)
		.filter((item) => item.id && groupIds.has(item.groupId) && pipelineIds.has(item.pipelineId))
		.map((item, index) => ({
			id: text(item.id),
			name: text(item.name) || "?",
			groupId: text(item.groupId),
			pipelineId: text(item.pipelineId),
			params: record(item.params),
			order: Number.isFinite(item.order) ? item.order : index,
		}));
	const quickActions = list(source.quickActions)
		.filter((item) => item.id && pipelineIds.has(item.pipelineId))
		.map((item, index) => ({
			id: text(item.id),
			name: text(item.name) || "?",
			pipelineId: text(item.pipelineId),
			params: record(item.params),
			confirm: item.confirm === true,
			color: COLORS.includes(item.color) ? item.color : "default",
			order: Number.isFinite(item.order) ? item.order : index,
		}));
	return { pipelines, groups, targets, quickActions };
}

/** What a QuickPipeline config.json brings besides the tree: its Jenkins address and user, and settings. */
export function importSummary(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	return {
		baseUrl: text(source.jenkins?.baseUrl),
		username: text(source.jenkins?.username),
		concurrency: Number(source.settings?.concurrency) || null,
	};
}
