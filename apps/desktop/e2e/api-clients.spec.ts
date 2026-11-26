import { expect, test } from "@playwright/test";
import { fakeApi, fakeSoap, installSample } from "./api-fakes.js";
import { launch } from "./launch.js";

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

test("the REST client sends requests with an environment's variables and auth, shows the response, and keeps them", async () => {
	const api = await fakeApi();
	cleanup.push(api.close);
	const { app, page, errors } = await launch();
	await page.setViewportSize({ width: 1400, height: 900 });
	const rest = await installSample(app, page, "rest-client", "client", "REST");

	await expect(rest.locator(".k-empty")).toContainText("Send a request");
	await rest.getByRole("button", { name: "Environments" }).click();
	const dialog = rest.locator(".rest-dialog");
	await dialog.getByRole("button", { name: "Add environment" }).click();
	await dialog.locator('input[data-col="name"]').fill("Local");
	await dialog.locator('.k-kv input[data-col="key"]').first().fill("baseUrl");
	await dialog.locator('.k-kv input[data-col="value"]').first().fill(api.url);
	await dialog.getByRole("button", { name: "Done" }).click();
	await expect(rest.locator(".rest-env")).toHaveValue(/.+/);

	await rest.getByLabel("URL").fill("{{baseUrl}}/users?page=2");
	await expect(rest.locator('.k-tab[data-tab="params"] .k-tab-count')).toHaveText("1");
	await expect(rest.locator('.k-kv input[data-col="key"]').first()).toHaveValue("page");
	await rest.getByRole("tab", { name: /Auth/ }).click();
	await rest.getByRole("button", { name: "Bearer" }).click();
	await rest.locator(".rest-auth input").fill("s3cret");
	await rest.getByRole("button", { name: "Send" }).click();

	await expect(rest.locator(".rest-status")).toHaveText("200 OK");
	await expect(rest.locator(".rest-response")).toContainText('"name": "Ayşe Yılmaz"');
	await expect(rest.locator(".rest-response .tok-key").first()).toHaveText('"page"');
	await expect(rest.locator(".rest-response .tok-literal").first()).toHaveText("true");
	expect(api.seen.at(-1)).toMatchObject({ method: "GET", url: "/users?page=2" });
	expect(api.seen.at(-1)?.headers.authorization).toBe("Bearer s3cret");
	await rest
		.getByRole("tab", { name: /Headers/ })
		.last()
		.click();
	await expect(rest.locator(".rest-headers")).toContainText("x-request-id");

	await rest.locator(".rest-name").fill("Kullanıcılar");
	await rest.getByRole("button", { name: "Save" }).click();
	await expect(rest.locator('.rest-list [data-request="Kullanıcılar"]')).toBeVisible();

	await rest.getByRole("button", { name: "New request" }).click();
	await rest.getByLabel("Method").selectOption("POST");
	await rest.getByLabel("URL").fill("{{baseUrl}}/users");
	await rest.getByRole("tab", { name: /Body/ }).click();
	await rest.getByRole("button", { name: "JSON" }).click();
	await rest.locator(".rest-body").fill('{"name":"Zeynep","role":"admin"}');
	await rest.getByRole("button", { name: "Send" }).click();
	await expect(rest.locator(".rest-status")).toHaveText("201 Created");
	await expect(rest.locator(".rest-response")).toContainText('"id": 42');
	expect(api.seen.at(-1)?.headers["content-type"]).toBe("application/json");
	expect(JSON.parse(api.seen.at(-1)?.body ?? "{}")).toEqual({ name: "Zeynep", role: "admin" });

	await rest.getByRole("button", { name: "History" }).click();
	await expect(rest.locator(".rest-history")).toHaveCount(2);
	await rest.getByRole("button", { name: "Collection" }).click();
	await rest.locator('.rest-list [data-request="Kullanıcılar"]').click();
	await expect(rest.getByLabel("URL")).toHaveValue("{{baseUrl}}/users?page=2");
	expect(errors).toEqual([]);
});

test("the SOAP client reads a WSDL, makes sample requests from its schema, and calls it over SOAP 1.1 and 1.2", async () => {
	const soap = await fakeSoap();
	cleanup.push(soap.close);
	const { app, page, errors } = await launch();
	await page.setViewportSize({ width: 1400, height: 900 });
	const client = await installSample(app, page, "soap-client", "client", "SOAP");

	await expect(client.locator(".soap-side")).toContainText("Load a WSDL");
	await client.getByLabel("WSDL address").fill(soap.wsdl);
	await client.getByRole("button", { name: "Load" }).click();
	await expect(client.locator(".soap-wsdl-head")).toContainText("Calculator");
	await expect(client.locator(".soap-port-head")).toHaveCount(2);
	await expect(client.locator(".soap-port-head").nth(1)).toContainText("SOAP 1.2");

	await client.locator('.soap-ops [data-operation="CreateOrder"]').first().click();
	const editor = client.locator(".soap-editor-input");
	await expect(editor).toHaveValue(/<ns1:CreateOrder>/);
	const sample = await editor.inputValue();
	expect(sample).toContain('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"');
	expect(sample).toContain('xmlns:ns1="http://acme.example/calc"');
	expect(sample).toContain("<ns1:customer>");
	expect(sample).toContain("<!--Optional:-->");
	expect(sample).toContain("<!--Zero or more repetitions:-->");
	expect(sample).toContain("<ns1:quantity>0</ns1:quantity>");
	expect(sample).toContain("<ns1:priority>low</ns1:priority>");
	expect(sample).toContain("<ns1:dueDate>2026-01-01</ns1:dueDate>");
	await expect(client.locator(".soap-editor-shade .tok-tag").first()).toBeVisible();

	await client.locator('.soap-ops [data-operation="Add"]').first().click();
	const add = (await editor.inputValue())
		.replace("<ns1:intA>0</ns1:intA>", "<ns1:intA>2</ns1:intA>")
		.replace("<ns1:intB>0</ns1:intB>", "<ns1:intB>3</ns1:intB>");
	await editor.fill(add);
	await client.getByRole("button", { name: "Send" }).click();
	await expect(client.locator(".soap-status")).toHaveText("200 OK");
	await expect(client.locator(".soap-response")).toContainText("<AddResult>5</AddResult>");
	expect(soap.seen.at(-1)?.headers.soapaction).toBe('"http://acme.example/calc/Add"');
	expect(soap.seen.at(-1)?.headers["content-type"]).toBe("text/xml; charset=utf-8");

	await client.locator(".soap-ops").nth(1).locator('[data-operation="Divide"]').click();
	await expect(client.locator(".soap-version")).toHaveValue("1.2");
	await expect(editor).toHaveValue(/www\.w3\.org\/2003\/05\/soap-envelope/);
	await client.getByRole("button", { name: "Send" }).click();
	await expect(client.locator(".soap-status")).toHaveText("500 Internal Server Error");
	await expect(client.locator(".soap-fault")).toContainText("Division by zero");
	expect(soap.seen.at(-1)?.headers["content-type"]).toBe(
		'application/soap+xml; charset=utf-8; action="http://acme.example/calc/Divide"',
	);
	expect(errors).toEqual([]);
});
