#!/usr/bin/env node
/**
 * Makes an extension catalog for Kalem's market.
 *
 *   keygen <dir>                       a key pair: private.pem (keep it secret), and the public key to give Kalem
 *   build <extensions dir> <out dir>   packs each extension folder, writes index.json and signs it
 *       --key <private.pem>            the signing key (or the KALEM_REGISTRY_KEY environment variable, PEM)
 *       --name <catalog name>
 *       --blocked <blocked.json>       [{ "id": "acme.tool", "versions": "<1.2.0", "reason": "…" }]
 *
 * Versions already in <out dir>/index.json stay listed; a version is never
 * replaced with other bytes.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packFolder } from "./pack-extension.mjs";

const [command, ...rest] = process.argv.slice(2);
const option = (name) => {
	const at = rest.indexOf(`--${name}`);
	return at === -1 ? undefined : rest[at + 1];
};
const positional = rest.filter(
	(arg, index) => !arg.startsWith("--") && !rest[index - 1]?.startsWith("--"),
);
const fail = (message) => {
	process.stderr.write(`${message}\n`);
	process.exit(1);
};

/** The extension's icon, kept in the index so the market shows it before the package is downloaded. */
async function iconOf(folder, manifest) {
	if (typeof manifest.icon !== "string" || !/\.(svg|png)$/i.test(manifest.icon)) return {};
	const data = await readFile(join(folder, manifest.icon)).catch(() => null);
	if (data === null || data.byteLength > 64 * 1024) return {};
	// kalem-locale-ok: file extensions are ASCII
	const type = manifest.icon.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
	return { icon: `data:${type};base64,${data.toString("base64")}` };
}

if (command === "keygen") {
	const dir = resolve(positional[0] ?? ".");
	await mkdir(dir, { recursive: true });
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const file = join(dir, "private.pem");
	if (existsSync(file)) fail(`${file} is there already: it is not overwritten.`);
	await writeFile(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
	const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
	await writeFile(join(dir, "public-key.txt"), `${pub}\n`);
	process.stdout.write(
		`Private key: ${file} (keep it secret: a CI secret, never in the repository)\nPublic key (give it to Kalem):\n${pub}\n`,
	);
} else if (command === "build") {
	const [source, outArg] = positional;
	if (source === undefined || outArg === undefined)
		fail("Usage: build <extensions dir> <out dir> --key private.pem");
	const pem =
		process.env.KALEM_REGISTRY_KEY ??
		(option("key") ? await readFile(option("key"), "utf8") : undefined);
	if (pem === undefined) fail("Give the signing key: --key private.pem, or KALEM_REGISTRY_KEY.");
	const key = createPrivateKey(pem);
	const out = resolve(outArg);
	await mkdir(out, { recursive: true });

	const indexFile = join(out, "index.json");
	const previous = existsSync(indexFile)
		? JSON.parse(await readFile(indexFile, "utf8"))
		: { extensions: [] };
	const entries = new Map(
		previous.extensions.map((entry) => [`${entry.id}@${entry.version}`, entry]),
	);

	for (const name of (await readdir(source, { withFileTypes: true })).filter((each) =>
		each.isDirectory(),
	)) {
		const folder = join(source, name.name);
		if (!existsSync(join(folder, "manifest.json"))) continue;
		const { manifest, bytes } = await packFolder(folder);
		const file = `${manifest.id}-${manifest.version}.kalem-ext`;
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const known = entries.get(`${manifest.id}@${manifest.version}`);
		if (known !== undefined && known.sha256 !== sha256) {
			fail(
				`${manifest.id} ${manifest.version} is published already with other contents: raise its version.`,
			);
		}
		await writeFile(join(out, file), bytes);
		entries.set(`${manifest.id}@${manifest.version}`, {
			id: manifest.id,
			name: manifest.name,
			version: manifest.version,
			description: manifest.description ?? "",
			publisher: manifest.publisher ?? "",
			engine: manifest.engines?.kalem ?? "*",
			permissions: manifest.permissions ?? {},
			url: file,
			...(await iconOf(folder, manifest)),
			sha256,
			size: bytes.byteLength,
		});
		process.stdout.write(`${manifest.id} ${manifest.version}\n`);
	}

	const index = {
		version: 1,
		name: option("name") ?? previous.name ?? "Kalem extensions",
		updated: new Date().toISOString(),
		extensions: [...entries.values()].sort(
			(a, b) =>
				a.id.localeCompare(b.id, "en") ||
				a.version.localeCompare(b.version, "en", { numeric: true }),
		),
		blocked: option("blocked")
			? JSON.parse(await readFile(option("blocked"), "utf8"))
			: (previous.blocked ?? []),
	};
	const data = Buffer.from(`${JSON.stringify(index, null, "\t")}\n`);
	await writeFile(indexFile, data);
	await writeFile(`${indexFile}.sig`, `${sign(null, data, key).toString("base64")}\n`);
	process.stdout.write(`${indexFile} signed.\n`);
} else {
	fail(
		"Usage: extension-registry.mjs keygen <dir> | build <extensions dir> <out dir> --key private.pem",
	);
}
