import {useEffect, useState} from "react";
import {api, type ProductInput, type VariantInput} from "../api";
import {useStore} from "../context";
import {cartesian, slugify, variantLabel} from "../format";
import {Loading, Msg} from "../ui";

interface EditOption {
    name: string;
    values: string[];
}

interface EditVariant {
    _existing: boolean;
    id?: string;
    optionValues: Record<string, string>;
    label: string;
    sku: string;
    price: string;
    stock: string;
    lowStockThreshold: string;
}

function defaultVariant(): EditVariant {
    return {
        _existing: false,
        optionValues: {},
        label: "Default",
        sku: "",
        price: "",
        stock: "0",
        lowStockThreshold: ""
    };
}

export function ProductEditor({productId, onBack}: { productId: string | null; onBack: () => void }) {
    const {settings, categories} = useStore();

    const [loading, setLoading] = useState(productId != null);
    const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "err" } | null>(null);
    const [saving, setSaving] = useState(false);
    const [isExisting, setIsExisting] = useState(false);

    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [slugEdited, setSlugEdited] = useState(false);
    const [sku, setSku] = useState("");
    const [price, setPrice] = useState("0");
    const [compareAt, setCompareAt] = useState("");
    const [currency, setCurrency] = useState((settings && settings.currency) || "USD");
    const [categoryId, setCategoryId] = useState("");
    const [lowStock, setLowStock] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState("");
    const [seoTitle, setSeoTitle] = useState("");
    const [seoDescription, setSeoDescription] = useState("");
    const [published, setPublished] = useState(true);

    const [images, setImages] = useState<string[]>([]);
    const [options, setOptions] = useState<EditOption[]>([]);
    const [variants, setVariants] = useState<EditVariant[]>([defaultVariant()]);

    useEffect(() => {
        let alive = true;

        async function init() {
            if (productId == null) {
                // New product — publish by default; slug auto-fills from the name.
                setLoading(false);
                return;
            }
            try {
                const r = await api.getItem(productId);
                if (!alive) return;
                const item = r.item;
                setIsExisting(true);
                setName(item.name || "");
                setSlug(item.slug || "");
                setSlugEdited(!!item.slug);
                setSku(item.sku || "");
                setPrice(String(item.price != null ? item.price : 0));
                setCompareAt(item.compareAtPrice != null ? String(item.compareAtPrice) : "");
                setCurrency(item.currency || (settings && settings.currency) || "USD");
                setCategoryId(item.categoryId || "");
                setLowStock(item.lowStockThreshold != null ? String(item.lowStockThreshold) : "");
                setDescription(item.description || "");
                setTags(item.tags ? item.tags.join(", ") : "");
                setSeoTitle(item.seoTitle || "");
                setSeoDescription(item.seoDescription || "");
                setPublished(!!item.published);
                setImages(item.images ? item.images.slice() : []);
                setOptions((item.options || []).map((o) => ({name: o.name, values: (o.values || []).slice()})));
                setVariants(
                    item.variants && item.variants.length
                        ? item.variants.map((v) => ({
                            _existing: true,
                            id: v.id,
                            optionValues: v.optionValues || {},
                            label: v.label,
                            sku: v.sku || "",
                            price: v.price == null ? "" : String(v.price),
                            stock: String(v.stock || 0),
                            lowStockThreshold: v.lowStockThreshold == null ? "" : String(v.lowStockThreshold),
                        }))
                        : [defaultVariant()],
                );
            } catch (e) {
                if (alive) setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
            } finally {
                if (alive) setLoading(false);
            }
        }

        void init();
        return () => {
            alive = false;
        };
    }, [productId, settings]);

    function onNameChange(v: string) {
        setName(v);
        if (!slugEdited) setSlug(slugify(v));
    }

    function onSlugChange(v: string) {
        setSlug(v);
        setSlugEdited(v.trim().length > 0);
    }

    function generateVariants() {
        const opts = options.filter((o) => o.name && o.values.length);
        const combos = opts.length ? cartesian(opts) : [{}];
        setVariants((prev) =>
            combos.map((ov) => {
                const label = variantLabel(ov);
                const match = prev.find((v) => variantLabel(v.optionValues) === label);
                return match
                    ? {...match, optionValues: ov, label}
                    : {
                        _existing: false,
                        optionValues: ov,
                        label,
                        sku: "",
                        price: "",
                        stock: "0",
                        lowStockThreshold: ""
                    };
            }),
        );
    }

    function collect(): ProductInput {
        const variantPayload: VariantInput[] = variants.map((v) => {
            const out: VariantInput = {optionValues: v.optionValues || {}, sku: v.sku.trim()};
            if (v._existing && v.id) out.id = v.id;
            if (v.price !== "" && v.price != null) out.price = Number(v.price);
            if (v.lowStockThreshold !== "") out.lowStockThreshold = parseInt(v.lowStockThreshold, 10);
            if (!v._existing) out.stock = parseInt(v.stock, 10) || 0;
            return out;
        });
        const item: ProductInput = {
            id: productId ?? undefined,
            name,
            slug,
            sku,
            price: parseFloat(price) || 0,
            currency,
            categoryId: categoryId || null,
            description,
            tags: tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            images: images.map((s) => (s || "").trim()).filter(Boolean),
            options: options.filter((o) => o.name && o.values.length),
            variants: variantPayload,
            seoTitle,
            seoDescription,
            published,
        };
        if (compareAt !== "") item.compareAtPrice = parseFloat(compareAt);
        if (lowStock !== "") item.lowStockThreshold = parseInt(lowStock, 10);
        return item;
    }

    async function save() {
        setSaving(true);
        setMsg({text: "Saving…"});
        try {
            await api.saveItem(collect());
            onBack();
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!productId || !confirm("Delete this product? This cannot be undone.")) return;
        try {
            await api.removeItem(productId);
            onBack();
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        }
    }

    if (loading) return <Loading/>;

    return (
        <section>
            <div className="row between" style={{marginBottom: 12}}>
                <strong>{isExisting ? "Edit product" : "New product"}</strong>
                <button className="btn" onClick={onBack}>
                    ← Back to list
                </button>
            </div>

            <div className="card">
                <div className="grid g2">
                    <div>
                        <label>Name *</label>
                        <input value={name} onChange={(e) => onNameChange(e.target.value)}/>
                    </div>
                    <div>
                        <label>Slug (URL)</label>
                        <input placeholder="auto from name" value={slug}
                               onChange={(e) => onSlugChange(e.target.value)}/>
                    </div>
                </div>

                <div className="grid g3">
                    <div>
                        <label>SKU</label>
                        <input value={sku} onChange={(e) => setSku(e.target.value)}/>
                    </div>
                    <div>
                        <label>Base price</label>
                        <input type="number" min={0} step={0.01} value={price}
                               onChange={(e) => setPrice(e.target.value)}/>
                    </div>
                    <div>
                        <label>Compare-at price</label>
                        <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="optional"
                            value={compareAt}
                            onChange={(e) => setCompareAt(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid g3">
                    <div>
                        <label>Currency</label>
                        <input maxLength={8} value={currency} onChange={(e) => setCurrency(e.target.value)}/>
                    </div>
                    <div>
                        <label>Category</label>
                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">— Uncategorized —</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label>Default low-stock alert</label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            placeholder="store default"
                            value={lowStock}
                            onChange={(e) => setLowStock(e.target.value)}
                        />
                    </div>
                </div>

                <label>Description</label>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}/>

                <label>Tags (comma separated)</label>
                <input placeholder="sale, featured" value={tags} onChange={(e) => setTags(e.target.value)}/>

                <label>Images (https URLs)</label>
                <div>
                    {images.map((url, i) => (
                        <div className="imgrow" key={i}>
                            {url ? <img className="thumb" src={url} alt=""/> : <div className="thumb"/>}
                            <input
                                placeholder="https://…"
                                value={url}
                                onChange={(e) =>
                                    setImages((prev) => prev.map((u, j) => (j === i ? e.target.value : u)))
                                }
                            />
                            <button
                                className="btn mini danger"
                                type="button"
                                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
                <button className="btn mini" type="button" onClick={() => setImages((prev) => [...prev, ""])}>
                    + Add image URL
                </button>

                <h3 style={{marginTop: 18}}>Options &amp; variants</h3>
                <p className="muted" style={{fontSize: 12, margin: "0 0 8px"}}>
                    Add option axes (e.g. Size, Colour), then generate the variant combinations. Leave empty for a
                    single-variant product.
                </p>

                <div>
                    {options.map((o, i) => (
                        <div className="grid g2" style={{marginBottom: 6}} key={i}>
                            <input
                                placeholder="Option name (e.g. Size)"
                                value={o.name}
                                onChange={(e) =>
                                    setOptions((prev) => prev.map((x, j) => (j === i ? {
                                        ...x,
                                        name: e.target.value
                                    } : x)))
                                }
                            />
                            <div className="row">
                                <input
                                    placeholder="Values, comma separated"
                                    value={o.values.join(", ")}
                                    onChange={(e) =>
                                        setOptions((prev) =>
                                            prev.map((x, j) =>
                                                j === i
                                                    ? {
                                                        ...x,
                                                        values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                                                    }
                                                    : x,
                                            ),
                                        )
                                    }
                                />
                                <button
                                    className="btn mini danger"
                                    type="button"
                                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="row" style={{margin: "6px 0 12px"}}>
                    <button
                        className="btn mini"
                        type="button"
                        onClick={() => setOptions((prev) => [...prev, {name: "", values: []}])}
                    >
                        + Add option
                    </button>
                    <button className="btn mini" type="button" onClick={generateVariants}>
                        ↻ Generate variants
                    </button>
                </div>

                <div>
                    {variants.length ? (
                        <table>
                            <thead>
                            <tr>
                                <th>Variant</th>
                                <th>SKU</th>
                                <th>Price</th>
                                <th className="num">Stock</th>
                                <th>Low alert</th>
                            </tr>
                            </thead>
                            <tbody>
                            {variants.map((v, i) => (
                                <tr key={v.id ?? i}>
                                    <td>
                                        <b>{v.label || variantLabel(v.optionValues)}</b>
                                    </td>
                                    <td>
                                        <input
                                            style={{width: 120}}
                                            placeholder="SKU"
                                            value={v.sku}
                                            onChange={(e) =>
                                                setVariants((prev) => prev.map((x, j) => (j === i ? {
                                                    ...x,
                                                    sku: e.target.value
                                                } : x)))
                                            }
                                        />
                                    </td>
                                    <td>
                                        <input
                                            style={{width: 90}}
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            placeholder="base"
                                            value={v.price}
                                            onChange={(e) =>
                                                setVariants((prev) => prev.map((x, j) => (j === i ? {
                                                    ...x,
                                                    price: e.target.value
                                                } : x)))
                                            }
                                        />
                                    </td>
                                    <td className="num">
                                        {v._existing ? (
                                            <>
                                                {Number(v.stock) || 0}{" "}
                                                <span className="muted" title="Manage in the Stock tab">
                            🔒
                          </span>
                                            </>
                                        ) : (
                                            <input
                                                style={{width: 80}}
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={v.stock}
                                                onChange={(e) =>
                                                    setVariants((prev) =>
                                                        prev.map((x, j) => (j === i ? {
                                                            ...x,
                                                            stock: e.target.value
                                                        } : x)),
                                                    )
                                                }
                                            />
                                        )}
                                    </td>
                                    <td>
                                        <input
                                            style={{width: 80}}
                                            type="number"
                                            min={0}
                                            step={1}
                                            placeholder="default"
                                            value={v.lowStockThreshold}
                                            onChange={(e) =>
                                                setVariants((prev) =>
                                                    prev.map((x, j) => (j === i ? {
                                                        ...x,
                                                        lowStockThreshold: e.target.value
                                                    } : x)),
                                                )
                                            }
                                        />
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="muted">No variants yet — click “Generate variants”.</p>
                    )}
                </div>

                <details style={{marginTop: 14}}>
                    <summary className="muted">SEO (optional)</summary>
                    <label>SEO title</label>
                    <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)}/>
                    <label>SEO description</label>
                    <textarea rows={2} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)}/>
                </details>

                <label className="row" style={{marginTop: 12}}>
                    <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)}/>
                    &nbsp;Published (visible on the storefront)
                </label>

                <div className="row" style={{marginTop: 14}}>
                    <button className="btn primary" onClick={save} disabled={saving}>
                        Save product
                    </button>
                    {isExisting && (
                        <button className="btn danger" onClick={remove}>
                            Delete
                        </button>
                    )}
                    {msg && <Msg text={msg.text} kind={msg.kind}/>}
                </div>
            </div>
        </section>
    );
}
