export async function activate(kalem) {
	const ui = (name, handler) => kalem.ui.handle(name, handler);
	await ui("settings", async () => (await kalem.settings.all()).greeting);
	await ui("storage", async () => {
		const count = ((await kalem.storage.get("count")) ?? 0) + 1;
		await kalem.storage.set("count", count);
		return count;
	});
	await ui("fetch", async (url) => {
		const response = await kalem.http.fetch(String(url));
		return `${response.status} ${response.body}`;
	});
	await ui(
		"readRange",
		async (path) => (await kalem.fs.readRange(String(path), { tail: 64 })).text,
	);
	await ui("spawn", () => {
		return new Promise((resolve) => {
			let output = "";
			void kalem.process.spawn({ command: "echo tour-ok", shell: true }, (event) => {
				if (event.type === "output") output += event.text;
				if (event.type === "exit") resolve(`${output.trim()} (${event.code})`);
			});
		});
	});
	await ui("status", async () => {
		await kalem.ui.setStatusItem("tour", { text: "Tour ✓", tooltip: "API Tour", command: "open" });
		return "set";
	});
	await ui("post", async () => {
		await kalem.ui.post({ type: "pushed", text: "from the host" });
		return "posted";
	});
	await kalem.commands.register("open", () => kalem.ui.showPane("tour"));
	await kalem.assistant.registerTool(
		{
			name: "tour_greeting",
			description: "The API Tour's greeting setting.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		async () => (await kalem.settings.all()).greeting,
	);
}
