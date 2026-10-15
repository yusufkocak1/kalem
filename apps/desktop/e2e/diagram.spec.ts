import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { parseDiagram } from "../src/shared/diagram.js";
import { readPngText } from "../src/shared/png-text.js";
import { clickMenu, launch, stubSaveDialog, tempDir } from "./launch.js";

/** The diagram in the data file next to a picture. */
const diagramIn = async (picture: string) =>
	parseDiagram(await readFile(picture.replace(/\.png$/, ".json"), "utf8"));

test("draws a flow diagram into a Markdown file and edits it again", async () => {
	const folder = await tempDir("kalem-diagram-");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n\nGiriş\n");
	const { app, page, errors } = await launch({ args: [doc] });

	await page.locator("#editor p", { hasText: "Giriş" }).click();
	await page.keyboard.press("End");
	await clickMenu(app, "Insert", "Diagram…");
	const editor = page.locator(".diagram-editor");
	await expect(editor).toBeVisible();
	await expect(editor.locator(".diagram-status")).toContainText("Drag a shape");
	const canvas = editor.locator(".diagram-canvas");
	const nodes = canvas.locator(".kd-node");
	const edges = canvas.locator(".kd-edge");

	// Dragged from the palette onto the canvas.
	await editor
		.locator('[data-shape="terminal"]')
		.dragTo(canvas, { targetPosition: { x: 300, y: 80 } });
	await expect(nodes).toHaveCount(1);
	await expect(nodes.first()).toContainText("Start / End");

	// Selected, a click on the palette adds the next step below it, connected.
	await nodes.first().click();
	await editor.locator('[data-shape="decision"]').click();
	await expect(nodes).toHaveCount(2);
	await expect(edges).toHaveCount(1);
	await editor.locator('[data-shape="process"]').click();
	await expect(nodes).toHaveCount(3);
	await expect(edges).toHaveCount(2);

	// Double-click writes in a shape.
	await canvas.locator('[data-node="n2"]').dblclick();
	const text = editor.locator(".diagram-text-edit");
	await expect(text).toBeFocused();
	await text.fill("Kayıt var mı?");
	await text.press("Enter");
	// Wrapped to the diamond: one line per tspan.
	await expect(canvas.locator('[data-node="n2"] tspan')).toHaveText(["Kayıt var", "mı?"]);

	// Dragging from a connection point to another shape connects them.
	await canvas.locator('[data-node="n1"]').click();
	const port = canvas.locator('.diagram-port[data-port="n1"]').nth(1);
	const portBox = await port.boundingBox();
	const targetBox = await canvas.locator('[data-node="n3"]').boundingBox();
	if (portBox === null || targetBox === null) throw new Error("not laid out");
	await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
		steps: 5,
	});
	await page.mouse.up();
	await expect(edges).toHaveCount(3);

	// Undo and redo.
	await page.keyboard.press("Control+z");
	await expect(edges).toHaveCount(2);
	await page.keyboard.press("Control+y");
	await expect(edges).toHaveCount(3);

	await editor.getByRole("textbox", { name: "Diagram name" }).fill("Sipariş akışı");
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();

	// The picture is in the document, its file next to it with the data inside.
	const image = page.locator("#editor img");
	await expect(image).toHaveAttribute(
		"src",
		"notlar.assets/Sipari%C5%9F-ak%C4%B1%C5%9F%C4%B1.diagram.png",
	);
	await expect
		.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBeGreaterThan(100);
	const file = join(folder, "notlar.assets", "Sipariş-akışı.diagram.png");
	const saved = await diagramIn(file);
	expect(saved?.nodes.map((node) => node.text)).toEqual(["Start / End", "Kayıt var mı?", "Step"]);
	expect(saved?.edges).toHaveLength(3);
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	// A paragraph of its own, below the one the cursor was in.
	expect(await readFile(doc, "utf8")).toContain(
		"Giriş\n\n![Sipariş akışı](notlar.assets/Sipari%C5%9F-ak%C4%B1%C5%9F%C4%B1.diagram.png)",
	);

	// The picture also carries a copy of the data, for when the JSON gets lost.
	expect(readPngText(new Uint8Array(await readFile(file)), "kalem-diagram")).toContain(
		"Kayıt var mı?",
	);

	// The button over the picture opens it again, from its JSON file.
	const json = file.replace(/\.png$/, ".json");
	await writeFile(json, (await readFile(json, "utf8")).replace("Start / End", "Başla"));
	const height = await image.evaluate((img: HTMLImageElement) => img.naturalHeight);
	await image.hover();
	await page.getByRole("button", { name: "✎ Edit Diagram" }).click();
	await expect(editor).toBeVisible();
	await expect(nodes).toHaveCount(3);
	await expect(canvas.locator('[data-node="n1"]')).toContainText("Başla");
	await expect(editor.getByRole("textbox", { name: "Diagram name" })).toBeDisabled();
	await canvas.locator('[data-node="n3"]').click();
	await page.keyboard.press("Delete");
	await expect(nodes).toHaveCount(2);
	await expect(edges).toHaveCount(1);
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	expect((await diagramIn(file))?.nodes).toHaveLength(2);
	// The document shows the new drawing, which is shorter without the last step.
	await expect
		.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalHeight))
		.toBeLessThan(height);
	expect(errors).toEqual([]);
	await app.close();
});

test("asks before closing a diagram with changes", async () => {
	const { app, page, errors } = await launch();
	await clickMenu(app, "Insert", "Diagram…");
	const editor = page.locator(".diagram-editor");
	await editor.locator('[data-shape="process"]').click();
	await expect(editor.locator(".kd-node")).toHaveCount(1);

	page.once("dialog", (dialog) => void dialog.dismiss());
	await editor.getByRole("button", { name: "Cancel" }).click();
	await expect(editor).toBeVisible();
	page.once("dialog", (dialog) => void dialog.accept());
	await editor.getByRole("button", { name: "Cancel" }).click();
	await expect(editor).toBeHidden();
	await expect(page.locator("#editor img")).toHaveCount(0);
	expect(errors).toEqual([]);
	await app.close();
});

test("keeps a package's diagram inside the package", async () => {
	const folder = await tempDir("kalem-diagram-package-");
	const path = join(folder, "Plan.kmd");
	const { app, page, errors } = await launch();
	await page.locator("#editor p").first().click();
	await page.keyboard.type("Plan");
	await stubSaveDialog(app, path);
	await clickMenu(app, "File", "Save as Package…");
	await expect(page.locator(".save-status")).toHaveText("Saved");

	const editor = page.locator(".diagram-editor");
	await clickMenu(app, "Insert", "Diagram…");
	await editor.locator('[data-shape="process"]').click();
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(page.locator("#editor img")).toHaveAttribute("src", "assets/Diagram.diagram.png");
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");

	// The picture and its JSON are both in the package.
	const packed = async () => {
		const zip = await JSZip.loadAsync(await readFile(path));
		expect(zip.file("assets/Diagram.diagram.png")).not.toBeNull();
		const text = await zip.file("assets/Diagram.diagram.json")?.async("string");
		return text === undefined ? null : parseDiagram(text)?.nodes.length;
	};
	expect(await packed()).toBe(1);

	// An edit changes only the picture; the package still has to be saved to keep it.
	await page.locator("#editor img").dblclick();
	await expect(editor).toBeVisible();
	await editor.locator('[data-shape="decision"]').click();
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(page.locator(".save-status")).toHaveText("Unsaved");
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	expect(await packed()).toBe(2);
	expect(errors).toEqual([]);
	await app.close();
});
