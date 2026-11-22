import { vi } from "vitest";

// Tests never use the real network: the Node transport is swapped for the
// fake one in test.net.ts.
vi.mock("./lib/nodeTransport", async () => {
  const { fakeDeps } = await import("./test.net");
  return { nodeDeps: fakeDeps };
});
