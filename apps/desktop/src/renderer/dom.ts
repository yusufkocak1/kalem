export interface ElementOptions {
	readonly class?: string;
	readonly text?: string;
	readonly attrs?: Readonly<Record<string, string>>;
	readonly children?: readonly (Node | string)[];
}

// No innerHTML anywhere: file names, paths and error messages end up in these elements.
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (options.class !== undefined) element.className = options.class;
	if (options.text !== undefined) element.textContent = options.text;
	for (const [name, value] of Object.entries(options.attrs ?? {})) {
		element.setAttribute(name, value);
	}
	if (options.children !== undefined) element.append(...options.children);
	return element;
}

export function isTextFieldFocused(): boolean {
	const active = document.activeElement;
	return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}
