const kalem = window.kalem;
const calls = document.getElementById("calls");
const input = document.getElementById("input");

for (const name of ["settings", "storage", "fetch", "readRange", "spawn", "status", "post"]) {
	const button = document.createElement("button");
	button.className = "k-button";
	button.type = "button";
	button.textContent = name;
	const out = document.createElement("output");
	out.id = `out-${name}`;
	button.addEventListener("click", async () => {
		try {
			out.textContent = String(await kalem.call(name, input.value));
		} catch (error) {
			out.textContent = `error: ${error.message}`;
		}
	});
	const row = document.createElement("div");
	row.className = "k-row";
	row.append(button, out);
	calls.append(row);
}

kalem.onMessage((message) => {
	if (message?.type === "pushed") document.getElementById("pushed").textContent = message.text;
});
