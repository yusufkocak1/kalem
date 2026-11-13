/**
 * MCP servers a mode can start from: each filled in as it is commonly
 * run, with what it is for (the model is told) and only the tools it
 * needs where that matters. Words in angle brackets (`<GITHUB_TOKEN>`)
 * are the user's to fill in. Pure.
 */
import type { Strings } from "./i18n.js";
import type { McpServer } from "./mcp-servers.js";

export interface McpPreset {
	readonly id: string;
	/** Its name in the list (a product's name: not translated). */
	readonly label: string;
	/** What it does and what it needs, in the interface's language. */
	readonly description: keyof Strings;
	/**
	 * How to set it up, in the interface's language: a line on what it is,
	 * then a step on each line.
	 */
	readonly guide: keyof Strings;
	/** Files and commands to copy while setting it up (not translated: code). */
	readonly samples?: readonly McpSample[];
	/** The server as it is added; its name is made unique in the mode. */
	readonly server: Omit<McpServer, "enabled" | "preset">;
}

export interface McpSample {
	/** What it is, in the interface's language. */
	readonly title: keyof Strings;
	readonly text: string;
}

const stdio = (
	name: string,
	command: string,
	args: readonly string[],
	purpose: string,
	more: { env?: Record<string, string>; tools?: readonly string[] } = {},
): Omit<McpServer, "enabled" | "preset"> => ({
	name,
	transport: "stdio",
	command,
	args,
	env: more.env ?? {},
	url: "",
	headers: {},
	tools: more.tools ?? [],
	purpose,
});

const http = (
	name: string,
	url: string,
	purpose: string,
	more: { headers?: Record<string, string>; tools?: readonly string[] } = {},
): Omit<McpServer, "enabled" | "preset"> => ({
	name,
	transport: "http",
	command: "",
	args: [],
	env: {},
	url,
	headers: more.headers ?? {},
	tools: more.tools ?? [],
	purpose,
});

export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: "dbhub",
		samples: [
			{
				title: "mcpSampleSql",
				text: "-- PostgreSQL: a user for the assistant, with only what it needs\nCREATE VIEW v_parameter AS\n  SELECT code, value, description FROM parameters;\n\nCREATE USER kalem_assistant WITH PASSWORD 'a-strong-password';\nGRANT SELECT ON v_parameter TO kalem_assistant;\nGRANT SELECT, INSERT ON i18n TO kalem_assistant;  -- no UPDATE, no DELETE",
			},
			{
				title: "mcpSampleToml",
				text: '[[sources]]\nid  = "main"\ndsn = "postgres://kalem_assistant:a-strong-password@db-host:5432/app?sslmode=require"\n\n# 1) What is this parameter\'s value? (read-only)\n[[tools]]\nname        = "get_parameter"\nsource      = "main"\ndescription = "Returns a parameter\'s value and description. Give its code."\nstatement   = "SELECT code, value, description FROM v_parameter WHERE code = $1"\nreadonly    = true\nmax_rows    = 5\n\n[[tools.parameters]]\nname        = "code"\ntype        = "string"\ndescription = "The parameter\'s code, e.g. MAX_LOGIN_ATTEMPTS"\n\n# 2) Add an i18n key (leaves an existing one as it is)\n[[tools]]\nname        = "add_i18n_key"\nsource      = "main"\ndescription = "Adds an i18n key with its Turkish and English texts; an existing key is left as it is."\nstatement   = "INSERT INTO i18n (key, tr, en) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING"\n\n[[tools.parameters]]\nname        = "key"\ntype        = "string"\ndescription = "The key, e.g. login.error.wrongPassword"\n\n[[tools.parameters]]\nname        = "tr"\ntype        = "string"\ndescription = "Turkish text"\n\n[[tools.parameters]]\nname        = "en"\ntype        = "string"\ndescription = "English text"',
			},
		],
		guide: "mcpGuideDbhub",
		label: "DBHub",
		description: "mcpPresetDbhub",
		server: stdio(
			"db",
			"npx",
			["-y", "@bytebase/dbhub@latest", "--transport", "stdio", "--config", "<path>/dbhub.toml"],
			"The application's database, through fixed queries only. When the user asks what a parameter's value is, call get_parameter with its code and explain the value in plain words; do not guess. When you add a new i18n key in code, add it here too with add_i18n_key (Turkish and English texts) without being asked, and say which keys you added.",
			{ tools: ["get_parameter", "add_i18n_key"] },
		),
	},
	{
		id: "github",
		guide: "mcpGuideGithub",
		label: "GitHub",
		description: "mcpPresetGithub",
		server: http(
			"github",
			"https://api.githubcopilot.com/mcp/",
			"The team's GitHub: look up issues, pull requests, and code in other repositories when the work refers to them.",
			{ headers: { Authorization: "Bearer <GITHUB_TOKEN>", "X-MCP-Readonly": "true" } },
		),
	},
	{
		id: "git",
		guide: "mcpGuideGit",
		label: "Git",
		description: "mcpPresetGit",
		server: stdio(
			"git",
			"uvx",
			["mcp-server-git", "--repository", "<repository folder>"],
			"The repository's history: read the log, diffs and commits to see what changed and why before changing code.",
			{
				tools: [
					"git_status",
					"git_diff_unstaged",
					"git_diff_staged",
					"git_diff",
					"git_log",
					"git_show",
					"git_branch",
				],
			},
		),
	},
	{
		id: "filesystem",
		guide: "mcpGuideFilesystem",
		label: "Filesystem",
		description: "mcpPresetFilesystem",
		server: stdio(
			"files",
			"npx",
			["-y", "@modelcontextprotocol/server-filesystem", "<folder>"],
			"Files outside the workspace (shared specs, sample data): read them when the work needs them.",
		),
	},
	{
		id: "context7",
		guide: "mcpGuideContext7",
		label: "Context7",
		description: "mcpPresetContext7",
		server: stdio(
			"context7",
			"npx",
			["-y", "@upstash/context7-mcp@latest"],
			"Up-to-date documentation of libraries and frameworks: look a library's API up here before writing code with it, instead of answering from memory.",
		),
	},
	{
		id: "playwright",
		guide: "mcpGuidePlaywright",
		label: "Playwright",
		description: "mcpPresetPlaywright",
		server: stdio(
			"playwright",
			"npx",
			["-y", "@playwright/mcp@latest", "--headless"],
			"A browser: open the application's pages to check how a change looks and behaves, and to reproduce a bug the user describes.",
		),
	},
	{
		id: "sentry",
		guide: "mcpGuideSentry",
		label: "Sentry",
		description: "mcpPresetSentry",
		server: stdio(
			"sentry",
			"npx",
			["-y", "@sentry/mcp-server@latest"],
			"The application's errors in production: when the user mentions an error or a crash, look up its issue and stack trace here before guessing at the cause.",
			{ env: { SENTRY_ACCESS_TOKEN: "<token>", SENTRY_HOST: "sentry.io" } },
		),
	},
	{
		id: "fortify",
		samples: [
			{
				title: "mcpSampleLogin",
				text: "fcli ssc session login --url https://ssc.example.com --user <user>\n# Fortify on Demand instead:\n# fcli fod session login --url https://ams.fortify.com --client-id <id> --client-secret <secret>",
			},
		],
		guide: "mcpGuideFortify",
		label: "Fortify (fcli)",
		description: "mcpPresetFortify",
		server: stdio(
			"fortify",
			"fcli",
			["util", "mcp-server", "start", "--module=ssc"],
			"The application's security findings in Fortify SSC: when code touches a part with open findings, or the user asks about vulnerabilities, look them up here and fix or explain them.",
		),
	},
	{
		id: "graylog",
		samples: [
			{
				title: "mcpSampleBase64",
				text: '# Linux / macOS\necho -n "<API_TOKEN>:token" | base64\n\n# Windows PowerShell\n[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("<API_TOKEN>:token"))',
			},
		],
		guide: "mcpGuideGraylog",
		label: "Graylog",
		description: "mcpPresetGraylog",
		server: http(
			"graylog",
			"http://<graylog-host>:9000/api/mcp",
			"The application's logs in Graylog: when the user mentions an error, a slow request or an incident, search the logs here (a narrow time range first) before guessing at the cause.",
			{ headers: { Authorization: "Basic <base64 of API_TOKEN:token>" } },
		),
	},
	{
		id: "fetch",
		guide: "mcpGuideFetch",
		label: "Fetch",
		description: "mcpPresetFetch",
		server: stdio(
			"fetch",
			"uvx",
			["mcp-server-fetch"],
			"Web pages: read a page the user gives an address of, as text.",
			{ tools: ["fetch"] },
		),
	},
	{
		id: "memory",
		guide: "mcpGuideMemory",
		label: "Memory",
		description: "mcpPresetMemory",
		server: stdio(
			"memory",
			"npx",
			["-y", "@modelcontextprotocol/server-memory"],
			"A memory kept between chats: remember the project's decisions, names and conventions the user tells you, and look them up before answering.",
			{ env: { MEMORY_FILE_PATH: "<path>/kalem-memory.jsonl" } },
		),
	},
	{
		id: "figma",
		guide: "mcpGuideFigma",
		label: "Figma",
		description: "mcpPresetFigma",
		server: http(
			"figma",
			"http://127.0.0.1:3845/mcp",
			"The designs in Figma (the frame selected in the Figma app): follow them when writing interface code or describing screens.",
		),
	},
];

/** A preset as a mode's new server: on, with a name not yet taken in the mode. */
export function presetServer(preset: McpPreset, taken: readonly McpServer[]): McpServer {
	const names = new Set(taken.map((server) => server.name));
	let name = preset.server.name;
	for (let n = 2; names.has(name); n++) name = `${preset.server.name}-${n}`;
	return { ...preset.server, name, preset: preset.id, enabled: true };
}
