import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { clickMenu, stubOpenDialog, tempDir } from "./launch.js";

const PACK = join(import.meta.dirname, "..", "scripts", "pack-extension.mjs");
const SAMPLES = join(import.meta.dirname, "..", "extension-samples");

export interface Seen {
	readonly method: string;
	readonly url: string;
	readonly headers: Record<string, string | string[] | undefined>;
	readonly body: string;
}

export async function fakeApi() {
	const seen: Seen[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			seen.push({
				method: request.method ?? "",
				url: request.url ?? "",
				headers: request.headers,
				body,
			});
			const url = new URL(request.url ?? "/", "http://api");
			const json = (status: number, value: unknown): void => {
				response.writeHead(status, {
					"Content-Type": "application/json; charset=utf-8",
					"X-Request-Id": "r-1",
				});
				response.end(JSON.stringify(value));
			};
			if (url.pathname === "/users" && request.method === "GET") {
				if (request.headers.authorization !== "Bearer s3cret")
					return json(401, { error: "unauthorized" });
				return json(200, {
					page: Number(url.searchParams.get("page") ?? 1),
					users: [
						{ id: 1, name: "Ayşe Yılmaz", active: true, score: 9.5 },
						{ id: 2, name: "Mehmet Kaya", active: false, score: null },
					],
				});
			}
			if (url.pathname === "/users" && request.method === "POST") {
				return json(201, { id: 42, ...JSON.parse(body || "{}") });
			}
			json(404, { error: "not found" });
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		seen,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

export function calculatorWsdl(endpoint: string): string {
	const binding = (name: string, soap: string, version: string) => `
  <wsdl:binding name="${name}" type="tns:CalculatorPortType">
    <${soap}:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    ${["Add", "Divide", "CreateOrder"]
			.map(
				(operation) => `<wsdl:operation name="${operation}">
      <${soap}:operation soapAction="http://acme.example/calc/${operation}"${version === "1.2" ? "" : ' style="document"'}/>
      <wsdl:input><${soap}:body use="literal"/></wsdl:input>
      <wsdl:output><${soap}:body use="literal"/></wsdl:output>
    </wsdl:operation>`,
			)
			.join("\n    ")}
  </wsdl:binding>`;
	return `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions name="Calculator" targetNamespace="http://acme.example/calc"
    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:tns="http://acme.example/calc">
  <wsdl:types>
    <xs:schema targetNamespace="http://acme.example/calc" elementFormDefault="qualified">
      <xs:element name="Add"><xs:complexType><xs:sequence>
        <xs:element name="intA" type="xs:int"/><xs:element name="intB" type="xs:int"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:element name="AddResponse"><xs:complexType><xs:sequence><xs:element name="AddResult" type="xs:int"/></xs:sequence></xs:complexType></xs:element>
      <xs:element name="Divide"><xs:complexType><xs:sequence>
        <xs:element name="intA" type="xs:int"/><xs:element name="intB" type="xs:int"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:element name="DivideResponse"><xs:complexType><xs:sequence><xs:element name="DivideResult" type="xs:int"/></xs:sequence></xs:complexType></xs:element>
      <xs:complexType name="Customer"><xs:sequence>
        <xs:element name="name" type="xs:string"/><xs:element name="email" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:simpleType name="Priority"><xs:restriction base="xs:string">
        <xs:enumeration value="low"/><xs:enumeration value="high"/>
      </xs:restriction></xs:simpleType>
      <xs:element name="CreateOrder"><xs:complexType><xs:sequence>
        <xs:element name="customer" type="tns:Customer"/>
        <xs:element name="item" maxOccurs="unbounded"><xs:complexType><xs:sequence>
          <xs:element name="sku" type="xs:string"/><xs:element name="quantity" type="xs:int"/>
        </xs:sequence></xs:complexType></xs:element>
        <xs:element name="priority" type="tns:Priority"/>
        <xs:element name="dueDate" type="xs:date"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:element name="CreateOrderResponse"><xs:complexType><xs:sequence><xs:element name="orderId" type="xs:string"/></xs:sequence></xs:complexType></xs:element>
    </xs:schema>
  </wsdl:types>
  ${["Add", "Divide", "CreateOrder"]
		.map(
			(
				operation,
			) => `<wsdl:message name="${operation}In"><wsdl:part name="parameters" element="tns:${operation}"/></wsdl:message>
  <wsdl:message name="${operation}Out"><wsdl:part name="parameters" element="tns:${operation}Response"/></wsdl:message>`,
		)
		.join("\n  ")}
  <wsdl:portType name="CalculatorPortType">
    ${["Add", "Divide", "CreateOrder"]
			.map(
				(operation) =>
					`<wsdl:operation name="${operation}"><wsdl:documentation>${operation === "Add" ? "Adds two integers." : operation === "Divide" ? "Divides intA by intB." : "Places an order."}</wsdl:documentation><wsdl:input message="tns:${operation}In"/><wsdl:output message="tns:${operation}Out"/></wsdl:operation>`,
			)
			.join("\n    ")}
  </wsdl:portType>
  ${binding("CalculatorSoap", "soap", "1.1")}
  ${binding("CalculatorSoap12", "soap12", "1.2")}
  <wsdl:service name="Calculator">
    <wsdl:port name="CalculatorSoap" binding="tns:CalculatorSoap"><soap:address location="${endpoint}"/></wsdl:port>
    <wsdl:port name="CalculatorSoap12" binding="tns:CalculatorSoap12"><soap12:address location="${endpoint}"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

export async function fakeSoap() {
	const seen: Seen[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			seen.push({
				method: request.method ?? "",
				url: request.url ?? "",
				headers: request.headers,
				body,
			});
			const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/calc`;
			if (request.method === "GET") {
				response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
				response.end(calculatorWsdl(endpoint));
				return;
			}
			const soap12 = String(request.headers["content-type"]).startsWith("application/soap+xml");
			const env = soap12
				? "http://www.w3.org/2003/05/soap-envelope"
				: "http://schemas.xmlsoap.org/soap/envelope/";
			const number = (name: string): number =>
				Number(new RegExp(`<[^>]*${name}>\\s*(-?\\d+)`).exec(body)?.[1] ?? Number.NaN);
			const reply = (status: number, inner: string): void => {
				response.writeHead(status, {
					"Content-Type": soap12
						? "application/soap+xml; charset=utf-8"
						: "text/xml; charset=utf-8",
				});
				response.end(
					`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="${env}"><s:Body>${inner}</s:Body></s:Envelope>`,
				);
			};
			if (body.includes("Divide>") && number("intB") === 0) {
				reply(
					500,
					soap12
						? '<s:Fault><s:Code><s:Value>s:Receiver</s:Value></s:Code><s:Reason><s:Text xml:lang="en">Division by zero</s:Text></s:Reason></s:Fault>'
						: "<s:Fault><faultcode>s:Server</faultcode><faultstring>Division by zero</faultstring></s:Fault>",
				);
				return;
			}
			if (body.includes("Add>")) {
				reply(
					200,
					`<AddResponse xmlns="http://acme.example/calc"><AddResult>${number("intA") + number("intB")}</AddResult></AddResponse>`,
				);
				return;
			}
			reply(
				200,
				'<CreateOrderResponse xmlns="http://acme.example/calc"><orderId>ORD-2026-0042</orderId></CreateOrderResponse>',
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		wsdl: `${base}/calc?wsdl`,
		seen,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const WORDS = {
	en: {
		menu: "Extensions",
		manage: "Manage Extensions…",
		file: "Install from File…",
		any: "Connect to any address, from this computer",
		install: "Install",
		running: "Running",
	},
	tr: {
		menu: "Eklentiler",
		manage: "Eklentileri Yönet…",
		file: "Dosyadan Kur…",
		any: "Bu bilgisayardan her adrese bağlanır",
		install: "Kur",
		running: "Çalışıyor",
	},
};

export async function installSample(
	app: ElectronApplication,
	page: Page,
	name: string,
	pane: string,
	title: string,
	language: "en" | "tr" = "en",
): Promise<FrameLocator> {
	const words = WORDS[language];
	const packagePath = join(await tempDir(name), `${name}.kalem-ext`);
	execFileSync(process.execPath, [PACK, join(SAMPLES, name), packagePath]);
	await stubOpenDialog(app, [packagePath]);
	await clickMenu(app, words.menu, words.manage);
	const settings = page.locator('[data-block="extensions"]');
	await settings.locator(".ext-intro").getByRole("button", { name: words.file }).click();
	const preview = settings.locator(".ext-preview");
	if (name === "rest-client" || name === "soap-client")
		await expect(preview).toContainText(words.any);
	await preview.getByRole("button", { name: words.install, exact: true }).click();
	await expect(settings.locator(`.ext-card[data-extension="kalem.${name}"] .ext-badge`)).toHaveText(
		words.running,
	);
	await page.locator(`.stripe-bottom [data-pane="ext:kalem.${name}/${pane}"]`).click();
	await page.evaluate(() => {
		(document.querySelector(".tool-dock.dock-bottom") as HTMLElement).style.height = "560px";
	});
	return page.frameLocator(`iframe.ext-pane-frame[title="${title}"]`);
}
