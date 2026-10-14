import type { Root } from "@kalem-editor/core";
import type { ConfluenceAttachment, ConfluenceUpload } from "../shared/bridge.js";
import { attachmentName, fileUrl } from "../shared/confluence-common.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { extension } from "../shared/paths.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface AttachmentsOptions {
	readonly t: Strings;
	readonly lang: string;
	pathForFile(file: File): string;
	errorText(error: unknown): string;
}

/** The page whose attachments the dialog shows. */
export interface AttachmentSource {
	readonly title: string;
	list(): Promise<readonly ConfluenceAttachment[]>;
	upload(paths?: readonly string[]): Promise<readonly ConfluenceUpload[]>;
	open(name: string): Promise<void>;
	download(name: string): Promise<string | null>;
	remove(attachment: ConfluenceAttachment, used: boolean): Promise<boolean>;
	/** Links the attachment in the document; `false` when that is not possible. */
	insert(upload: ConfluenceUpload): boolean;
	/** Names of the attachments the document links to. */
	linked(): ReadonlySet<string>;
	/** A URL the image can be shown from. */
	preview(name: string): string;
}

/** Attachment names the document links to or shows. */
export function linkedAttachments(doc: Root): Set<string> {
	const names = new Set<string>();
	const visit = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const { type, url, children } = node as { type?: string; url?: unknown; children?: unknown };
		if ((type === "link" || type === "image") && typeof url === "string") {
			const name = attachmentName(url);
			if (name !== null) names.add(name);
		}
		if (Array.isArray(children)) for (const child of children) visit(child);
	};
	visit(doc);
	return names;
}

const IMAGE = /^(png|jpe?g|gif|webp|avif|svg)$/;

/** Lists, uploads, opens, downloads and deletes the files attached to a Confluence page. */
export function createAttachmentsDialog(options: AttachmentsOptions): {
	/** `filter` starts the list filtered, e.g. to the attachment a link points to. */
	show(source: AttachmentSource, filter?: string): Promise<void>;
} {
	const { t } = options;
	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const number = new Intl.NumberFormat(options.lang, { maximumFractionDigits: 1 });

	const title = el("h2", { class: "attachments-title" });
	const filter = el("input", {
		class: "attachments-filter",
		attrs: {
			type: "search",
			placeholder: t.confluenceAttachmentsFilter,
			"aria-label": t.confluenceAttachmentsFilter,
		},
	});
	const upload = el("button", {
		class: "dialog-button primary",
		text: t.confluenceUpload,
		attrs: { type: "button" },
	});
	const message = el("p", { class: "attachments-message", attrs: { role: "status" } });
	const list = el("ul", {
		class: "attachments-list",
		attrs: { "aria-label": t.confluenceAttachments },
	});
	const close = el("button", { class: "dialog-button", text: t.close, attrs: { type: "button" } });
	const dialog = el("dialog", {
		class: "attachments",
		children: [
			title,
			el("div", { class: "attachments-toolbar", children: [filter, upload] }),
			message,
			list,
			el("div", { class: "attachments-actions", children: [close] }),
		],
	});
	document.body.append(dialog);

	let source: AttachmentSource | null = null;
	let files: readonly ConfluenceAttachment[] = [];
	let busy = false;

	function say(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function size(bytes: number | null): string {
		if (bytes === null) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
		return `${number.format(bytes / 1024 / 1024)} MB`;
	}

	/** Runs one request at a time; its failure is shown in the dialog. */
	async function run(task: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		dialog.setAttribute("aria-busy", "true");
		upload.disabled = true;
		try {
			await task();
		} catch (error) {
			say(format(t.confluenceRequestFailed, options.errorText(error)));
		} finally {
			busy = false;
			dialog.removeAttribute("aria-busy");
			upload.disabled = false;
		}
	}

	function button(label: string, action: () => void, hint?: string): HTMLButtonElement {
		const element = el("button", {
			class: "attachments-button",
			text: label,
			attrs: { type: "button", ...(hint === undefined ? {} : { title: hint }) },
		});
		element.addEventListener("click", action);
		return element;
	}

	function render(): void {
		const query = filter.value.trim().toLocaleLowerCase(options.lang);
		const linked = source?.linked() ?? new Set<string>();
		const shown = files.filter((file) => file.name.toLocaleLowerCase(options.lang).includes(query));
		list.replaceChildren(
			...shown.map((file) => {
				const used = linked.has(file.name);
				const ext = extension(file.name);
				const thumb = el("div", { class: "attachments-thumb", attrs: { "aria-hidden": "true" } });
				if (IMAGE.test(ext) && source !== null) {
					thumb.append(
						el("img", { attrs: { src: source.preview(file.name), alt: "", loading: "lazy" } }),
					);
				} else {
					thumb.append(
						icon("file"),
						el("span", { class: "attachments-ext", text: ext.slice(0, 4) }),
					);
				}
				const meta = [
					size(file.size),
					file.modified === null ? "" : dateFormat.format(file.modified),
					file.author,
					format(t.confluenceAttachmentVersion, file.version),
				].filter((part) => part !== "");
				const upload: ConfluenceUpload = {
					name: file.name,
					url: fileUrl(file.name),
					image: file.mediaType.startsWith("image/") || IMAGE.test(ext),
				};
				return el("li", {
					class: "attachments-item",
					attrs: { "data-name": file.name },
					children: [
						thumb,
						el("div", {
							class: "attachments-text",
							children: [
								el("span", { class: "attachments-name", text: file.name }),
								el("span", {
									class: "attachments-meta",
									children: [
										meta.join(" · "),
										...(used
											? [
													el("span", {
														class: "attachments-used",
														text: t.confluenceAttachmentUsed,
														attrs: { title: t.confluenceAttachmentUsedHint },
													}),
												]
											: []),
									],
								}),
							],
						}),
						el("div", {
							class: "attachments-buttons",
							children: [
								button(
									t.confluenceAttachmentInsert,
									() => {
										if (source?.insert(upload) === true) dialog.close();
									},
									t.confluenceAttachmentInsertHint,
								),
								button(
									t.confluenceAttachmentOpen,
									() =>
										void run(async () => {
											say("");
											await source?.open(file.name);
										}),
								),
								button(
									t.confluenceAttachmentDownload,
									() =>
										void run(async () => {
											const path = await source?.download(file.name);
											say(path == null ? "" : format(t.confluenceAttachmentSaved, path));
										}),
								),
								button(
									t.confluenceAttachmentDelete,
									() =>
										void run(async () => {
											if (source === null || !(await source.remove(file, used))) return;
											say("");
											await load();
										}),
								),
							],
						}),
					],
				});
			}),
		);
		if (files.length === 0) say(t.confluenceAttachmentsEmpty);
		else if (shown.length === 0) say(t.confluenceAttachmentsNoMatch);
		else if (
			message.textContent === t.confluenceAttachmentsEmpty ||
			message.textContent === t.confluenceAttachmentsNoMatch
		)
			say("");
	}

	async function load(): Promise<void> {
		const current = source;
		if (current === null) return;
		const next = await current.list();
		if (current !== source) return;
		files = next;
		render();
	}

	function uploadPaths(paths?: readonly string[]): void {
		void run(async () => {
			say(t.confluenceUploading);
			const uploaded = await source?.upload(paths);
			say("");
			if (uploaded !== undefined && uploaded.length > 0) await load();
		});
	}

	filter.addEventListener("input", render);
	upload.addEventListener("click", () => uploadPaths());
	close.addEventListener("click", () => dialog.close());
	dialog.addEventListener("dragover", (event) => {
		if (event.dataTransfer?.types.includes("Files") !== true) return;
		event.preventDefault();
		dialog.classList.add("dropping");
	});
	dialog.addEventListener("dragleave", (event) => {
		if (event.target === dialog) dialog.classList.remove("dropping");
	});
	dialog.addEventListener("drop", (event) => {
		dialog.classList.remove("dropping");
		const paths = Array.from(event.dataTransfer?.files ?? [])
			.map((file) => options.pathForFile(file))
			.filter((path) => path !== "");
		event.preventDefault();
		event.stopPropagation();
		if (paths.length > 0) uploadPaths(paths);
	});

	return {
		async show(next, initial = "") {
			source = next;
			files = [];
			filter.value = initial;
			title.textContent = format(t.confluenceAttachmentsTitle, next.title);
			list.replaceChildren();
			say(t.confluenceAttachmentsLoading);
			if (!dialog.open) dialog.showModal();
			filter.focus();
			await run(load);
		},
	};
}
