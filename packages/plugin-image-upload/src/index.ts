/**
 * `@kalem-editor/plugin-image-upload` — Görsel yükleme eklentisi  (İş listesi: F4-01)
 *
 * Sürükleyerek ya da yapıştırarak görsel eklemek. Ağ hakkında hiçbir şey
 * bilmiyor: dosyayı `upload` kancasına veriyor, dönen adresi belgeye
 * yazıyor.
 *
 * Stiller ayrı: `@kalem-editor/themes/plugin-image.css`.
 *
 * @module @kalem-editor/plugin-image-upload
 */
export type { AltEditor, AltEditorOptions } from "./alt-editor.js";
export { createAltEditor } from "./alt-editor.js";
export type { ImageLabels } from "./labels.js";
export { enImageLabels, labelsFor, trImageLabels } from "./labels.js";
export type { AcceptOptions, RejectReason } from "./model.js";
export {
	altFromFilename,
	imageAltAt,
	imageUrls,
	insertImage,
	rejectionOf,
	removeImage,
	replaceImageUrl,
	setImageAlt,
} from "./model.js";
export type {
	ImageUploadOptions,
	ImageUploadPlugin,
	PendingUpload,
	UploadResult,
	UploadTask,
} from "./plugin.js";
export { imageUploadPlugin } from "./plugin.js";
