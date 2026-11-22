import { describe, expect, test } from "vitest";
import { decodeBody, isHtmlContentType, parseHtmlMeta } from "./htmlMeta";

const base = "https://example.com/articles/one";

describe("parseHtmlMeta", () => {
  test("Open Graph beats the plain tags; relative links resolve against the page", () => {
    const meta = parseHtmlMeta(
      `<html><head><title>Plain title</title>
       <meta name="description" content="Plain description">
       <meta property="og:title" content="OG &amp; title">
       <meta property="og:description" content="OG description">
       <meta property="og:image" content="/img/cover.png">
       <link rel="shortcut icon" href="../favicon.png">
       </head><body><h1>x</h1></body></html>`,
      base,
    );
    expect(meta).toEqual({
      title: "OG & title",
      description: "OG description",
      imageUrl: "https://example.com/img/cover.png",
      faviconUrl: "https://example.com/favicon.png",
    });
  });

  test("falls back to <title>, the meta description and /favicon.ico", () => {
    const meta = parseHtmlMeta(
      `<head>\n<TITLE>\n  A   spaced\n title </TITLE><META NAME=Description CONTENT='Short one'></head>`,
      base,
    );
    expect(meta).toEqual({
      title: "A spaced title",
      description: "Short one",
      imageUrl: undefined,
      faviconUrl: "https://example.com/favicon.ico",
    });
  });

  test("reads attributes in any order and tolerates > inside quotes", () => {
    const meta = parseHtmlMeta(
      `<head><meta content="a > b" property="og:description"><link href="/i.svg" rel="icon" type="image/svg+xml"></head>`,
      base,
    );
    expect(meta.description).toBe("a > b");
    expect(meta.faviconUrl).toBe("https://example.com/i.svg");
  });

  test("prefers an icon over apple-touch-icon, and skips mask-icon and data: URIs", () => {
    const html = (links: string) => `<head>${links}</head>`;
    expect(
      parseHtmlMeta(html(`<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/small.png">`), base).faviconUrl,
    ).toBe("https://example.com/small.png");
    expect(parseHtmlMeta(html(`<link rel="apple-touch-icon" href="/touch.png">`), base).faviconUrl).toBe(
      "https://example.com/touch.png",
    );
    expect(parseHtmlMeta(html(`<link rel="mask-icon" href="/m.svg">`), base).faviconUrl).toBe("https://example.com/favicon.ico");
    expect(parseHtmlMeta(html(`<link rel="icon" href="data:image/png;base64,AAAA">`), base).faviconUrl).toBe(
      "https://example.com/favicon.ico",
    );
  });

  test("ignores tags inside scripts, styles and comments, and everything after </head>", () => {
    const meta = parseHtmlMeta(
      `<head><!-- <title>Commented</title> --><script>var s = "<title>In script</title>";</script><title>Real</title></head>
       <body><meta property="og:title" content="From body"></body>`,
      base,
    );
    expect(meta.title).toBe("Real");
  });

  test("only http(s) image and icon URLs; over-long values are cut or dropped", () => {
    const meta = parseHtmlMeta(
      `<head><title>${"t".repeat(900)}</title><meta name="description" content="${"d".repeat(3000)}">
       <meta property="og:image" content="javascript:alert(1)"></head>`,
      base,
    );
    expect(meta.title).toHaveLength(500);
    expect(meta.description).toHaveLength(2000);
    expect(meta.imageUrl).toBeUndefined();
  });

  test("a page with no head still works, and nothing breaks on garbage", () => {
    expect(parseHtmlMeta("<title>Only</title>", base).title).toBe("Only");
    expect(parseHtmlMeta("", base).title).toBeUndefined();
    expect(parseHtmlMeta("<<<>>>&&&", base).title).toBeUndefined();
  });
});

describe("body decoding", () => {
  test("uses the declared charset, falls back to UTF-8", () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café"
    expect(decodeBody(latin1, "text/html; charset=iso-8859-1")).toBe("café");
    expect(decodeBody(new TextEncoder().encode("café"), "text/html")).toBe("café");
    expect(decodeBody(new TextEncoder().encode("café"), "text/html; charset=bogus-9")).toBe("café");
  });

  test("HTML content types", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isHtmlContentType("application/pdf")).toBe(false);
    expect(isHtmlContentType("")).toBe(false);
  });
});
