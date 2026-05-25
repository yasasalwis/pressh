import {hydrateRoot} from "react-dom/client";
import {Blocks} from "../components/Blocks";
import type {PageData} from "../components/Page";
import {initStorefront} from "./storefront";

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
