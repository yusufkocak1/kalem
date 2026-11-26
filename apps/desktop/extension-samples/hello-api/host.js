async function status(kalem) {
	const url = await kalem.settings.get("url");
	const token = await kalem.secrets.get("token");
	const response = await kalem.http.fetch(`${url}/status`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
	if (!response.ok) throw new Error(`The API answered ${response.status} ${response.statusText}`);
	return JSON.parse(response.body);
}

export async function activate(kalem) {
	await kalem.commands.register("ping", async () => {
		const answer = await status(kalem);
		await kalem.ui.showMessage(`The API says: ${JSON.stringify(answer)}`);
	});

	await kalem.assistant.registerTool(
		{
			name: "hello_status",
			description: "Returns the status of the Hello API service as JSON.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		() => status(kalem),
	);

	kalem.log("Hello API is ready");
}
