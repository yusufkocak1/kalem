/**
 * The kinds of run configuration: the fields each one's form shows, and
 * how a configuration becomes a program to run. Pure but for `fs`.
 */

const JAVA_UTF8 = "-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8";

export function pathTools(platform) {
	const sep = platform === "win32" ? "\\" : "/";
	const isAbsolute = (path) =>
		platform === "win32" ? /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(path) : path.startsWith("/");
	const join = (...parts) =>
		parts
			.filter((part) => part !== undefined && part !== null && part !== "")
			.map((part, index) =>
				index === 0
					? String(part).replace(/[\\/]+$/, "")
					: String(part).replace(/^[\\/]+|[\\/]+$/g, ""),
			)
			.join(sep);
	const resolve = (base, path) =>
		path === undefined || path === null || path === ""
			? base
			: isAbsolute(path)
				? path
				: join(base, path);
	return { sep, isAbsolute, join, resolve };
}

/** `-Xmx1g "-Dname=a b"` → ["-Xmx1g", "-Dname=a b"]. */
export function splitArgs(text) {
	const args = [];
	let current = "";
	let quote = null;
	let started = false;
	for (const char of String(text ?? "")) {
		if (quote !== null) {
			if (char === quote) quote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) args.push(current);
			current = "";
			started = false;
		} else {
			current += char;
			started = true;
		}
	}
	if (started) args.push(current);
	return args;
}

/** `A=1` lines (or `;` separated, as IntelliJ shows them) → { A: "1" }. */
export function parseEnv(text) {
	const env = {};
	for (const part of String(text ?? "").split(/[\n;]/)) {
		const at = part.indexOf("=");
		if (at <= 0) continue;
		const name = part.slice(0, at).trim();
		if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) env[name] = part.slice(at + 1).trim();
	}
	return env;
}

export function slug(name) {
	return (
		String(name)
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/ı/g, "i")
			.replace(/[^A-Za-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "app"
	);
}

const xml = (text) =>
	String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** A Tomcat of its own for the configuration: its ports, nothing else of the installed one's server.xml. */
export function tomcatServerXml(httpPort) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Made by Kalem's Run Configurations for this configuration; it is written again at each run. -->
<Server port="-1" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />
  <Listener className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />
  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener" />
  <Listener className="org.apache.catalina.core.ThreadLocalLeakPreventionListener" />
  <GlobalNamingResources>
    <Resource name="UserDatabase" auth="Container" type="org.apache.catalina.UserDatabase"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory" pathname="conf/tomcat-users.xml" />
  </GlobalNamingResources>
  <Service name="Catalina">
    <Connector port="${Number(httpPort)}" protocol="HTTP/1.1" connectionTimeout="20000" />
    <Engine name="Catalina" defaultHost="localhost">
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm" resourceName="UserDatabase" />
      </Realm>
      <Host name="localhost" appBase="webapps" unpackWARs="true" autoDeploy="false" deployOnStartup="true" />
    </Engine>
  </Service>
</Server>
`;
}

/** `/order/api` → `order#api.xml`; `/` → `ROOT.xml`. */
export function contextFileName(contextPath) {
	const path = String(contextPath ?? "").replace(/^\/+|\/+$/g, "");
	return `${path === "" ? "ROOT" : path.replace(/\//g, "#")}.xml`;
}

export function contextUrl(port, contextPath) {
	const path = String(contextPath ?? "").replace(/^\/+|\/+$/g, "");
	return `http://localhost:${port}/${path === "" ? "" : `${path}/`}`;
}

const COMMON = [
	{ key: "workingDir", label: "Working directory", kind: "folder", placeholder: "The open folder" },
	{
		key: "env",
		label: "Environment variables",
		kind: "env",
		placeholder: "NAME=value, one per line",
	},
];

const JAVA_HOME = {
	key: "javaHome",
	label: "JRE / JDK",
	kind: "folder",
	placeholder: "JAVA_HOME, or java on the PATH",
};
const VM_OPTIONS = {
	key: "vmOptions",
	label: "VM options",
	kind: "text",
	placeholder: "-Xmx1g -Dspring.profiles.active=dev",
};

/** A local dev server's address in its output (Vite, Vue CLI, Angular, Next…). */
export function localUrlIn(text) {
	const match =
		/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s"'`)]*)?/.exec(
			text,
		);
	return match === null ? null : match[0].replace("0.0.0.0", "localhost").replace(/[.,;]+$/, "");
}

function javaCommand(config, paths) {
	return config.javaHome ? paths.join(config.javaHome, "bin", "java") : "java";
}

export const TYPES = {
	command: {
		title: "Command",
		fields: [
			{
				key: "commandLine",
				label: "Command",
				kind: "textarea",
				placeholder: "docker compose up",
				required: true,
			},
			...COMMON,
			{
				key: "encoding",
				label: "Output encoding",
				kind: "select",
				options: ["utf-8", "windows-1254", "windows-1252"],
				default: "utf-8",
			},
		],
		async build(config, ctx) {
			return {
				command: String(config.commandLine ?? "").trim(),
				args: [],
				shell: true,
				encoding: config.encoding || "utf-8",
			};
		},
	},
	npm: {
		title: "npm script",
		fields: [
			{ key: "script", label: "Script", kind: "script", placeholder: "dev", required: true },
			{
				key: "packageManager",
				label: "Package manager",
				kind: "select",
				options: ["auto", "npm", "yarn", "pnpm"],
				default: "auto",
			},
			{ key: "args", label: "Arguments", kind: "text", placeholder: "--port 3000" },
			{
				key: "openBrowser",
				label: "Open the browser when the server is ready",
				kind: "checkbox",
				default: true,
			},
			...COMMON,
		],
		async build(config, ctx) {
			const cwd = ctx.paths.resolve(ctx.folder, config.workingDir);
			let manager =
				config.packageManager && config.packageManager !== "auto" ? config.packageManager : "npm";
			if (!config.packageManager || config.packageManager === "auto") {
				if (await ctx.fs.exists(ctx.paths.join(cwd, "pnpm-lock.yaml"))) manager = "pnpm";
				else if (await ctx.fs.exists(ctx.paths.join(cwd, "yarn.lock"))) manager = "yarn";
			}
			const extra = splitArgs(config.args);
			const args =
				manager === "npm"
					? ["run", config.script, ...(extra.length > 0 ? ["--", ...extra] : [])]
					: ["run", config.script, ...extra];
			return {
				command: manager,
				args,
				shell: ctx.platform === "win32",
				env: { FORCE_COLOR: "1" },
				openUrl: config.openBrowser === false ? null : "detect",
			};
		},
	},
	maven: {
		title: "Maven",
		fields: [
			{
				key: "goals",
				label: "Goals",
				kind: "text",
				placeholder: "clean package -DskipTests",
				required: true,
			},
			{ key: "profiles", label: "Profiles", kind: "text", placeholder: "dev,local" },
			JAVA_HOME,
			{ key: "vmOptions", label: "VM options (MAVEN_OPTS)", kind: "text", placeholder: "-Xmx2g" },
			...COMMON,
		],
		async build(config, ctx) {
			const cwd = ctx.paths.resolve(ctx.folder, config.workingDir);
			const wrapper = ctx.paths.join(cwd, ctx.platform === "win32" ? "mvnw.cmd" : "mvnw");
			const command = (await ctx.fs.exists(wrapper)) ? wrapper : "mvn";
			const args = [
				...splitArgs(config.goals),
				...(config.profiles ? [`-P${config.profiles}`] : []),
			];
			return {
				command,
				args,
				shell: ctx.platform === "win32",
				env: {
					...(config.javaHome ? { JAVA_HOME: config.javaHome } : {}),
					...(config.vmOptions ? { MAVEN_OPTS: config.vmOptions } : {}),
				},
			};
		},
	},
	gradle: {
		title: "Gradle",
		fields: [
			{ key: "tasks", label: "Tasks", kind: "text", placeholder: "bootRun", required: true },
			{ key: "args", label: "Arguments", kind: "text", placeholder: "--info" },
			JAVA_HOME,
			...COMMON,
		],
		async build(config, ctx) {
			const cwd = ctx.paths.resolve(ctx.folder, config.workingDir);
			const wrapper = ctx.paths.join(cwd, ctx.platform === "win32" ? "gradlew.bat" : "gradlew");
			const command = (await ctx.fs.exists(wrapper)) ? wrapper : "gradle";
			return {
				command,
				args: [...splitArgs(config.tasks), ...splitArgs(config.args)],
				shell: ctx.platform === "win32",
				env: config.javaHome ? { JAVA_HOME: config.javaHome } : {},
			};
		},
	},
	application: {
		title: "Application (Java)",
		fields: [
			{
				key: "mainClass",
				label: "Main class",
				kind: "text",
				placeholder: "com.acme.Main",
				required: true,
			},
			{
				key: "classpath",
				label: "Classpath",
				kind: "text",
				placeholder: "target/classes",
				default: "target/classes",
			},
			{
				key: "mavenClasspath",
				label: "Add the Maven project's dependencies",
				kind: "checkbox",
				default: true,
			},
			{ key: "programArgs", label: "Program arguments", kind: "text" },
			VM_OPTIONS,
			JAVA_HOME,
			...COMMON,
		],
		async build(config, ctx) {
			const cwd = ctx.paths.resolve(ctx.folder, config.workingDir);
			const separator = ctx.platform === "win32" ? ";" : ":";
			const entries = String(config.classpath || "target/classes")
				.split(ctx.platform === "win32" ? ";" : /[;:]/)
				.map((entry) => entry.trim())
				.filter(Boolean)
				.map((entry) => ctx.paths.resolve(cwd, entry));
			const steps = [];
			if (
				config.mavenClasspath !== false &&
				(await ctx.fs.exists(ctx.paths.join(cwd, "pom.xml")))
			) {
				const file = ctx.paths.join(cwd, "target", ".kalem-classpath");
				steps.push({
					title: "Maven: dependency:build-classpath",
					command: "mvn",
					args: ["-q", "dependency:build-classpath", `-Dmdep.outputFile=${file}`],
					shell: ctx.platform === "win32",
					cwd,
					after: async () => {
						const text = await ctx.fs.readText(file).catch(() => "");
						if (text.trim() !== "") entries.push(...text.trim().split(separator));
					},
				});
			}
			return {
				command: javaCommand(config, ctx.paths),
				args: () => [
					...splitArgs(JAVA_UTF8),
					...splitArgs(config.vmOptions),
					"-cp",
					entries.join(separator),
					config.mainClass,
					...splitArgs(config.programArgs),
				],
				steps,
			};
		},
	},
	jar: {
		title: "JAR Application",
		fields: [
			{
				key: "jar",
				label: "JAR file",
				kind: "file",
				placeholder: "target/app.jar",
				required: true,
			},
			{ key: "programArgs", label: "Program arguments", kind: "text" },
			VM_OPTIONS,
			JAVA_HOME,
			...COMMON,
		],
		async build(config, ctx) {
			const cwd = ctx.paths.resolve(ctx.folder, config.workingDir);
			return {
				command: javaCommand(config, ctx.paths),
				args: [
					...splitArgs(JAVA_UTF8),
					...splitArgs(config.vmOptions),
					"-jar",
					ctx.paths.resolve(cwd, config.jar),
					...splitArgs(config.programArgs),
				],
			};
		},
	},
	tomcat: {
		title: "Tomcat Server (local)",
		fields: [
			{
				key: "tomcatHome",
				label: "Tomcat folder",
				kind: "folder",
				placeholder: "C:/tools/apache-tomcat-10.1",
				required: true,
			},
			{
				key: "artifact",
				label: "Deployment (WAR or exploded folder)",
				kind: "file",
				placeholder: "target/app.war",
				required: true,
			},
			{
				key: "contextPath",
				label: "Application context",
				kind: "text",
				placeholder: "/app",
				default: "/",
			},
			{ key: "httpPort", label: "HTTP port", kind: "number", default: 8080 },
			{
				key: "openBrowser",
				label: "Open the browser when Tomcat has started",
				kind: "checkbox",
				default: true,
			},
			VM_OPTIONS,
			JAVA_HOME,
			...COMMON,
		],
		async build(config, ctx, name) {
			const { paths, fs } = ctx;
			const home = config.tomcatHome;
			const script = paths.join(
				home,
				"bin",
				ctx.platform === "win32" ? "catalina.bat" : "catalina.sh",
			);
			if (!(await fs.exists(script)))
				throw new Error(ctx.t('{0} is not there: is "{1}" a Tomcat folder?', script, home));
			const artifact = paths.resolve(ctx.folder, config.artifact);
			if (!(await fs.exists(artifact)))
				throw new Error(ctx.t("{0} is not there yet: build it first (Before launch).", artifact));
			const port = Number(config.httpPort) || 8080;
			const base = paths.join(ctx.folder, ".kalem", "run", "tomcat", slug(name));
			const prepare = async () => {
				await fs.writeText(paths.join(ctx.folder, ".kalem", "run", ".gitignore"), "*\n");
				for (const folder of ["conf", "logs", "temp", "webapps", "work"])
					await fs.mkdir(paths.join(base, folder));
				for (const entry of await fs.list(paths.join(home, "conf"))) {
					if (entry.name === "server.xml" || entry.name === "Catalina") continue;
					await fs.copy(paths.join(home, "conf", entry.name), paths.join(base, "conf", entry.name));
				}
				await fs.writeText(paths.join(base, "conf", "server.xml"), tomcatServerXml(port));
				await fs.writeText(
					paths.join(base, "conf", "Catalina", "localhost", contextFileName(config.contextPath)),
					`<?xml version="1.0" encoding="UTF-8"?>\n<Context docBase="${xml(artifact)}" />\n`,
				);
			};
			return {
				command: ctx.platform === "win32" ? script : "sh",
				args: ctx.platform === "win32" ? ["run"] : [script, "run"],
				shell: ctx.platform === "win32",
				env: {
					CATALINA_HOME: home,
					CATALINA_BASE: base,
					CATALINA_OPTS: [JAVA_UTF8, config.vmOptions ?? ""].join(" ").trim(),
					...(config.javaHome ? { JAVA_HOME: config.javaHome, JRE_HOME: config.javaHome } : {}),
				},
				prepare,
				ready: /Server startup in/,
				openUrl: config.openBrowser === false ? null : contextUrl(port, config.contextPath),
			};
		},
	},
	compound: {
		title: "Compound",
		fields: [{ key: "configurations", label: "Run together", kind: "configurations" }],
		async build() {
			return { compound: true };
		},
	},
};

/** What the form needs to know of each kind. */
export function typeSchemas() {
	return Object.fromEntries(
		Object.entries(TYPES).map(([id, type]) => [id, { title: type.title, fields: type.fields }]),
	);
}

/** A configuration's problems, before it is run. */
export function problemsOf(
	config,
	names,
	t = (text, ...values) => text.replace(/\{(\d+)\}/g, (_, i) => values[i]),
) {
	const type = TYPES[config.type];
	if (type === undefined) return [`Unknown type: ${config.type}`];
	const problems = [];
	if (!String(config.name ?? "").trim()) problems.push(t("Give it a name."));
	for (const field of type.fields) {
		if (field.required && !String(config[field.key] ?? "").trim())
			problems.push(t("{0} is empty.", t(field.label)));
	}
	for (const other of [...(config.beforeLaunch ?? []), ...(config.configurations ?? [])]) {
		if (!names.includes(other)) problems.push(t('There is no configuration named "{0}".', other));
	}
	return problems;
}

export const STORE_VERSION = 1;

export function parseStore(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return { configurations: [] };
	}
	const configurations = Array.isArray(raw?.configurations)
		? raw.configurations.filter(
				(each) => each && typeof each.name === "string" && TYPES[each.type] !== undefined,
			)
		: [];
	return { configurations };
}
