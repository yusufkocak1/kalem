import { describe, expect, it } from "vitest";
import type { ProcessEvent } from "./extension-process.js";
import { ExtensionProcesses, parseSpawnRequest } from "./extension-process.js";

function collect(): {
	events: ProcessEvent[];
	done: Promise<void>;
	emit: (id: string, event: ProcessEvent) => void;
} {
	const events: ProcessEvent[] = [];
	let finish = (): void => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return {
		events,
		done,
		emit: (_id, event) => {
			events.push(event);
			if (event.type === "exit" || event.type === "error") finish();
		},
	};
}

const output = (events: ProcessEvent[], stream: "stdout" | "stderr"): string =>
	events
		.map((event) => (event.type === "output" && event.stream === stream ? event.text : ""))
		.join("");

describe("parseSpawnRequest", () => {
	it("keeps what can be run", () => {
		expect(
			parseSpawnRequest({ command: " node ", args: [1, "a"], env: { A: 1, "bad name": "x" } }),
		).toEqual({
			command: "node",
			args: ["1", "a"],
			cwd: null,
			env: { A: "1" },
			shell: false,
			encoding: "utf-8",
		});
		expect(parseSpawnRequest({ command: "x", encoding: "windows-1254" }).encoding).toBe(
			"windows-1254",
		);
		expect(parseSpawnRequest({ command: "x", encoding: "nope" }).encoding).toBe("utf-8");
		expect(() => parseSpawnRequest({ command: "" })).toThrow();
	});
});

describe.skipIf(process.platform === "win32")("ExtensionProcesses", () => {
	it("streams a program's output, with its env, and its exit code", async () => {
		const processes = new ExtensionProcesses();
		const { events, done, emit } = collect();
		await processes.spawn(
			"acme.run",
			parseSpawnRequest({
				command: process.execPath,
				args: [
					"-e",
					"console.log('merhaba ' + process.env.WHO); console.error('uyarı'); process.exit(3)",
				],
				env: { WHO: "dünya", ELECTRON_RUN_AS_NODE: "1" },
			}),
			emit,
		);
		await done;
		expect(output(events, "stdout")).toBe("merhaba dünya\n");
		expect(output(events, "stderr")).toBe("uyarı\n");
		expect(events.at(-1)).toEqual({ type: "exit", code: 3, signal: null });
	});

	it("decodes another encoding", async () => {
		const processes = new ExtensionProcesses();
		const { events, done, emit } = collect();
		await processes.spawn(
			"acme.run",
			parseSpawnRequest({
				command: process.execPath,
				args: ["-e", "process.stdout.write(Buffer.from([0xfe, 0xf0, 0xfd]))"],
				env: { ELECTRON_RUN_AS_NODE: "1" },
				encoding: "windows-1254",
			}),
			emit,
		);
		await done;
		expect(output(events, "stdout")).toBe("şğı");
	});

	it("stops a program and what it started", async () => {
		const processes = new ExtensionProcesses();
		const { events, done, emit } = collect();
		const id = await processes.spawn(
			"acme.run",
			parseSpawnRequest({ command: "sh", args: ["-c", "sleep 30 & sleep 30; echo never"] }),
			emit,
		);
		setTimeout(() => processes.kill("acme.run", id), 200);
		await done;
		expect(output(events, "stdout")).toBe("");
		expect(events.at(-1)).toMatchObject({ type: "exit", signal: "SIGTERM" });
		expect(() => processes.write("other.ext", id, "x")).toThrow();
	});

	it("says when a folder is not there", async () => {
		const processes = new ExtensionProcesses();
		await expect(
			processes.spawn(
				"acme.run",
				parseSpawnRequest({ command: "ls", cwd: "/no/such/folder" }),
				() => {},
			),
		).rejects.toThrow(/not there/);
	});
});
