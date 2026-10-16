import assert from "node:assert/strict";
import test from "node:test";

import { buildWebsiteRelease } from "./prepare-website-downloads.mjs";

const names = [
  "SqlMate_0.8.0_universal.dmg",
  "SqlMate_0.8.0_x64-setup.exe",
  "SqlMate_0.8.0_x64_en-US.msi",
];

const release = {
  tag_name: "v0.8.0",
  draft: false,
  prerelease: false,
  assets: names.map((name, index) => ({
    name,
    size: 100 + index,
    digest: `sha256:${String(index + 1).repeat(64)}`,
  })),
};

test("selects the three public installers and generates a versioned manifest", () => {
  const result = buildWebsiteRelease(release);
  assert.deepEqual(result.assetNames, names);
  assert.deepEqual(result.manifest, {
    version: "0.8.0",
    macos: `https://sqlmate.io/downloads/${names[0]}`,
    windows: `https://sqlmate.io/downloads/${names[1]}`,
    windowsMsi: `https://sqlmate.io/downloads/${names[2]}`,
  });
  assert.match(result.checksums, /^1{64}  SqlMate_0\.8\.0_universal\.dmg/m);
});

test("rejects incomplete, draft, or unverified releases before deployment", () => {
  assert.throws(() => buildWebsiteRelease({ ...release, assets: release.assets.slice(0, 2) }), /Missing installer/);
  assert.throws(() => buildWebsiteRelease({ ...release, draft: true }), /published stable release/);
  assert.throws(() => buildWebsiteRelease({ ...release, assets: [{ ...release.assets[0], digest: null }, ...release.assets.slice(1)] }), /SHA-256/);
  assert.throws(() => buildWebsiteRelease({ ...release, tag_name: "v0.8.0-rc1" }), /version tag/);
});
