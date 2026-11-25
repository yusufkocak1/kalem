/** WSDL 1.1: the services, their SOAP bindings and operations, and a sample request for each from the schema. */

const WSDL = "http://schemas.xmlsoap.org/wsdl/";
const SOAP11 = "http://schemas.xmlsoap.org/wsdl/soap/";
const SOAP12 = "http://schemas.xmlsoap.org/wsdl/soap12/";
const XSD = "http://www.w3.org/2001/XMLSchema";
export const ENVELOPE = {
	1.1: "http://schemas.xmlsoap.org/soap/envelope/",
	1.2: "http://www.w3.org/2003/05/soap-envelope",
};

const children = (node, ns, name) =>
	[...(node?.children ?? [])].filter(
		(child) => child.namespaceURI === ns && (name === undefined || child.localName === name),
	);
const child = (node, ns, name) => children(node, ns, name)[0];

/** `tns:Add` → { ns, name }, by the prefixes in scope at `node`. */
function qname(node, value) {
	if (!value) return null;
	const at = value.indexOf(":");
	const prefix = at === -1 ? null : value.slice(0, at);
	const name = at === -1 ? value : value.slice(at + 1);
	return { ns: node.lookupNamespaceURI(prefix) ?? "", name };
}

const key = (q) => (q === null ? "" : `{${q.ns}}${q.name}`);

/** Reads a WSDL and the schemas it imports (`load(url)` gives a document's text). */
export async function readWsdl(text, url, load) {
	const doc = parse(text, url);
	const definitions = doc.documentElement;
	if (definitions.namespaceURI !== WSDL || definitions.localName !== "definitions") {
		throw new Error("This is not a WSDL 1.1 document (wsdl:definitions).");
	}
	const schemas = [];
	const seen = new Set([url]);
	const addSchema = async (schema, base, depth) => {
		schemas.push(schema);
		if (depth > 3) return;
		for (const ref of [...children(schema, XSD, "import"), ...children(schema, XSD, "include")]) {
			const location = ref.getAttribute("schemaLocation");
			if (!location) continue;
			const target = new URL(location, base).toString();
			if (seen.has(target) || seen.size > 20) continue;
			seen.add(target);
			try {
				const imported = parse(await load(target), target).documentElement;
				if (imported.namespaceURI === XSD && imported.localName === "schema")
					await addSchema(imported, target, depth + 1);
			} catch {
				// A schema that cannot be read leaves its types as placeholders.
			}
		}
	};
	for (const types of children(definitions, WSDL, "types")) {
		for (const schema of children(types, XSD, "schema")) await addSchema(schema, url, 0);
	}
	for (const imported of children(definitions, WSDL, "import")) {
		const location = imported.getAttribute("location");
		if (!location) continue;
		const target = new URL(location, url).toString();
		if (seen.has(target)) continue;
		seen.add(target);
		const part = parse(await load(target), target).documentElement;
		if (part.namespaceURI === XSD) await addSchema(part, target, 1);
	}

	const index = { elements: new Map(), types: new Map(), schemas };
	for (const schema of schemas) {
		const tns = schema.getAttribute("targetNamespace") ?? "";
		const qualified = schema.getAttribute("elementFormDefault") === "qualified";
		for (const node of schema.children) {
			if (node.namespaceURI !== XSD) continue;
			const name = node.getAttribute("name");
			if (!name) continue;
			const entry = { node, ns: tns, qualified };
			if (node.localName === "element") index.elements.set(`{${tns}}${name}`, entry);
			if (node.localName === "complexType" || node.localName === "simpleType")
				index.types.set(`{${tns}}${name}`, entry);
		}
	}

	const tns = definitions.getAttribute("targetNamespace") ?? "";
	const messages = new Map();
	for (const message of children(definitions, WSDL, "message")) {
		messages.set(
			`{${tns}}${message.getAttribute("name")}`,
			children(message, WSDL, "part").map((part) => ({
				name: part.getAttribute("name"),
				element: qname(part, part.getAttribute("element")),
				type: qname(part, part.getAttribute("type")),
			})),
		);
	}
	const portTypes = new Map();
	for (const portType of children(definitions, WSDL, "portType")) {
		const operations = new Map();
		for (const operation of children(portType, WSDL, "operation")) {
			const input = child(operation, WSDL, "input");
			const output = child(operation, WSDL, "output");
			operations.set(operation.getAttribute("name"), {
				input: input ? qname(input, input.getAttribute("message")) : null,
				output: output ? qname(output, output.getAttribute("message")) : null,
				documentation: child(operation, WSDL, "documentation")?.textContent.trim() ?? "",
			});
		}
		portTypes.set(`{${tns}}${portType.getAttribute("name")}`, operations);
	}
	const bindings = new Map();
	for (const binding of children(definitions, WSDL, "binding")) {
		const soap = child(binding, SOAP11, "binding") ?? child(binding, SOAP12, "binding");
		if (!soap) continue;
		const version = soap.namespaceURI === SOAP12 ? "1.2" : "1.1";
		const style = soap.getAttribute("style") ?? "document";
		const operations = new Map();
		for (const operation of children(binding, WSDL, "operation")) {
			const soapOperation = child(operation, soap.namespaceURI, "operation");
			const body = child(child(operation, WSDL, "input"), soap.namespaceURI, "body");
			operations.set(operation.getAttribute("name"), {
				action: soapOperation?.getAttribute("soapAction") ?? "",
				style: soapOperation?.getAttribute("style") ?? style,
				namespace: body?.getAttribute("namespace") ?? tns,
			});
		}
		bindings.set(`{${tns}}${binding.getAttribute("name")}`, {
			version,
			portType: key(qname(binding, binding.getAttribute("type"))),
			operations,
		});
	}

	const services = [];
	for (const service of children(definitions, WSDL, "service")) {
		const ports = [];
		for (const port of children(service, WSDL, "port")) {
			const binding = bindings.get(key(qname(port, port.getAttribute("binding"))));
			if (!binding) continue;
			const address = child(port, SOAP11, "address") ?? child(port, SOAP12, "address");
			const operations = [...(portTypes.get(binding.portType) ?? new Map())].map(
				([name, abstract]) => {
					const concrete = binding.operations.get(name) ?? {
						action: "",
						style: "document",
						namespace: tns,
					};
					return {
						name,
						action: concrete.action,
						documentation: abstract.documentation,
						sample: () =>
							envelope(
								binding.version,
								sampleBody(index, messages.get(key(abstract.input)) ?? [], name, concrete),
							),
					};
				},
			);
			ports.push({
				name: port.getAttribute("name"),
				version: binding.version,
				endpoint: address?.getAttribute("location") ?? "",
				operations,
			});
		}
		services.push({ name: service.getAttribute("name"), ports });
	}
	return {
		name: definitions.getAttribute("name") || services[0]?.name || url,
		targetNamespace: tns,
		services,
	};
}

function parse(text, url) {
	const doc = new DOMParser().parseFromString(text, "application/xml");
	const error = doc.querySelector("parsererror");
	if (error) throw new Error(`${url} is not well-formed XML: ${error.textContent.split("\n")[0]}`);
	return doc;
}

// --- Sample requests ----------------------------------------------------------------

const SAMPLE_VALUES = {
	string: "?",
	normalizedString: "?",
	token: "?",
	anyURI: "http://example.com",
	int: "0",
	integer: "0",
	long: "0",
	short: "0",
	byte: "0",
	unsignedInt: "0",
	unsignedLong: "0",
	unsignedShort: "0",
	nonNegativeInteger: "0",
	positiveInteger: "1",
	decimal: "0.0",
	double: "0.0",
	float: "0.0",
	boolean: "false",
	date: "2026-01-01",
	dateTime: "2026-01-01T00:00:00",
	time: "00:00:00",
	base64Binary: "",
	hexBinary: "",
	QName: "?",
};

class Writer {
	constructor() {
		this.prefixes = new Map();
	}

	prefix(ns) {
		if (!ns) return null;
		if (!this.prefixes.has(ns)) this.prefixes.set(ns, `ns${this.prefixes.size + 1}`);
		return this.prefixes.get(ns);
	}
}

const xmlEscape = (text) =>
	String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function sampleBody(index, parts, operation, concrete) {
	const writer = new Writer();
	const lines = [];
	if (concrete.style === "rpc") {
		const prefix = writer.prefix(concrete.namespace);
		lines.push(`<${prefix}:${operation}>`);
		for (const part of parts) {
			if (part.element)
				writeElement(
					index,
					writer,
					lines,
					index.elements.get(key(part.element)),
					part.element,
					1,
					new Set(),
				);
			else writeTyped(index, writer, lines, part.name, null, part.type, 1, new Set());
		}
		lines.push(`</${prefix}:${operation}>`);
	} else {
		for (const part of parts) {
			if (part.element)
				writeElement(
					index,
					writer,
					lines,
					index.elements.get(key(part.element)),
					part.element,
					0,
					new Set(),
				);
			else writeTyped(index, writer, lines, part.name, null, part.type, 0, new Set());
		}
	}
	return { lines, prefixes: writer.prefixes };
}

function writeElement(index, writer, lines, entry, q, depth, seen) {
	if (!entry) {
		lines.push(
			`${"   ".repeat(depth)}<${writer.prefix(q.ns)}:${q.name}>?</${writer.prefix(q.ns)}:${q.name}>`,
		);
		return;
	}
	const { node } = entry;
	const typeName = qname(node, node.getAttribute("type"));
	const inline = child(node, XSD, "complexType") ?? child(node, XSD, "simpleType");
	writeTyped(
		index,
		writer,
		lines,
		q.name,
		entry.ns,
		typeName,
		depth,
		seen,
		inline,
		entry.qualified,
		true,
	);
}

function writeTyped(
	index,
	writer,
	lines,
	name,
	ns,
	typeName,
	depth,
	seen,
	inline = null,
	qualified = false,
	top = false,
) {
	const pad = "   ".repeat(depth);
	const prefix = ns && (top || qualified) ? `${writer.prefix(ns)}:` : "";
	const tag = `${prefix}${name}`;
	if (typeName && typeName.ns === XSD) {
		lines.push(`${pad}<${tag}>${xmlEscape(SAMPLE_VALUES[typeName.name] ?? "?")}</${tag}>`);
		return;
	}
	const typeEntry = typeName ? index.types.get(key(typeName)) : null;
	const definition = inline ?? typeEntry?.node ?? null;
	if (definition === null) {
		lines.push(`${pad}<${tag}>?</${tag}>`);
		return;
	}
	if (definition.localName === "simpleType") {
		const enumeration = definition.querySelector("enumeration");
		lines.push(`${pad}<${tag}>${xmlEscape(enumeration?.getAttribute("value") ?? "?")}</${tag}>`);
		return;
	}
	const guard = typeName ? key(typeName) : null;
	if (guard !== null && seen.has(guard)) {
		lines.push(`${pad}<${tag}/>`);
		return;
	}
	const nextSeen = new Set(seen);
	if (guard !== null) nextSeen.add(guard);
	const inner = [];
	writeContent(
		index,
		writer,
		inner,
		definition,
		typeEntry?.ns ?? ns,
		typeEntry?.qualified ?? qualified,
		depth + 1,
		nextSeen,
	);
	if (inner.length === 0) lines.push(`${pad}<${tag}>?</${tag}>`);
	else lines.push(`${pad}<${tag}>`, ...inner, `${pad}</${tag}>`);
}

function writeContent(index, writer, lines, complex, ns, qualified, depth, seen) {
	if (depth > 10) return;
	const extension = complex.querySelector(
		":scope > complexContent > extension, :scope > complexContent > restriction",
	);
	if (extension) {
		const base = index.types.get(key(qname(extension, extension.getAttribute("base"))));
		if (base) writeContent(index, writer, lines, base.node, base.ns, base.qualified, depth, seen);
		writeContent(index, writer, lines, extension, ns, qualified, depth, seen);
		return;
	}
	for (const group of [...complex.children].filter(
		(each) => each.namespaceURI === XSD && ["sequence", "all", "choice"].includes(each.localName),
	)) {
		const items =
			group.localName === "choice" ? [...group.children].slice(0, 1) : [...group.children];
		for (const item of items) {
			if (item.namespaceURI !== XSD) continue;
			if (item.localName === "element") {
				const ref = item.getAttribute("ref");
				if (ref) {
					const q = qname(item, ref);
					writeElement(index, writer, lines, index.elements.get(key(q)), q, depth, seen);
					continue;
				}
				const optional = item.getAttribute("minOccurs") === "0";
				if (optional) lines.push(`${"   ".repeat(depth)}<!--Optional:-->`);
				const many =
					item.getAttribute("maxOccurs") === "unbounded" ||
					Number(item.getAttribute("maxOccurs")) > 1;
				if (many) lines.push(`${"   ".repeat(depth)}<!--Zero or more repetitions:-->`);
				const inline = child(item, XSD, "complexType") ?? child(item, XSD, "simpleType");
				writeTyped(
					index,
					writer,
					lines,
					item.getAttribute("name"),
					ns,
					qname(item, item.getAttribute("type")),
					depth,
					seen,
					inline,
					qualified,
				);
			} else if (["sequence", "choice", "all"].includes(item.localName)) {
				const wrapper = item.ownerDocument.createElementNS(XSD, "complexType");
				wrapper.append(item.cloneNode(true));
				writeContent(index, writer, lines, wrapper, ns, qualified, depth, seen);
			}
		}
	}
}

function envelope(version, body) {
	const env = ENVELOPE[version];
	const declarations = [
		` xmlns:soapenv="${env}"`,
		...[...body.prefixes].map(([ns, prefix]) => ` xmlns:${prefix}="${ns}"`),
	].join("");
	return [
		`<soapenv:Envelope${declarations}>`,
		"   <soapenv:Header/>",
		"   <soapenv:Body>",
		...body.lines.map((line) => `      ${line}`),
		"   </soapenv:Body>",
		"</soapenv:Envelope>",
	].join("\n");
}

/** A SOAP fault in a response: its code and message; `null` when there is none. */
export function faultOf(text) {
	const doc = new DOMParser().parseFromString(text, "application/xml");
	if (doc.querySelector("parsererror")) return null;
	const fault = [...doc.getElementsByTagNameNS("*", "Fault")].find((node) =>
		Object.values(ENVELOPE).includes(node.namespaceURI),
	);
	if (!fault) return null;
	const find = (...names) => {
		for (const name of names) {
			const found =
				[...fault.getElementsByTagNameNS("*", name)][0] ??
				[...fault.children].find((node) => node.localName === name);
			if (found) return found.textContent.trim();
		}
		return "";
	};
	return { code: find("faultcode", "Value"), message: find("faultstring", "Text") };
}
