import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App";
import {ToastProvider} from "./components/ui";
import "./styles.css";

// Apply the saved/system theme before first paint (mirrors the legacy client).
(function initTheme() {
    const saved = localStorage.getItem("pressh-theme");
    const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme:dark)").matches;
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
})();

const el = document.getElementById("pressh-admin-root");
if (el) {
    createRoot(el).render(
        <StrictMode>
            <ToastProvider>
                <App/>
            </ToastProvider>
        </StrictMode>,
    );
}
