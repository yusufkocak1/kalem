/**
 * QuickPipeline's parameter resolution: a value comes from, in order, this
 * run, the quick action, the target, the nearest group up the tree, the
 * pipeline's default. `${name}` in values is resolved by the same chain;
 * `${target.name}`, `${group.name}`, `${pipeline.name}`, `${action.name}` are built in. Pure.
 */

const PLACEHOLDER = /\$\{([a-zA-Z0-9_.-]+)\}/g;

/** The group and its parents up to the root, the nearest first. */
export function groupChain(groupId, groups) {
	const byId = new Map(groups.map((group) => [group.id, group]));
	const chain = [];
	const seen = new Set();
	let current = groupId ? byId.get(groupId) : undefined;
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		chain.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return chain;
}

/** A group's own variables and those it inherits. */
export function effectiveVariables(groupId, groups) {
	const result = new Map();
	for (const group of [...groupChain(groupId, groups)].reverse()) {
		for (const [name, value] of Object.entries(group.variables ?? {})) {
			result.set(name, {
				name,
				value,
				groupId: group.id,
				groupName: group.name,
				inherited: group.id !== groupId,
			});
		}
	}
	return [...result.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The group and every group under it, depth first. */
export function descendantGroupIds(groupId, groups) {
	const children = new Map();
	for (const group of groups) {
		const list = children.get(group.parentId ?? null) ?? [];
		list.push(group);
		children.set(group.parentId ?? null, list);
	}
	for (const list of children.values()) list.sort((a, b) => a.order - b.order);
	const out = [];
	const visit = (id) => {
		if (out.includes(id)) return;
		out.push(id);
		for (const child of children.get(id) ?? []) visit(child.id);
	};
	visit(groupId);
	return out;
}

/** Every target under a group, in the tree's order. */
export function targetsInSubtree(groupId, groups, targets) {
	const ids = descendantGroupIds(groupId, groups);
	const rank = new Map(ids.map((id, index) => [id, index]));
	return targets
		.filter((target) => rank.has(target.groupId))
		.sort((a, b) => rank.get(a.groupId) - rank.get(b.groupId) || a.order - b.order);
}

export function resolveParams({ pipeline, target, groups, action, overrides }) {
	const chain = groupChain(target.groupId, groups);
	const defs = new Map(pipeline.parameters.map((param) => [param.name, param]));
	const builtins = {
		"target.name": target.name,
		"pipeline.name": pipeline.name,
		"group.name": chain[0]?.name ?? "",
		"action.name": action?.name ?? "",
	};
	const lookup = (name) => {
		if (overrides && Object.hasOwn(overrides, name))
			return { raw: overrides[name], source: { kind: "override" } };
		if (action && Object.hasOwn(action.params, name)) {
			return { raw: action.params[name], source: { kind: "action", actionName: action.name } };
		}
		if (Object.hasOwn(target.params, name))
			return { raw: target.params[name], source: { kind: "target" } };
		for (const group of chain) {
			if (Object.hasOwn(group.variables ?? {}, name)) {
				return { raw: group.variables[name], source: { kind: "group", groupName: group.name } };
			}
		}
		const def = defs.get(name);
		if (def?.defaultValue !== undefined)
			return { raw: def.defaultValue, source: { kind: "default" } };
		return undefined;
	};
	const warnings = new Set();
	const interpolate = (raw, stack) =>
		String(raw).replace(PLACEHOLDER, (match, key) => {
			if (Object.hasOwn(builtins, key)) return builtins[key];
			if (stack.includes(key)) {
				warnings.add(`cycle: ${[...stack, key].join(" → ")}`);
				return match;
			}
			const found = lookup(key);
			if (!found) {
				warnings.add(`unresolved: \${${key}}`);
				return match;
			}
			return interpolate(found.raw, [...stack, key]);
		});
	const params = pipeline.parameters.map((def) => {
		const found = lookup(def.name);
		const rawValue = found?.raw ?? "";
		return {
			name: def.name,
			value: interpolate(rawValue, [def.name]),
			rawValue,
			source: found?.source ?? { kind: "empty" },
			def,
		};
	});
	const values = {};
	for (const param of params) values[param.name] = param.value;
	return { params, warnings: [...warnings], values };
}
