import { beforeEach, describe, expect, test } from "vitest";
import { collectMetadata } from "./collectMetadata";
import { oembedEndpoint, parseOembed } from "./oembed";
import { fakeDeps, fakeNet } from "../test.net";

beforeEach(() => fakeNet.reset());

const YT = "https://www.youtube.com/watch?v=abc123";
const answer = JSON.stringify({ title: "A talk", author_name: "Someone", thumbnail_url: "https://i.ytimg.com/vi/abc123/hq.jpg" });

describe("oembedEndpoint", () => {
  test("known providers get the page URL as a parameter", () => {
    const url = new URL(oembedEndpoint(YT)!);
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/oembed");
    expect(url.searchParams.get("url")).toBe(YT);
    expect(oembedEndpoint("https://youtu.be/abc123")).not.toBeNull();
    expect(oembedEndpoint("https://x.com/a/status/1")).toContain("publish.twitter.com");
  });
  test.each(["https://example.com/", "https://evil.example/?u=youtube.com", "ftp://youtube.com/x", "not a url", "https://youtube.com.evil.example/"])(
    "%s has none",
    (url) => expect(oembedEndpoint(url)).toBeNull(),
  );
});

describe("parseOembed", () => {
  test("title, author and thumbnail", () => {
    expect(parseOembed(JSON.parse(answer), "youtube")).toEqual({
      title: "A talk",
      description: "By Someone",
      imageUrl: "https://i.ytimg.com/vi/abc123/hq.jpg",
    });
  });
  test("a tweet has no title: the author stands in", () => {
    expect(parseOembed({ author_name: "Ada", html: "<blockquote>" }, "X").title).toBe("Ada on X");
  });
  test("ignores junk and non-http images", () => {
    expect(parseOembed(null, "x")).toEqual({});
    expect(parseOembed({ title: 5, thumbnail_url: "javascript:alert(1)" }, "x")).toEqual({ title: undefined, description: undefined, imageUrl: undefined });
  });
});

describe("collectMetadata falls back to oEmbed", () => {
  test("when the page itself is blocked", async () => {
    fakeNet.serve("www.youtube.com", "Forbidden", { path: "/watch", status: 403 });
    fakeNet.serve("www.youtube.com", answer, { path: "/oembed", contentType: "application/json" });
    const out = await collectMetadata(YT, fakeDeps());
    expect(out).toMatchObject({ status: "done", meta: { title: "A talk", imageUrl: "https://i.ytimg.com/vi/abc123/hq.jpg" } });
  });

  test("when the page has no title; the page's own fields win", async () => {
    fakeNet.serve("www.youtube.com", `<html><head><meta property="og:description" content="Page text"></head></html>`, { path: "/watch" });
    fakeNet.serve("www.youtube.com", answer, { path: "/oembed", contentType: "application/json" });
    const out = await collectMetadata(YT, fakeDeps());
    expect(out).toMatchObject({ status: "done", meta: { title: "A talk", description: "Page text" } });
  });

  test("not used when the page has a title", async () => {
    fakeNet.serve("www.youtube.com", `<html><head><title>Real</title></head></html>`, { path: "/watch" });
    const out = await collectMetadata(YT, fakeDeps());
    expect(out).toMatchObject({ status: "done", meta: { title: "Real" } });
    expect(fakeNet.requests.some(([, u]) => u.includes("/oembed"))).toBe(false);
  });

  test("a failing provider leaves the original failure", async () => {
    fakeNet.serve("www.youtube.com", "Forbidden", { path: "/watch", status: 403 });
    expect(await collectMetadata(YT, fakeDeps())).toEqual({ status: "failed", retry: false });
  });

  test("other sites are never asked", async () => {
    fakeNet.serve("example.com", "Forbidden", { status: 403 });
    expect(await collectMetadata("https://example.com/", fakeDeps())).toEqual({ status: "failed", retry: false });
    expect(fakeNet.requests).toHaveLength(1);
  });

  test("a refused address is not worked around", async () => {
    fakeNet.dns.set("www.youtube.com", ["10.0.0.1"]);
    const out = await collectMetadata(YT, fakeDeps());
    expect(out.status).toBe("failed");
    expect(fakeNet.requests).toEqual([]);
  });
});
