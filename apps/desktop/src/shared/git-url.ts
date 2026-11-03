/** Repository URLs, checked the same way in the page and the main process. */

/** The folder name `git clone` would pick for `url`. */
export function repositoryName(url: string): string {
	const clean = url
		.trim()
		.replace(/[\\/]+$/, "")
		.replace(/\.git$/i, "");
	const name = clean.split(/[\\/:]/).at(-1) ?? "";
	return name === "" ? "repository" : name;
}

/** A URL `git clone` takes: https, ssh, git or scp-like `user@host:path`. */
export function isCloneUrl(url: string): boolean {
	const value = url.trim();
	// An option, not a URL: nothing that starts with `-` reaches git.
	if (value === "" || value.startsWith("-") || /\s/.test(value)) return false;
	return (
		/^(https?|ssh|git):\/\/[^/]+\/.+/i.test(value) ||
		/^file:\/\/\/?.+/i.test(value) ||
		/^[\w.-]+@[\w.-]+:.+/.test(value)
	);
}
