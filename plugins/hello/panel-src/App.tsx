import {useState} from "react";
import {request} from "@pressh/panel-kit";

interface Greeting {
    message: string;
}

export function App() {
    const [name, setName] = useState("panel");
    const [greeting, setGreeting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function greet() {
        setPending(true);
        setError(null);
        try {
            // "greet" must be listed in the plugin manifest's `panelActions`; the
            // payload becomes the handler's `args`. See plugins/hello/index.mjs.
            const res = await request<Greeting>("greet", {name});
            setGreeting(res.message);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setPending(false);
        }
    }

    return (
        <main className="hello">
            <h1>Hello plugin</h1>
            <p className="hint">
                A minimal example panel built with <code>@pressh/panel-kit</code>. It calls the
                plugin&rsquo;s <code>greet</code> handler over the sandboxed host bridge.
            </p>
            <label className="field">
                <span>Name</span>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="world"
                />
            </label>
            <button type="button" onClick={greet} disabled={pending}>
                {pending ? "Greeting…" : "Greet"}
            </button>
            {greeting !== null && <p className="result">{greeting}</p>}
            {error !== null && <p className="error">Error: {error}</p>}
        </main>
    );
}
