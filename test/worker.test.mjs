import assert from "node:assert/strict";
import test from "node:test";
import { createWorker, PREFIX } from "../worker/handler.mjs";

const request = (path, options) => new Request("https://ropedia.com" + path, options);
const noNetwork = () => assert.fail("Unexpected origin fetch");
const assets = (handler) => ({ ASSETS: { fetch: handler } });

test("mount root redirects to trailing slash and preserves query", async () => {
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "?lite=1&x=a%2Fb"), assets(noNetwork));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Location"), "https://ropedia.com" + PREFIX + "/?lite=1&x=a%2Fb");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("mount requests read this Worker's assets with prefix removed", async () => {
  for (const path of ["/", "/home.css", "/hero.js", "/vendor/three.module.js", "/vendor/addons/libs/draco/gltf/draco_decoder.wasm"]) {
    const response = await createWorker(noNetwork).fetch(request(PREFIX + path + "?v=4"), assets(async (input) => {
      assert.equal(new URL(input.url).pathname, path);
      assert.equal(new URL(input.url).search, "?v=4");
      assert.equal(input.redirect, "manual");
      return new Response("asset");
    }));
    assert.equal(await response.text(), "asset");
  }
});

test("official paths and prefix lookalikes pass through without touching assets", async () => {
  for (const path of ["/", "/dataset", "/homie", "/xperience", PREFIX + "-extra", "/xperience/other", "/_next/static/a.js"]) {
    const original = request(path, { method: "POST", body: "original", headers: { Cookie: "session=1" } });
    const app = createWorker(async (input) => {
      assert.equal(input, original);
      assert.equal(input.headers.get("Cookie"), "session=1");
      assert.equal(await input.text(), "original");
      return new Response("website", { status: 201 });
    });
    assert.equal((await app.fetch(original, assets(noNetwork))).status, 201);
  }
});

test("workers.dev root access remains available", async () => {
  for (const path of ["/", "/home.css", "/vendor/three.module.js"]) {
    const original = new Request("https://ropedia-xperience-2.shiny-queen-7f0c.workers.dev" + path);
    const response = await createWorker(noNetwork).fetch(original, assets(async (input) => {
      assert.equal(input, original);
      return new Response("direct asset");
    }));
    assert.equal(await response.text(), "direct asset");
  }
});

test("HEAD, conditional and range request headers are preserved", async () => {
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "/home.css", {
    method: "HEAD", headers: { "If-None-Match": '"v1"', Range: "bytes=0-9" },
  }), assets(async (input) => {
    assert.equal(input.method, "HEAD");
    assert.equal(input.headers.get("If-None-Match"), '"v1"');
    assert.equal(input.headers.get("Range"), "bytes=0-9");
    return new Response(null, { status: 304, headers: { ETag: '"v1"' } });
  }));
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("ETag"), '"v1"');
});

test("static bytes, content type and cache headers pass through", async () => {
  const original = new Response(new Uint8Array([0, 127, 255]), {
    headers: { "Content-Type": "application/wasm", "Cache-Control": "public, max-age=3600" },
  });
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "/a.wasm"), assets(async () => original));
  assert.equal(response, original);
  assert.equal(response.headers.get("Content-Type"), "application/wasm");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 127, 255]));
});

test("HTML canonical redirects stay under the project prefix", async () => {
  for (const [path, location, expected] of [
    ["/index.html", "/?v=1", PREFIX + "/?v=1"],
    ["/guide", "guide/", PREFIX + "/guide/"],
    ["/guide", "https://ropedia.com/guide/#intro", PREFIX + "/guide/#intro"],
  ]) {
    const response = await createWorker(noNetwork).fetch(request(PREFIX + path), assets(async () =>
      new Response(null, { status: 308, headers: { Location: location } })));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), "https://ropedia.com" + expected);
  }
});

test("external redirects are not rewritten or followed", async () => {
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "/guide"), assets(async () =>
    new Response(null, { status: 302, headers: { Location: "https://example.org/paper" } })));
  assert.equal(response.headers.get("Location"), "https://example.org/paper");
});

test("asset self-redirect is rejected", async () => {
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "/guide"), assets(async () =>
    new Response(null, { status: 302, headers: { Location: "/guide" } })));
  assert.equal(response.status, 502);
});

test("missing files and asset errors keep their real status", async () => {
  for (const status of [404, 500, 503]) {
    const response = await createWorker(noNetwork).fetch(request(PREFIX + "/missing.js"), assets(async () =>
      new Response("missing or failed", { status })));
    assert.equal(response.status, status);
    assert.equal(await response.text(), "missing or failed");
  }
});

test("mounted static content rejects writes", async () => {
  const response = await createWorker(noNetwork).fetch(request(PREFIX + "/", { method: "POST", body: "data" }), assets(noNetwork));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});
