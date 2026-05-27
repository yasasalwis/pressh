export function Placeholder({title}: { title: string }) {
    return (
        <div className="card">
            <div className="empty">
                <span className="ico">🚧</span>
                The <b>{title}</b> section is being migrated to React.
                <br/>
                Use the classic admin at{" "}
                <a href="/admin" style={{color: "var(--brand)", fontWeight: 700}}>
                    /admin
                </a>{" "}
                for now.
            </div>
        </div>
    );
}
