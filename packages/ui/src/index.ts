/**
 * @kalem/ui — Word benzeri arayüz katmanı
 *
 * Editör başsız; görünen her şey burada. Bağlantı yönü tek: arayüz
 * editörü tanıyor, editör arayüzü tanımıyor.
 *
 * Stiller ayrı: `@kalem/themes/ui.css`.
 */
export type { BubbleToolbar, BubbleToolbarOptions } from "./bubble-toolbar.js";
export { createBubbleToolbar } from "./bubble-toolbar.js";
export type { ButtonOptions, ElementOptions } from "./dom.js";
export { button, el, icon } from "./dom.js";
export type { FloatingOptions, FloatingResult, Placement } from "./floating.js";
export { computePosition, position, selectionRect } from "./floating.js";
export type { UiLabels } from "./labels.js";
export { enLabels, labelsFor, trLabels } from "./labels.js";
export type { LinkPopover, LinkPopoverOptions } from "./link-popover.js";
export { createLinkPopover, normalizeUrl } from "./link-popover.js";
export type { Placeholder, PlaceholderOptions } from "./placeholder.js";
export { createPlaceholder } from "./placeholder.js";
export { foldForSearch, matches, score } from "./search.js";
export type { SlashItem, SlashMenu, SlashMenuOptions } from "./slash-menu.js";
export { createSlashMenu } from "./slash-menu.js";
export type { Ui, UiOptions } from "./ui.js";
export { mountUi } from "./ui.js";
