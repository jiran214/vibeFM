import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homePath = new URL("./home.html", import.meta.url);

async function readHome() {
  return readFile(homePath, "utf8");
}

test("home page exposes the creation form and accessible tabs", async () => {
  const html = await readHome();

  assert.match(html, /<form[^>]+id="create-form"/u);
  assert.match(html, /id="radio-source"/u);
  assert.match(html, /role="tablist"/u);
  assert.equal((html.match(/role="tab"(?:\s|>)/gu) ?? []).length, 2);
  assert.match(html, /aria-controls="saved-playlists-panel"/u);
  assert.match(html, /aria-controls="created-shows-panel"/u);
});

test("both content panels use responsive card grids", async () => {
  const html = await readHome();

  assert.match(html, /id="saved-playlists-panel"[^>]+role="tabpanel"/u);
  assert.match(html, /id="created-shows-panel"[^>]+role="tabpanel"/u);
  assert.match(html, /class="playlist-grid"/u);
  assert.match(html, /class="show-grid"/u);
  assert.match(html, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u);
  assert.match(html, /@media\s*\(max-width:\s*760px\)/u);
});

test("page script implements tab, create, and import states", async () => {
  const html = await readHome();

  assert.match(html, /function\s+activateTab/u);
  assert.match(html, /setAttribute\("aria-selected"/u);
  assert.match(html, /createForm\.addEventListener\("submit"/u);
  assert.match(html, /data-import/u);
  assert.match(html, /导入完成/u);
  assert.match(html, /创建成功/u);
});

test("document ids are unique and image covers have alternative text", async () => {
  const html = await readHome();
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/gu), (match) => match[1]);
  const images = Array.from(html.matchAll(/<img\s+[^>]*>/gu), (match) => match[0]);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(images.length >= 9);
  images.forEach((image) => assert.match(image, /\salt="[^"]+"/u));
});
