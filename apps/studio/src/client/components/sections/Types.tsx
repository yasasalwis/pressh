import {useState} from "react";
import {api} from "../../api";
import {ErrorCard, Loading, RowHead, useLoader, useToast} from "../ui";

const FIELD_TYPES = ["text", "richtext", "number", "boolean", "date", "select"];

interface FieldDef {
    id?: string;
    name: string;
    type: string;
    required?: boolean;
    sensitive?: boolean;
    options?: string[];
}

interface ContentType {
    id: string;
    name: string;
    slug: string;
    fields?: FieldDef[];
}

interface EditField {
    name: string;
    type: string;
    required: boolean;
    sensitive: boolean;
    options: string;
}

export function Types() {
    const {data, loading, error, reload} = useLoader(
        async () => (await api<{ items?: ContentType[] }>("/admin/api/types")).body.items || [],
    );
    const [showForm, setShowForm] = useState(false);

    return (
        <>
            <RowHead title="Content Types">
                <button className="btn-sm" onClick={() => setShowForm((s) => !s)}>
                    + New type
                </button>
            </RowHead>
            {showForm && (
                <NewTypeForm
                    onCreated={() => {
                        setShowForm(false);
                        reload();
                    }}
                    onCancel={() => setShowForm(false)}
                />
            )}
            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <div className="card">
                    {!data || !data.length ? (
                        <div className="empty">
                            <span className="ico">🧱</span>No content types yet.
                        </div>
                    ) : (
                        <table className="tbl">
                            <thead>
                            <tr>
                                <th>Name</th>
                                <th>Slug</th>
                                <th>Fields</th>
                            </tr>
                            </thead>
                            <tbody>
                            {data.map((t) => (
                                <tr key={t.id}>
                                    <td>
                                        <b>{t.name}</b>
                                    </td>
                                    <td>/{t.slug}</td>
                                    <td>
                                        {(t.fields || []).length ? (
                                            (t.fields || []).map((f, i) => (
                                                <span className="tag" key={i}>
                            {f.name}:{f.type}
                                                    {f.sensitive ? " 🔒" : ""}
                          </span>
                                            ))
                                        ) : (
                                            <span className="meta">none</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </>
    );
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function NewTypeForm({onCreated, onCancel}: { onCreated: () => void; onCancel: () => void }) {
    const toast = useToast();
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [slugTouched, setSlugTouched] = useState(false);
    const [fields, setFields] = useState<EditField[]>([
        {name: "title", type: "text", required: true, sensitive: false, options: ""},
    ]);
    const [error, setError] = useState("");

    function setField(i: number, patch: Partial<EditField>) {
        setFields((prev) => prev.map((f, j) => (j === i ? {...f, ...patch} : f)));
    }

    async function save() {
        setError("");
        if (!name.trim()) return setError("A name is required.");
        if (!slug.trim()) return setError("A slug is required.");
        const out: FieldDef[] = [];
        for (let i = 0; i < fields.length; i++) {
            const f = fields[i]!;
            if (!f.name) continue;
            const fd: FieldDef = {id: "f" + i, name: f.name, type: f.type, required: !!f.required};
            if (f.sensitive) fd.sensitive = true;
            if (f.type === "select") {
                const opts = f.options.split(",").map((s) => s.trim()).filter(Boolean);
                if (!opts.length) return setError("Select field " + f.name + " needs options.");
                fd.options = opts;
            }
            out.push(fd);
        }
        if (!out.length) return setError("Add at least one field.");
        const r = await api<{ error?: { message?: string } }>("/admin/api/types", {
            method: "POST",
            body: JSON.stringify({name: name.trim(), slug: slug.trim(), fields: out}),
        });
        if (r.status !== 200) return setError(r.body.error?.message || "Could not create the type.");
        toast("Content type created");
        onCreated();
    }

    return (
        <div className="card">
            <h3>New content type</h3>
            <div className="field-grid">
                <div>
                    <label>Name</label>
                    <input
                        placeholder="e.g. Article"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            if (!slugTouched) setSlug(slugify(e.target.value));
                        }}
                    />
                </div>
                <div>
                    <label>Slug</label>
                    <input
                        placeholder="article"
                        value={slug}
                        onChange={(e) => {
                            setSlug(e.target.value);
                            setSlugTouched(true);
                        }}
                    />
                </div>
            </div>
            <label style={{marginTop: ".8rem"}}>
                Fields <span className="meta">(🔒 marks a field as sensitive PII — encrypted & redacted)</span>
            </label>
            <div>
                {fields.map((f, i) => (
                    <div
                        key={i}
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 110px auto auto auto",
                            gap: ".4rem",
                            alignItems: "center",
                            marginBottom: ".45rem",
                        }}
                    >
                        <input placeholder="field name" value={f.name}
                               onChange={(e) => setField(i, {name: e.target.value})}/>
                        <select value={f.type} onChange={(e) => setField(i, {type: e.target.value})}>
                            {FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                        <label className="dp-check-row" style={{padding: 0}}>
                            <input type="checkbox" checked={f.required}
                                   onChange={(e) => setField(i, {required: e.target.checked})}/>
                            <span>req</span>
                        </label>
                        <label className="dp-check-row" style={{padding: 0}} title="Sensitive PII">
                            <input type="checkbox" checked={f.sensitive}
                                   onChange={(e) => setField(i, {sensitive: e.target.checked})}/>
                            <span>🔒</span>
                        </label>
                        <button
                            className="iconbtn danger"
                            onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                        >
                            ✕
                        </button>
                        {f.type === "select" && (
                            <input
                                placeholder="comma,separated,options"
                                value={f.options}
                                onChange={(e) => setField(i, {options: e.target.value})}
                                style={{gridColumn: "1/-1"}}
                            />
                        )}
                    </div>
                ))}
            </div>
            <button
                className="ghost"
                style={{marginTop: ".5rem"}}
                onClick={() => setFields((prev) => [...prev, {
                    name: "",
                    type: "text",
                    required: false,
                    sensitive: false,
                    options: ""
                }])}
            >
                + Add field
            </button>
            {error && <div className="alert">{error}</div>}
            <div style={{display: "flex", gap: ".5rem", marginTop: ".9rem"}}>
                <button className="btn-sm" onClick={save}>
                    Create type
                </button>
                <button className="ghost" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
