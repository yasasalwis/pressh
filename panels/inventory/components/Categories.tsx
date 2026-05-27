import {useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {Empty, Msg} from "../ui";

export function Categories() {
    const {categories, catName, reloadCategories} = useStore();
    const [id, setId] = useState("");
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [parentId, setParentId] = useState("");
    const [description, setDescription] = useState("");
    const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "err" } | null>(null);

    function reset() {
        setId("");
        setName("");
        setSlug("");
        setParentId("");
        setDescription("");
        setMsg(null);
    }

    async function save() {
        try {
            await api.saveCategory({id: id || undefined, name, slug, parentId: parentId || null, description});
            reset();
            await reloadCategories();
            setMsg({text: "Saved.", kind: "ok"});
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        }
    }

    async function remove(catId: string) {
        if (!confirm("Delete this category?")) return;
        try {
            await api.removeCategory(catId);
            if (catId === id) reset();
            await reloadCategories();
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        }
    }

    function edit(c: (typeof categories)[number]) {
        setId(c.id);
        setName(c.name);
        setSlug(c.slug || "");
        setParentId(c.parentId || "");
        setDescription(c.description || "");
        setMsg(null);
    }

    return (
        <section>
            <div className="card">
                <strong>{id ? "Edit category" : "New category"}</strong>
                <div className="grid g2">
                    <div>
                        <label>Name *</label>
                        <input value={name} onChange={(e) => setName(e.target.value)}/>
                    </div>
                    <div>
                        <label>Slug</label>
                        <input placeholder="auto from name" value={slug} onChange={(e) => setSlug(e.target.value)}/>
                    </div>
                </div>
                <div className="grid g2">
                    <div>
                        <label>Parent category</label>
                        <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                            <option value="">— None —</option>
                            {categories
                                .filter((c) => c.id !== id)
                                .map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                        </select>
                    </div>
                    <div>
                        <label>Description</label>
                        <input value={description} onChange={(e) => setDescription(e.target.value)}/>
                    </div>
                </div>
                <div className="row" style={{marginTop: 12}}>
                    <button className="btn primary" onClick={save}>
                        Save category
                    </button>
                    <button className="btn" onClick={reset}>
                        Clear
                    </button>
                    {msg && <Msg text={msg.text} kind={msg.kind}/>}
                </div>
            </div>

            {categories.length ? (
                <table>
                    <thead>
                    <tr>
                        <th>Name</th>
                        <th>Slug</th>
                        <th>Parent</th>
                        <th></th>
                    </tr>
                    </thead>
                    <tbody>
                    {categories.map((c) => (
                        <tr key={c.id}>
                            <td>
                                <b>{c.name}</b>
                            </td>
                            <td className="muted">{c.slug}</td>
                            <td>{catName(c.parentId)}</td>
                            <td className="right">
                                <button className="btn mini" onClick={() => edit(c)}>
                                    Edit
                                </button>
                                {" "}
                                <button className="btn mini danger" onClick={() => remove(c.id)}>
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            ) : (
                <Empty>No categories yet.</Empty>
            )}
        </section>
    );
}
