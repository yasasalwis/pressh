// Example Pressh plugin. Runs in an isolated worker thread; the only way it can
// reach the host is the injected, capability-gated `host` API. It declares
// `storage.read:greetings` in its manifest — any other access is denied.

/** @param {{ name?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function greet(args, host) {
  host.log("info", "hello plugin invoked");
  const name = typeof args?.name === "string" ? args.name : "world";
  return { message: `Hello, ${name}!` };
}
