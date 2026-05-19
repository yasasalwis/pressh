// Iframe shim — served as a static script to plugin admin iframes.
//
// Performs a handshake with the parent studio window via postMessage,
// receives a short-TTL session token, and exposes a Promise-based RPC
// API the plugin's iframe HTML can call. Every call is forwarded
// through the studio to the plugin's worker, with capability check.
//
// See docs/ARCHITECTURE.md §11.

export {};
