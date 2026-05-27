import {usePanelQuery} from "@pressh/panel-kit";

interface DayBucket {
    date: string;
    total: number;
}

interface TopPath {
    path: string;
    count: number;
}

interface Summary {
    total: number;
    days: DayBucket[];
    topPaths: TopPath[];
}

export function App() {
    const {data, loading, error} = usePanelQuery<Summary>("summary", {days: 30});

    return (
        <>
            <h2>Analytics</h2>
            <p className="muted">Cookieless, privacy-friendly page views. No cookies, no IPs, no third parties.</p>

            {loading && <p className="muted">Loading…</p>}
            {error && <p className="err">Could not load analytics: {error}</p>}
            {data && <Report data={data}/>}
        </>
    );
}

function Report({data}: { data: Summary }) {
    const days = data.days || [];
    const max = days.reduce((m, d) => Math.max(m, d.total || 0), 1);
    const top = data.topPaths || [];

    return (
        <>
            <div className="big">{data.total || 0}</div>
            <div className="muted">views over the last 30 days</div>

            <h3>By day</h3>
            {days.length ? (
                days.map((d) => {
                    const pct = Math.round(((d.total || 0) / max) * 100);
                    return (
                        <div className="day" key={d.date}>
                            <span>{d.date}</span>
                            <span className="bar">
                <span style={{width: pct + "%"}}/>
              </span>
                            <span className="num">{d.total || 0}</span>
                        </div>
                    );
                })
            ) : (
                <p className="muted">No views recorded yet.</p>
            )}

            <h3>Top pages</h3>
            {top.length ? (
                <table>
                    <thead>
                    <tr>
                        <th>Path</th>
                        <th className="num">Views</th>
                    </tr>
                    </thead>
                    <tbody>
                    {top.map((p) => (
                        <tr key={p.path}>
                            <td>{p.path}</td>
                            <td className="num">{p.count}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            ) : (
                <p className="muted">No paths yet.</p>
            )}
        </>
    );
}
