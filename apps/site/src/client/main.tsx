import {hydrateRoot} from "react-dom/client";
import {Blocks} from "../components/Blocks";
import type {PageData} from "../components/Page";
import {initStorefront} from "./storefront";
import {initConsentBanner} from "./consent";
import {initForms} from "./forms";

const dataEl = document.getElementById("pressh-data");
if (dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as PageData;
  const root = document.getElementById("root");
  if (root) {
    hydrateRoot(root, <Blocks blocks={data.blocks} />);
  }
}

// Progressive enhancement for inventory storefront widgets (cart/checkout).
// No-ops when no commerce widgets are present on the page.
initStorefront();

// Cookie-consent banner — no-op unless the operator enabled it (no #pressh-consent).
initConsentBanner();

// Designer-placed forms wired to the Forms plugin (no-op when no [data-ps-form]).
initForms();
