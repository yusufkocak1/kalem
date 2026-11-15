/**
 * The programs MCP servers are commonly started with (npx, uvx, docker…):
 * what each is and how it is installed, for the warning a server's card
 * shows when its command is not on this computer. Pure.
 */
import type { Strings } from "./i18n.js";

/** One way to install a program: on which system, and the command to run. */
export interface InstallStep {
	/** The system's name (not translated). */
	readonly system: string;
	readonly command: string;
}

export interface McpRuntime {
	readonly id: string;
	/** Its name (not translated). */
	readonly label: string;
	/** The commands it brings. */
	readonly commands: readonly string[];
	/** What it is and why the server needs it, in the interface's language. */
	readonly about: keyof Strings;
	readonly install: readonly InstallStep[];
	/** Where it is explained. */
	readonly link: string;
}

export const MCP_RUNTIMES: readonly McpRuntime[] = [
	{
		id: "node",
		label: "Node.js",
		commands: ["npx", "npm", "node"],
		about: "mcpRuntimeNode",
		install: [
			{ system: "Windows", command: "winget install --id OpenJS.NodeJS.LTS -e" },
			{ system: "macOS", command: "brew install node" },
			{ system: "Linux", command: "sudo apt install nodejs npm" },
		],
		link: "https://nodejs.org",
	},
	{
		id: "uv",
		label: "uv",
		commands: ["uvx", "uv"],
		about: "mcpRuntimeUv",
		install: [
			{
				system: "Windows (PowerShell)",
				command:
					'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
			},
			{ system: "Windows", command: "winget install --id astral-sh.uv -e" },
			{ system: "macOS", command: "brew install uv" },
			{ system: "Python", command: "pip install uv" },
			{ system: "macOS / Linux", command: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
		],
		link: "https://docs.astral.sh/uv/",
	},
	{
		id: "docker",
		label: "Docker",
		commands: ["docker"],
		about: "mcpRuntimeDocker",
		install: [
			{ system: "Windows", command: "winget install --id Docker.DockerDesktop -e" },
			{ system: "macOS", command: "brew install --cask docker" },
		],
		link: "https://docs.docker.com/get-docker/",
	},
	{
		id: "python",
		label: "Python",
		commands: ["python", "python3", "pip", "pipx"],
		about: "mcpRuntimePython",
		install: [
			{ system: "Windows", command: "winget install --id Python.Python.3.12 -e" },
			{ system: "macOS", command: "brew install python" },
		],
		link: "https://www.python.org/downloads/",
	},
];

/** The program a command comes with, by its name (`npx`, `C:\\…\\uvx.exe`); `null` for one not listed. */
export function runtimeOf(command: string): McpRuntime | null {
	const name = (command.trim().split(/[\\/]/).pop() ?? "")
		.toLocaleLowerCase("en")
		.replace(/\.(exe|cmd|bat|ps1)$/, "");
	return MCP_RUNTIMES.find((runtime) => runtime.commands.includes(name)) ?? null;
}
