import {useState} from "react";
import {api} from "../../api";
import {ErrorCard, Loading, Modal, RowHead, fmtDate, useLoader, useToast} from "../ui";

const ROLES = ["owner", "admin", "editor", "author", "viewer"];

interface UserRow {
    id: string;
    email: string;
    roles?: string[];
    status: string;
    mustChangePassword?: boolean;
}

interface InviteRow {
    id: string;
    email: string;
    roles?: string[];
    expiresAt: string | number;
}

type ModalState =
    | { kind: "roles"; user: UserRow }
    | { kind: "invite" }
    | { kind: "createUser" }
    | { kind: "inviteResult"; email: string; link: string }
    | { kind: "createResult"; email: string; tmp: string }
    | null;

export function Users() {
    const toast = useToast();
    const {data, loading, error, reload} = useLoader(async () => {
        const r = await api<{ users?: UserRow[]; invites?: InviteRow[] }>("/admin/api/users");
        return {users: r.body.users || [], invites: r.body.invites || []};
    });
    const [modal, setModal] = useState<ModalState>(null);

    async function setStatus(id: string, status: string) {
        const r = await api("/admin/api/users/" + id, {method: "PUT", body: JSON.stringify({status})});
        if (r.status === 200) {
            toast("User " + (status === "active" ? "enabled" : "disabled"));
            reload();
        } else if (r.status === 409) toast("Cannot disable the last active owner", true);
        else toast("Update failed", true);
    }

    async function revokeInvite(id: string) {
        const r = await api("/admin/api/invites/" + id, {method: "DELETE"});
        if (r.status === 200) {
            toast("Invitation revoked");
            reload();
        } else toast("Failed", true);
    }

    return (
        <>
            <RowHead title="Users">
                <button className="ghost" onClick={() => setModal({kind: "invite"})}>
                    Invite by email
                </button>
                <button className="btn-sm" onClick={() => setModal({kind: "createUser"})}>
                    + Add user
                </button>
            </RowHead>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <>
                    <div className="card">
                        {!data || !data.users.length ? (
                            <div className="empty">No users.</div>
                        ) : (
                            <table className="tbl">
                                <thead>
                                <tr>
                                    <th>Email</th>
                                    <th>Roles</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                                </thead>
                                <tbody>
                                {data.users.map((u) => (
                                    <tr key={u.id}>
                                        <td>
                                            <b>{u.email}</b>
                                            {u.mustChangePassword && (
                                                <span className="tag" title="Must change temporary password">
                            {" "}
                                                    temp pw
                          </span>
                                            )}
                                        </td>
                                        <td>
                                            {(u.roles || []).map((x, i) => (
                                                <span className="tag" key={i}>
                            {x}
                          </span>
                                            ))}
                                        </td>
                                        <td>
                                            <span className={"badge b-" + u.status}>{u.status}</span>
                                        </td>
                                        <td className="actions">
                                            <button className="iconbtn" title="Change roles"
                                                    onClick={() => setModal({kind: "roles", user: u})}>
                                                ✎
                                            </button>
                                            {u.status === "active" ? (
                                                <button className="iconbtn danger"
                                                        onClick={() => setStatus(u.id, "disabled")}>
                                                    Disable
                                                </button>
                                            ) : (
                                                <button className="iconbtn" onClick={() => setStatus(u.id, "active")}>
                                                    Enable
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    {data && data.invites.length > 0 && (
                        <div className="card">
                            <h3>Pending invitations</h3>
                            <table className="tbl">
                                <tbody>
                                {data.invites.map((i) => (
                                    <tr key={i.id}>
                                        <td>{i.email}</td>
                                        <td>
                                            {(i.roles || []).map((x, j) => (
                                                <span className="tag" key={j}>
                            {x}
                          </span>
                                            ))}
                                        </td>
                                        <td className="meta">expires {fmtDate(new Date(i.expiresAt))}</td>
                                        <td className="actions">
                                            <button className="iconbtn danger" onClick={() => revokeInvite(i.id)}>
                                                Revoke
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {modal?.kind === "roles" && (
                <RolesModal
                    user={modal.user}
                    onClose={() => setModal(null)}
                    onSaved={() => {
                        setModal(null);
                        reload();
                    }}
                />
            )}
            {modal?.kind === "invite" && (
                <InviteModal
                    onClose={() => setModal(null)}
                    onCreated={(email, link) => setModal({kind: "inviteResult", email, link})}
                />
            )}
            {modal?.kind === "createUser" && (
                <CreateUserModal
                    onClose={() => setModal(null)}
                    onCreated={(email, tmp) => setModal({kind: "createResult", email, tmp})}
                />
            )}
            {modal?.kind === "inviteResult" && (
                <CopyResultModal
                    title="Invitation created"
                    hint={`Share this single-use link with ${modal.email}. It expires in 7 days.`}
                    value={modal.link}
                    onDone={() => {
                        setModal(null);
                        reload();
                    }}
                />
            )}
            {modal?.kind === "createResult" && (
                <CopyResultModal
                    title="User created"
                    hint={`Give ${modal.email} this temporary password. They will be required to change it after signing in.`}
                    value={modal.tmp}
                    onDone={() => {
                        setModal(null);
                        reload();
                    }}
                />
            )}
        </>
    );
}

function RoleSelect({value, onChange}: { value: string; onChange: (v: string) => void }) {
    return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            {ROLES.map((r) => (
                <option key={r} value={r}>
                    {r}
                </option>
            ))}
        </select>
    );
}

function RolesModal({user, onClose, onSaved}: { user: UserRow; onClose: () => void; onSaved: () => void }) {
    const toast = useToast();
    const [roles, setRoles] = useState<string[]>(user.roles || []);
    const [error, setError] = useState("");

    function toggle(role: string, on: boolean) {
        setRoles((prev) => (on ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));
    }

    async function save() {
        setError("");
        if (!roles.length) return setError("Select at least one role.");
        const r = await api("/admin/api/users/" + user.id, {method: "PUT", body: JSON.stringify({roles})});
        if (r.status === 200) {
            toast("Roles updated");
            onSaved();
        } else if (r.status === 409) setError("Cannot remove the last active owner.");
        else setError("Could not update roles.");
    }

    return (
        <Modal onClose={onClose}>
            <h3>Roles — {user.email}</h3>
            <p className="hint">Select one or more roles.</p>
            {ROLES.map((role) => (
                <label className="dp-check-row" style={{padding: ".2rem 0"}} key={role}>
                    <input type="checkbox" checked={roles.includes(role)}
                           onChange={(e) => toggle(role, e.target.checked)}/>
                    <span>{role}</span>
                </label>
            ))}
            {error && <div className="alert">{error}</div>}
            <div className="actions">
                <button className="ghost" onClick={onClose}>
                    Cancel
                </button>
                <button className="btn-sm" onClick={save}>
                    Save roles
                </button>
            </div>
        </Modal>
    );
}

function InviteModal({onClose, onCreated}: { onClose: () => void; onCreated: (email: string, link: string) => void }) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("author");
    const [error, setError] = useState("");

    async function send() {
        setError("");
        if (!email.trim()) return setError("Email is required.");
        const r = await api<{ data?: { token: string }; error?: { code?: string } }>("/admin/api/users/invite", {
            method: "POST",
            body: JSON.stringify({email: email.trim(), roles: [role]}),
        });
        if (r.status !== 200) {
            return setError(r.body.error?.code === "conflict" ? "A user with this email already exists." : "Could not create invite.");
        }
        const link = location.origin + "/admin#/invite/" + encodeURIComponent(r.body.data?.token ?? "");
        onCreated(email.trim(), link);
    }

    return (
        <Modal onClose={onClose}>
            <h3>Invite a user</h3>
            <p className="hint">Creates a single-use, expiring link. They set their own password.</p>
            <label>Email</label>
            <input type="email" placeholder="person@example.com" value={email}
                   onChange={(e) => setEmail(e.target.value)}/>
            <label>Role</label>
            <RoleSelect value={role} onChange={setRole}/>
            {error && <div className="alert">{error}</div>}
            <div className="actions">
                <button className="ghost" onClick={onClose}>
                    Cancel
                </button>
                <button className="btn-sm" onClick={send}>
                    Create invite
                </button>
            </div>
        </Modal>
    );
}

function CreateUserModal({onClose, onCreated}: {
    onClose: () => void;
    onCreated: (email: string, tmp: string) => void
}) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("author");
    const [error, setError] = useState("");

    async function create() {
        setError("");
        if (!email.trim()) return setError("Email is required.");
        const r = await api<{ data?: { temporaryPassword: string }; error?: { code?: string } }>("/admin/api/users", {
            method: "POST",
            body: JSON.stringify({email: email.trim(), roles: [role]}),
        });
        if (r.status !== 200) {
            return setError(r.body.error?.code === "conflict" ? "A user with this email already exists." : "Could not create user.");
        }
        onCreated(email.trim(), r.body.data?.temporaryPassword ?? "");
    }

    return (
        <Modal onClose={onClose}>
            <h3>Add user</h3>
            <p className="hint">
                Creates an account with a temporary password you relay. They must change it on first sign-in.
            </p>
            <label>Email</label>
            <input type="email" placeholder="person@example.com" value={email}
                   onChange={(e) => setEmail(e.target.value)}/>
            <label>Role</label>
            <RoleSelect value={role} onChange={setRole}/>
            {error && <div className="alert">{error}</div>}
            <div className="actions">
                <button className="ghost" onClick={onClose}>
                    Cancel
                </button>
                <button className="btn-sm" onClick={create}>
                    Create user
                </button>
            </div>
        </Modal>
    );
}

function CopyResultModal({
                             title,
                             hint,
                             value,
                             onDone,
                         }: {
    title: string;
    hint: string;
    value: string;
    onDone: () => void;
}) {
    const toast = useToast();

    function copy() {
        if (navigator.clipboard) void navigator.clipboard.writeText(value).catch(() => {
        });
        toast("Copied");
    }

    return (
        <Modal locked>
            <h3>{title}</h3>
            <p className="hint">{hint}</p>
            <div className="copybox">
                <input type="text" readOnly value={value}/>
                <button className="btn-sm" onClick={copy}>
                    Copy
                </button>
            </div>
            <div className="actions">
                <button className="btn-sm" onClick={onDone}>
                    Done
                </button>
            </div>
        </Modal>
    );
}
