# Windows Distribution

This project ships Windows installers for SqlMate (Tauri v2) as an **NSIS `.exe`** and a **WiX `.msi`**, built in CI on GitHub Actions and attached to the same GitHub release as the macOS build.

The current Windows build is **unsigned**. It works, but Windows SmartScreen shows an
"unknown publisher" warning on first run (users click **More info → Run anyway**). See
[Code signing](#code-signing-optional-deferred) below to remove that warning later.

## What gets built

| Installer | File | Notes |
|-----------|------|-------|
| NSIS      | `SqlMate_<version>_x64-setup.exe` | Per-user install, no admin/UAC required. |
| MSI (WiX) | `SqlMate_<version>_x64_en-US.msi`  | For enterprise / Group Policy deployment. |

Both embed the app and use the **WebView2 download bootstrapper** — a tiny installer that
fetches the Evergreen WebView2 runtime at install time (already present on Windows 10 1803+
and Windows 11, so most users download nothing). This is configured in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) under `bundle.windows`.

## GitHub Actions release workflow

The repo includes [`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml).

It:

- runs on tag pushes like `v0.4.1` (and `workflow_dispatch`)
- builds on a pinned `windows-2025` runner (see note below)
- installs Node (LTS) + Rust stable, with a Rust build cache
- installs NASM (for asm-optimized OpenSSL — see [native build notes](#native-build-notes))
- builds and bundles the NSIS `.exe` and MSI via `tauri-apps/tauri-action`
- uploads both installers to the GitHub release **draft** for that tag

No repository secrets are required for the unsigned build — it uses the automatic
`GITHUB_TOKEN`.

### One release, both platforms

`release-windows.yml` and `release-macos.yml` use the **same** `tagName` (`v__VERSION__`)
and `releaseName` (`SqlMate v__VERSION__`). `tauri-action` finds the existing release draft
for that tag and appends its assets, so a single `v*` tag produces **one** draft release
containing the macOS `.dmg`/`.app` **and** the Windows `.exe`/`.msi`.

Because both workflows trigger on the same tag push, they share a **`concurrency` lane**:

```yaml
concurrency:
  group: sqlmate-release-${{ github.ref }}
  cancel-in-progress: false
```

This block is present in **both** workflow files and must stay in sync. It serializes the
two runs so the first creates the draft and the second reuses it — without it, the two jobs
can race and create two duplicate draft releases with the artifacts split between them
(tauri-action#914).

### Runner pin

`release-windows.yml` pins `runs-on: windows-2025` rather than `windows-latest`.
GitHub migrated `windows-latest` to Windows Server 2025 in late 2025 and will migrate again
(VS 2026) during 2026. Pinning keeps the toolchain (MSVC, Windows SDK, Strawberry Perl, WiX)
stable across those migrations. `windows-latest` also works today if you prefer to track the
moving alias — just be aware a future migration can change the build environment silently.

## Native build notes

The Rust backend depends on `ssh2` with the `vendored-openssl` feature (for SSH tunneling),
which **compiles OpenSSL from source**. On the MSVC target that has two implications:

- **Perl is required** by OpenSSL's `Configure`. The GitHub runner already ships **Strawberry
  Perl on `PATH`**, so the workflow does *not* install Perl. Do **not** add a Perl install
  step: a second Perl shadowing Strawberry on `PATH` is the documented cause of the
  `Can't locate Locale/Maketext/Simple.pm` build failure.
- **NASM is optional.** Without it, `openssl-src` falls back to a slower pure-C build. The
  workflow installs NASM (`ilammy/setup-nasm`) for faster, asm-optimized, deterministic
  builds and as insurance against a pinned `openssl-src` that lacks the no-asm fallback.

`reqwest` uses `native-tls`, which on Windows is SChannel (no OpenSSL), and `keyring` uses
the Windows Credential Manager — neither needs extra build setup.

## Local builds (optional)

You do **not** need a local Windows toolchain to ship — CI builds everything. To build
locally on Windows, you need:

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/) (stable, `x86_64-pc-windows-msvc` — the default host target)
- **Visual Studio C++ Build Tools** with the *Desktop development with C++* workload and a
  Windows 10/11 SDK (provides the MSVC compiler and linker Rust needs)
- **Strawberry Perl** and **NASM** on `PATH` (needed to compile `ssh2`'s vendored OpenSSL)
- WebView2 runtime (preinstalled on Windows 10 1803+ / Windows 11)

Install the build tools (once), e.g. with winget:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id NASM.NASM -e
winget install --id StrawberryPerl.StrawberryPerl -e
```

Then build:

```powershell
npm install
npm run tauri:build -- --bundles nsis,msi
```

Output lands in:

- NSIS: `src-tauri/target/release/bundle/nsis/`
- MSI:  `src-tauri/target/release/bundle/msi/`

> The first build is slow — it compiles OpenSSL from source and the full `sqlx` stack.
> Subsequent builds are cached.

## Code signing (optional, deferred)

Unsigned installers trigger a SmartScreen "unknown publisher" warning. Two paths to sign:

### Azure Trusted Signing (recommended, modern)

A cloud signing service (~$10/month, no physical token). Wire it via
`bundle.windows.signCommand` in `tauri.conf.json` and these workflow secrets:

- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`

An EV / Trusted Signing certificate clears SmartScreen immediately.

### Classic signtool with a PFX certificate

Buy an OV or EV code-signing certificate, export it as a password-protected `.p12`/`.pfx`,
base64-encode it, and add:

- `WINDOWS_CERTIFICATE` — base64 of the `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD` — its export password

then set `bundle.windows.certificateThumbprint` and `timestampUrl` in `tauri.conf.json`.
An OV certificate still shows the warning until download reputation accrues; EV does not.

Tauri's Windows signing guide: <https://v2.tauri.app/distribute/sign/windows/>

## Configuring the AI (text-to-SQL) key

The AI text-to-SQL feature needs a Groq API key. The backend resolves it from the first
non-empty source (`resolve_groq_api_key` in `src-tauri/src/lib.rs`):

1. The `YOUR_GROQ_API_KEY` environment variable. During development this is loaded from a
   `.env` file by `dotenvy`; on an end-user machine it can be set as a normal user/system
   environment variable.
2. A `groq_api_key` field in `config.json` in the app config directory. This is the path
   for **installed** builds, which have no `.env` in their working directory.

On Windows the config file lives at:

```
%APPDATA%\com.sqlmate.db\config.json
```

with contents:

```json
{ "groq_api_key": "gsk_your_key_here" }
```

> Historically the key was read only from `.env` in the working directory, so text-to-SQL
> silently failed for installed users (this affected macOS too). The `config.json` fallback
> above fixes that. A future enhancement is a Settings UI to enter the key from inside the
> app (writing this same `config.json`), which fits naturally into the appearance/settings
> system currently under development.

## First Windows release checklist

1. Merge the Windows workflow and config to the default branch.
2. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Push a version tag:

   ```powershell
   git tag v0.4.1
   git push origin v0.4.1
   ```

4. Wait for **both** `release-windows` and `release-macos` workflows to finish.
5. Open the draft GitHub release — it should contain the `.exe`, `.msi`, `.dmg`, and `.app`.
6. Download the `.exe` and test it on a clean Windows machine (expect the SmartScreen
   click-through until signing is added).
7. Publish the release.
