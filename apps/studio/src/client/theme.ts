export function toggleTheme(): void {
    const next = document.documentElement.dataset["theme"] === "dark" ? "light" : "dark";
    document.documentElement.dataset["theme"] = next;
    localStorage.setItem("pressh-theme", next);
}
