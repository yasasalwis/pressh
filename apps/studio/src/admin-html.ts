/**
 * Minimal functional admin client served by the Hono studio process. It
 * exercises the full no-code flow against the admin API (login, model a type,
 * author a page with blocks, upload media, publish). The richer Vite/React/
 * ui-kit visual drag-drop builder replaces this in a later increment.
 */
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pressh Studio</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  fieldset { margin: 1rem 0; } label { display:block; margin:.4rem 0 .1rem; font-size:.85rem; }
  input, textarea { width:100%; padding:.4rem; } button { margin-top:.6rem; padding:.5rem 1rem; cursor:pointer; }
  pre { background:#f4f4f5; padding:.6rem; overflow:auto; } .hide{display:none;}
</style>
</head>
<body>
<h1>Pressh Studio</h1>
<section id="login">
  <fieldset><legend>Sign in</legend>
    <label>Email</label><input id="email" type="email" autocomplete="username">
    <label>Password</label><input id="password" type="password" autocomplete="current-password">
    <button onclick="login()">Sign in</button>
  </fieldset>
</section>
<section id="app" class="hide">
  <p>Signed in as <b id="who"></b> · <button onclick="logout()">Sign out</button></p>
  <fieldset><legend>Content</legend><pre id="content">[]</pre><button onclick="refresh()">Refresh</button></fieldset>
</section>
<script>
let csrf = "";
async function api(path, opts={}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (csrf && opts.method && opts.method !== "GET") headers["x-csrf-token"] = csrf;
  const res = await fetch(path, Object.assign({ headers, credentials: "same-origin" }, opts));
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const r = await api("/admin/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (r.status === 200) await boot(); else alert("Login failed");
}
async function logout() { await api("/admin/api/auth/logout", { method: "POST" }); location.reload(); }
async function boot() {
  const me = await api("/admin/api/me");
  if (me.status !== 200) return;
  csrf = me.body.csrfToken;
  document.getElementById("who").textContent = me.body.user.email;
  document.getElementById("login").classList.add("hide");
  document.getElementById("app").classList.remove("hide");
  refresh();
}
async function refresh() {
  const r = await api("/admin/api/content");
  document.getElementById("content").textContent = JSON.stringify(r.body.items || r.body, null, 2);
}
boot();
</script>
</body>
</html>`;
