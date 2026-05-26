// Entry for the Hello plugin's admin panel, authored in React + TypeScript with
// @pressh/panel-kit and bundled into ../panel.js by `pressh-build-panel`.
//
//   npx pressh-build-panel plugins/hello/panel-src/main.tsx --out plugins/hello/panel.js
//
// (In this repo: `npm run build:hello`.) For a SIGNED plugin, keep this source
// OUTSIDE the shipped plugin folder — only the built panel.js is signed.
import {StrictMode} from "react";
import {mountPanel} from "@pressh/panel-kit";
import {App} from "./App";
import "./styles.css";

mountPanel(
    <StrictMode>
        <App/>
    </StrictMode>,
);
