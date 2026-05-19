// Plugin worker entry — Pressh-owned, runs inside each plugin's worker thread.
//
// At boot:
//   1. Reads the plugin's entry path + granted capabilities from workerData.
//   2. Constructs the worker-side SDK proxy bound to parentPort.
//   3. Dynamically imports the plugin's entry module.
//   4. Awaits plugin.register(sdk).
//   5. Posts { op: '__ready' } back to the host.
//
// The host's plugin-rpc dispatcher receives every subsequent message,
// runs the capability check, and dispatches to core/engine.
export {};
//# sourceMappingURL=worker-entry.js.map