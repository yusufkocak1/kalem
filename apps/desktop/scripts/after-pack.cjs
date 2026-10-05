// Drops Chromium files Kalem never loads. dxcompiler/dxil compile WebGPU
// shaders on Direct3D 12; the app uses no WebGPU, and WebGL goes through
// d3dcompiler_47, which stays.
const { rm } = require("node:fs/promises");
const { join } = require("node:path");

const UNUSED_ON_WINDOWS = ["dxcompiler.dll", "dxil.dll"];

exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "win32") return;
	for (const name of UNUSED_ON_WINDOWS) {
		await rm(join(context.appOutDir, name), { force: true });
	}
};
