import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildWebsiteRelease(release) {
  if (release?.draft !== false || release?.prerelease !== false) {
    throw new Error("Website downloads require a published stable release");
  }
  if (typeof release.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error("Invalid version tag");
  }

  const version = release.tag_name.slice(1);
  const assetNames = [
    `SqlMate_${version}_universal.dmg`,
    `SqlMate_${version}_x64-setup.exe`,
    `SqlMate_${version}_x64_en-US.msi`,
  ];

  const checksums = assetNames.map((name) => {
    const asset = release.assets?.find((item) => item.name === name);
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Missing installer: ${name}`);
    }
    if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
      throw new Error(`Missing SHA-256 digest: ${name}`);
    }
    return `${asset.digest.slice(7).toLowerCase()}  ${name}`;
  }).join("\n") + "\n";

  const url = (name) => `https://sqlmate.io/downloads/${name}`;
  return {
    assetNames,
    checksums,
    manifest: {
      version,
      macos: url(assetNames[0]),
      windows: url(assetNames[1]),
      windowsMsi: url(assetNames[2]),
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [releasePath, outputDir] = process.argv.slice(2);
  if (!releasePath || !outputDir) {
    throw new Error("Usage: node prepare-website-downloads.mjs <release.json> <output-dir>");
  }
  const result = buildWebsiteRelease(JSON.parse(readFileSync(releasePath, "utf8")));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "website-downloads.json"), JSON.stringify(result.manifest, null, 2) + "\n");
  writeFileSync(resolve(outputDir, "checksums.txt"), result.checksums);
  writeFileSync(resolve(outputDir, "asset-names.txt"), result.assetNames.join("\n") + "\n");
}
