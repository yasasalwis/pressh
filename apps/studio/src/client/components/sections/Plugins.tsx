import {api} from "../../api";
import {ErrorCard, Loading, RowHead, useLoader, useToast} from "../ui";

interface Plugin {
    name: string;
    version: string;
    capabilities?: string[];
    enabled?: boolean;
    builtin?: boolean;
    hasPanel?: boolean;
}

interface Advisory {
    name?: string;
    plugin?: string;
    id?: string;
    cve?: string;
    severity?: string;
}

export function Plugins() {
    const toast = useToast();
    const {data, loading, error, reload} = useLoader(async () => {
        const [pl, cve] = await Promise.all([
            api<{ items?: Plugin[] }>("/admin/api/plugins"),
            api<{ items?: Advisory[] }>("/admin/api/plugins/cve"),
        ]);
        return {items: pl.body.items || [], advisories: cve.body.items || []};
    });

    async function toggle(name: string, enable: boolean) {
        const verb = enable ? "enable" : "disable";
        const r = await api<{ error?: { code?: string } }>(
            "/admin/api/plugins/" + encodeURIComponent(name) + "/" + verb,
            {method: "POST", body: "{}"},
        );
        if (r.status === 200) {
            toast(enable ? "Plugin enabled" : "Plugin disabled");
            reload();
        } else {
            toast(r.body.error?.code || "Could not " + verb + " plugin", true);
        }
    }

    return (
        <>
            <RowHead title="Plugins"/>
            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <>
                    <div className="card">
                        <p className="hint">
                            Plugins run in isolated worker threads with only the capabilities you approve. Disabled
                            plugins run
                            no worker at all — enable only what you need.
                        </p>
                        {!data || !data.items.length ? (
                            <div className="empty">
                                <span className="ico">🧩</span>No plugins installed.
                            </div>
                        ) : (
                            <table className="tbl">
                                <thead>
                                <tr>
                                    <th>Plugin</th>
                                    <th>Capabilities</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                                </thead>
                                <tbody>
                                {data.items.map((p) => (
                                    <tr key={p.name}>
                                        <td>
                                            <b>{p.name}</b> <span className="meta">v{p.version}</span>
                                            {p.builtin && <span className="tag"> built-in</span>}
                                        </td>
                                        <td>
                                            {(p.capabilities || []).length ? (
                                                (p.capabilities || []).map((c, i) => (
                                                    <span className="tag cap" key={i}>
                              {c}
                            </span>
                                                ))
                                            ) : (
                                                <span className="meta">none</span>
                                            )}
                                        </td>
                                        <td>
                        <span
                            className="tag"
                            style={
                                p.enabled
                                    ? {background: "#16a34a22", color: "#16a34a"}
                                    : {background: "#64748b22", color: "#64748b"}
                            }
                        >
                          {p.enabled ? "Enabled" : "Disabled"}
                        </span>
                                        </td>
                                        <td className="actions">
                                            {p.enabled && p.hasPanel && (
                                                <a
                                                    className="ghost"
                                                    href={"/admin/plugins/" + encodeURIComponent(p.name)}
                                                    target="_blank"
                                                    rel="noopener"
                                                >
                                                    Open panel ↗
                                                </a>
                                            )}
                                            <button className={"btn-sm" + (p.enabled ? " ghost" : "")}
                                                    onClick={() => toggle(p.name, !p.enabled)}>
                                                {p.enabled ? "Disable" : "Enable"}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    {data && data.advisories.length > 0 && (
                        <div className="card">
                            <h3>Security advisories</h3>
                            <table className="tbl">
                                <tbody>
                                {data.advisories.map((a, i) => (
                                    <tr key={i}>
                                        <td>
                                            <b>{a.name || a.plugin || "?"}</b>
                                        </td>
                                        <td className="meta">{a.id || a.cve || ""}</td>
                                        <td>{a.severity || ""}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </>
    );
}
