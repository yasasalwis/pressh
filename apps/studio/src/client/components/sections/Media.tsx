import {useRef, useState} from "react";
import {api, uploadFile} from "../../api";
import {ConfirmModal, ErrorCard, Loading, RowHead, useLoader, useToast} from "../ui";

interface MediaItem {
    id: string;
    filename: string;
    ext: string;
}

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp"];

export function Media({can}: { can: (cap: string) => boolean }) {
    const toast = useToast();
    const canWrite = can("media.write");
    const {data, loading, error, reload} = useLoader(
        async () => (await api<{ items?: MediaItem[] }>("/admin/api/media")).body.items || [],
    );
    const fileInput = useRef<HTMLInputElement>(null);
    const [dragover, setDragover] = useState(false);
    const [confirmDel, setConfirmDel] = useState<MediaItem | null>(null);

    async function upload(file: File | undefined) {
        if (!file) return;
        const r = await uploadFile<{ error?: { message?: string } }>("/admin/api/media", file);
        if (r.status === 200) {
            toast("Uploaded");
            reload();
        } else {
            toast(r.body.error?.message || "Upload failed", true);
        }
    }

    async function del(m: MediaItem) {
        setConfirmDel(null);
        const r = await api("/admin/api/media/" + m.id, {method: "DELETE"});
        if (r.status === 200) {
            toast("Deleted");
            reload();
        } else toast("Delete failed", true);
    }

    return (
        <>
            <RowHead title="Media"/>
            {canWrite && (
                <div className="card">
                    <div
                        className={"dropzone" + (dragover ? " dragover" : "")}
                        onClick={() => fileInput.current?.click()}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragover(true);
                        }}
                        onDragLeave={() => setDragover(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragover(false);
                            void upload(e.dataTransfer.files?.[0]);
                        }}
                    >
                        Drag &amp; drop an image or PDF here, or click to choose.
                        <input
                            ref={fileInput}
                            type="file"
                            className="hide"
                            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                            onChange={(e) => void upload(e.target.files?.[0])}
                        />
                    </div>
                </div>
            )}
            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <div className="card">
                    {!data || !data.length ? (
                        <div className="empty">
                            <span className="ico">📷</span>No media uploaded yet.
                        </div>
                    ) : (
                        <div className="media-grid">
                            {data.map((m) => {
                                const isImg = IMG_EXT.includes(m.ext);
                                return (
                                    <div className="media-tile" key={m.id}>
                                        <div className="thumb">
                                            {isImg ? (
                                                <img src={"/admin/api/media/" + m.id + "/raw"} alt={m.filename}
                                                     loading="lazy"/>
                                            ) : (
                                                <span className="ext">{String(m.ext || "file").toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="mi">
                      <span className="nm" title={m.filename}>
                        {m.filename}
                      </span>
                                            {canWrite && (
                                                <button className="iconbtn danger" title="Delete"
                                                        onClick={() => setConfirmDel(m)}>
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            {confirmDel && (
                <ConfirmModal
                    title="Delete media?"
                    message={`Permanently remove ${confirmDel.filename}? This cannot be undone.`}
                    confirmLabel="Delete"
                    onConfirm={() => del(confirmDel)}
                    onCancel={() => setConfirmDel(null)}
                />
            )}
        </>
    );
}
