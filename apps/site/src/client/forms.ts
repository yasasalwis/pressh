// Progressive enhancement for designer-placed forms wired to the Forms plugin
// (the `form` primitive with `submitTo:"forms"` emits `[data-ps-form]`). The
// site CSP forbids inline JS, so this lives in the bundled client. It serializes
// the form's inputs to JSON and POSTs /api/p/forms/submit, then shows an inline
// status message — no page navigation.
import "./forms.css";

interface Serialized {
    fields: Record<string, unknown>;
    hp: string;
}

function serialize(form: HTMLFormElement): Serialized {
    const fields: Record<string, unknown> = {};
    let hp = "";
    for (const el of Array.from(form.elements)) {
        const input = el as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
        const name = input.name;
        if (!name) continue;
        if (name === "_hp") {
            hp = input.value;
            continue;
        }
        const type = (input.getAttribute("type") ?? "").toLowerCase();
        if (input.tagName === "BUTTON" || type === "submit" || type === "button") continue;
        if (type === "checkbox") {
            fields[name] = (input as HTMLInputElement).checked;
        } else {
            fields[name] = input.value;
        }
    }
    return {fields, hp};
}

function showMessage(form: HTMLFormElement, text: string, ok: boolean): void {
    let msg = form.querySelector<HTMLElement>(".ps-form-msg");
    if (!msg) {
        msg = document.createElement("p");
        msg.className = "ps-form-msg";
        form.appendChild(msg);
    }
    msg.textContent = text;
    msg.classList.toggle("ps-form-msg--ok", ok);
    msg.classList.toggle("ps-form-msg--err", !ok);
}

async function submitForm(form: HTMLFormElement): Promise<void> {
    const formId = form.getAttribute("data-ps-form-id") || "default";
    const {fields, hp} = serialize(form);
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"],[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const body: Record<string, unknown> = {formId, fields, _hp: hp};
    if (typeof fields["email"] === "string" && fields["email"]) body["subjectRef"] = fields["email"];
    if (fields["consent"] === true) body["consent"] = true;

    try {
        const res = await fetch("/api/p/forms/submit", {
            method: "POST",
            credentials: "same-origin",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(body),
        });
        if (res.ok) {
            form.reset();
            showMessage(form, "Thanks — your message has been sent.", true);
        } else {
            showMessage(form, "Sorry, something went wrong. Please try again.", false);
        }
    } catch {
        showMessage(form, "Sorry, something went wrong. Please try again.", false);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

export function initForms(): void {
    document.querySelectorAll<HTMLFormElement>("form[data-ps-form]").forEach((form) => {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            void submitForm(form);
        });
    });
}
