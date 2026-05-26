import {useEffect, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {Empty, ErrorText, Loading} from "../ui";
import type {Product} from "../types";
import {ProductEditor} from "./ProductEditor";

export function Products() {
    const {money, catName} = useStore();
    const [items, setItems] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string | null } | null>(null);

    async function load() {
        setLoading(true);
        try {
            const r = await api.listItems();
            setItems(r.items);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!editing) void load();
    }, [editing]);

    if (editing) {
        return <ProductEditor productId={editing.id} onBack={() => setEditing(null)}/>;
    }

    function priceLabel(it: Product): string {
        if (it.priceMin != null && it.priceMax != null && it.priceMin !== it.priceMax) {
            return money(it.priceMin) + "–" + money(it.priceMax);
        }
        return money(it.price != null ? it.price : it.priceMin);
    }

    return (
        <section>
            <div className="row between" style={{marginBottom: 12}}>
                <strong>Products</strong>
                <button className="btn primary" onClick={() => setEditing({id: null})}>
                    + New product
                </button>
            </div>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorText>{error}</ErrorText>
            ) : !items.length ? (
                <Empty>No products yet. Click “New product” to add one.</Empty>
            ) : (
                <table>
                    <thead>
                    <tr>
                        <th></th>
                        <th>Name</th>
                        <th>Category</th>
                        <th className="num">Price</th>
                        <th className="num">Stock</th>
                        <th>Status</th>
                        <th></th>
                    </tr>
                    </thead>
                    <tbody>
                    {items.map((it) => {
                        const img = it.image || (it.images && it.images[0]) || "";
                        return (
                            <tr key={it.id}>
                                <td>
                                    {img ? <img className="thumb" src={img} alt=""/> : <div className="thumb"/>}
                                </td>
                                <td>
                                    <b>{it.name}</b>
                                    <br/>
                                    <span className="muted">{it.slug || ""}</span>
                                </td>
                                <td>{catName(it.categoryId)}</td>
                                <td className="num">{priceLabel(it)}</td>
                                <td className="num">
                                    {it.totalStock != null ? it.totalStock : 0}
                                    {it.lowStock && <span className="tag low"> Low</span>}
                                </td>
                                <td>
                                    {it.published ? (
                                        <span className="tag">Published</span>
                                    ) : (
                                        <span className="tag off">Draft</span>
                                    )}
                                </td>
                                <td className="right">
                                    <button className="btn mini" onClick={() => setEditing({id: it.id})}>
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            )}
        </section>
    );
}
