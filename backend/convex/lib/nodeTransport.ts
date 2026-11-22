"use node";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import type { FetchDeps, HopResponse } from "./safeFetch";

// The real network side of safeFetch.ts. Imported only by metadataFetch.ts
// (a "use node" action file); tests replace this module (test.setup.ts).

const USER_AGENT = "Mozilla/5.0 (compatible; PitaraBot/1.0; +https://pitara.pknspace.com)";

function decoder(encoding: string | undefined): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  switch ((encoding ?? "").toLowerCase().trim()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function one(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function requestOnce(
  url: URL,
  address: string,
  { timeoutMs, maxBytes }: { timeoutMs: number; maxBytes: number },
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    // Connect to the address that was checked, not to the name: the name could
    // resolve differently a second time. Host and SNI keep the real name.
    const req = (secure ? https : http).request(
      {
        host: address,
        port: url.port !== "" ? Number(url.port) : secure ? 443 : 80,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: {
          Host: url.host,
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en",
          Connection: "close",
        },
        ...(secure && isIP(hostname) === 0 ? { servername: hostname } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = one(res.headers.location);
        const contentType = one(res.headers["content-type"]);
        if (status >= 300 && status < 400) {
          res.destroy();
          finish(() => resolve({ status, location, contentType, body: new Uint8Array() }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish(() => resolve({ status, location, contentType, body: new Uint8Array(Buffer.concat(chunks)) }));
        const unzip = decoder(one(res.headers["content-encoding"]));
        const stream: NodeJS.ReadableStream = unzip === null ? res : res.pipe(unzip);
        unzip?.on("error", done); // a stream cut short by the size cap is not an error
        res.on("error", (err) => finish(() => reject(err)));
        stream.on("data", (chunk: Buffer) => {
          const room = maxBytes - size;
          chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          size += Math.min(chunk.length, room);
          if (size >= maxBytes) {
            done();
            req.destroy();
          }
        });
        stream.on("end", done);
        stream.on("close", done);
      },
    );
    const timer = setTimeout(() => {
      finish(() => reject(new Error("timeout")));
      req.destroy();
    }, Math.max(1, timeoutMs));
    req.on("error", (err) => finish(() => reject(err)));
    req.end();
  });
}

export function nodeDeps(): FetchDeps {
  return {
    now: () => Date.now(),
    resolve: async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((r) => r.address),
    request: requestOnce,
  };
}
