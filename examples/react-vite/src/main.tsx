import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// `StrictMode` bilerek açık: React 19'un geliştirme kipi her etkiyi kurup
// söküp yeniden kuruyor ve editörün bu döngüde ikiye katlanmaması,
// sarmalayıcının doğruluk ölçütlerinden biri (F5-01).
createRoot(document.getElementById("kok") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
