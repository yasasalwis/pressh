import {DESIGNER_MARKUP} from "./designer.js";

/** Body markup for the Studio admin client: auth screens, app shell + sidebar, designer overlay. */
export const MARKUP = String.raw`
<button class="theme-toggle" id="auth-theme-toggle" onclick="toggleTheme()" title="Toggle theme">&#9681;</button>

<!-- ══════════════════ SETUP WIZARD ══════════════════ -->
<section id="setup" class="center hide">
  <div class="auth-card">
    <div class="brand"><div class="logo">P</div><div><h1>Pressh</h1><p>Secure-by-default CMS</p></div></div>
    <h2>Welcome aboard</h2>
    <p class="sub">Create your administrator account to get started — this only happens once.</p>
    <label for="su-email">Email</label>
    <input id="su-email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="su-password">Password</label>
    <input id="su-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" oninput="strength('su-password','su-bar','su-strength')">
    <div class="meter"><span id="su-bar"></span></div>
    <div class="meter-label" id="su-strength"></div>
    <label for="su-confirm">Confirm password</label>
    <input id="su-confirm" type="password" autocomplete="new-password" placeholder="Re-enter password">
    <div id="su-error" class="alert hide"></div>
    <button id="su-btn" class="btn" onclick="doSetup()">Create account &amp; sign in</button>
    <p class="foot">Plugins run <b>sandboxed</b>. Your data stays yours.</p>
  </div>
</section>

<!-- ══════════════════ LOGIN ══════════════════ -->
<section id="login" class="center hide">
  <div class="auth-card">
    <div class="brand"><div class="logo">P</div><div><h1>Pressh</h1><p>Secure-by-default CMS</p></div></div>
    <h2>Sign in</h2>
    <p class="sub">Welcome back. Sign in to your Studio.</p>
    <label for="lg-email">Email</label>
    <input id="lg-email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="lg-password">Password</label>
    <input id="lg-password" type="password" autocomplete="current-password" placeholder="Your password">
    <div id="login-error" class="alert hide"></div>
    <button id="login-btn" class="btn" onclick="doLogin()">Sign in</button>
    <p class="foot">Pressh Studio</p>
  </div>
</section>

<!-- ══════════════════ ACCEPT INVITE ══════════════════ -->
<section id="accept" class="center hide">
  <div class="auth-card">
    <div class="brand"><div class="logo">P</div><div><h1>Pressh</h1><p>Secure-by-default CMS</p></div></div>
    <h2>Accept your invitation</h2>
    <p class="sub">Set a password to activate your account and sign in.</p>
    <label for="ac-password">Password</label>
    <input id="ac-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" oninput="strength('ac-password','ac-bar','ac-strength')">
    <div class="meter"><span id="ac-bar"></span></div>
    <div class="meter-label" id="ac-strength"></div>
    <label for="ac-confirm">Confirm password</label>
    <input id="ac-confirm" type="password" autocomplete="new-password" placeholder="Re-enter password">
    <div id="ac-error" class="alert hide"></div>
    <button id="ac-btn" class="btn" onclick="doAccept()">Activate &amp; sign in</button>
    <p class="foot">Already have an account? <a href="#/" onclick="location.hash='';location.reload()"><b>Sign in</b></a></p>
  </div>
</section>

<!-- ══════════════════ APP SHELL ══════════════════ -->
<section id="app" class="hide">
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="sb-brand"><div class="logo">P</div><div><h1>Pressh Studio</h1><p>Admin</p></div></div>
      <nav class="sb-nav">
        <div class="nav-group-label">Content</div>
        <a class="nav-item" data-section="dashboard" href="#/dashboard"><span class="ico">&#128202;</span>Dashboard</a>
        <a class="nav-item" data-section="pages" href="#/pages"><span class="ico">&#128196;</span>Pages<span class="pill" id="nav-pages-count"></span></a>
        <a class="nav-item" data-section="types" href="#/types" data-cap="types.manage"><span class="ico">&#129521;</span>Content Types</a>
        <a class="nav-item" data-section="media" href="#/media" data-cap="media.read"><span class="ico">&#128247;</span>Media</a>
        <div class="nav-group-label" data-cap="users.manage">People</div>
        <a class="nav-item" data-section="users" href="#/users" data-cap="users.manage"><span class="ico">&#128101;</span>Users</a>
        <div class="nav-group-label" data-cap="themes.manage">Site</div>
        <a class="nav-item" data-section="appearance" href="#/appearance" data-cap="themes.manage"><span class="ico">&#127912;</span>Appearance</a>
        <a class="nav-item" data-section="settings" href="#/settings" data-cap="settings.manage"><span class="ico">&#9881;</span>Settings</a>
        <div class="nav-group-label" data-cap="audit.read">System</div>
        <a class="nav-item" data-section="plugins" href="#/plugins" data-cap="plugins.manage"><span class="ico">&#129513;</span>Plugins</a>
        <a class="nav-item" data-section="database" href="#/database" data-cap="db.manage"><span class="ico">&#128190;</span>Database</a>
        <a class="nav-item" data-section="privacy" href="#/privacy" data-cap="gdpr.manage"><span class="ico">&#128274;</span>Privacy &amp; GDPR</a>
        <a class="nav-item" data-section="audit" href="#/audit" data-cap="audit.read"><span class="ico">&#128220;</span>Audit Log</a>
      </nav>
      <div class="sb-foot">
        <div class="sb-user" id="sb-user"></div>
        <div class="row">
          <a id="site-link" class="ghost" href="#" target="_blank" rel="noopener">View site &#8599;</a>
          <button class="ghost" onclick="toggleTheme()" title="Toggle theme">&#9681;</button>
        </div>
        <div class="row">
          <button class="ghost" onclick="openPasswordModal()">Password</button>
          <button class="ghost danger" onclick="doLogout()">Sign out</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <button class="menu-btn" onclick="toggleSidebar()">&#9776;</button>
        <h2 id="view-title">Dashboard</h2>
        <div class="spacer"></div>
      </div>
      <div class="view" id="view"><div class="loading">Loading&hellip;</div></div>
    </div>
  </div>
</section>

${DESIGNER_MARKUP}

<div id="toast"></div>
`;
