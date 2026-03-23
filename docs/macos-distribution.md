# macOS Distribution

This project is set up to ship signed and notarized macOS bundles with Tauri v2.

## What you need

- A paid Apple Developer Program membership.
- A `Developer ID Application` certificate for distributing outside the Mac App Store.
- An App Store Connect API key with `Developer` access for notarization.
- A stable app identifier. This repo currently uses `com.sqlmate.db` in `src-tauri/tauri.conf.json`.

## Local signed and notarized builds

1. Install your `Developer ID Application` certificate into the `login` keychain on the Mac that will build the app.
2. Find the signing identity name:

```bash
security find-identity -v -p codesigning
```

3. Export these environment variables in the shell you will use for the build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY="ABCDEFGHIJ"
export APPLE_API_KEY_PATH="$HOME/private_keys/AuthKey_ABCDEFGHIJ.p8"
```

4. For universal builds, make sure both Rust macOS targets are installed:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

5. Build signed and notarized bundles:

```bash
npm run dist:macos
```

Universal build:

```bash
npm run dist:macos:universal
```

Tauri will sign the bundle, submit it for notarization, wait for completion, and staple the notarization ticket unless you explicitly pass `--skip-stapling`.

## GitHub Actions release workflow

The repo includes `.github/workflows/release-macos.yml`.

It:

- runs on tag pushes like `v0.4.1`
- imports your Apple certificate into a temporary keychain
- builds a universal macOS app
- notarizes it with your App Store Connect API key
- uploads the `.app` and `.dmg` artifacts to a GitHub release draft

## Required GitHub secrets

Set these secrets in the GitHub repository before running the workflow:

- `APPLE_CERTIFICATE`
  Base64-encoded `.p12` export of your `Developer ID Application` certificate.
- `APPLE_CERTIFICATE_PASSWORD`
  Password used when exporting that `.p12` file.
- `KEYCHAIN_PASSWORD`
  Temporary keychain password used on the GitHub runner.
- `APPLE_API_ISSUER`
  App Store Connect API issuer ID.
- `APPLE_API_KEY`
  App Store Connect API key ID.
- `APPLE_API_KEY_CONTENT`
  Full contents of the downloaded `.p8` private key.

## Exporting the signing certificate for CI

1. Open `Keychain Access`.
2. Open `My Certificates`.
3. Find the `Developer ID Application` certificate entry.
4. Export it as a `.p12` file with a password.
5. Convert it to base64:

```bash
openssl base64 -A -in /path/to/certificate.p12 -out certificate-base64.txt
```

Use the contents of `certificate-base64.txt` for the `APPLE_CERTIFICATE` secret.

## First release checklist

1. Enroll in the Apple Developer Program.
2. Create and install a `Developer ID Application` certificate.
3. Create an App Store Connect API key and save the `.p8` file safely.
4. Add the GitHub secrets listed above.
5. Push a version tag:

```bash
git tag v0.4.1
git push origin v0.4.1
```

6. Wait for the `release-macos` workflow to finish.
7. Download the generated `.dmg` from the draft GitHub release and test it on another Mac.

## Notes

- A free Apple developer account is not enough for notarized public distribution.
- If signing fails locally, double-check that the certificate is valid in the `login` keychain and that `APPLE_SIGNING_IDENTITY` exactly matches the result of `security find-identity -v -p codesigning`.
- If notarization fails, confirm the API key belongs to the same Apple team that owns the `Developer ID Application` certificate.
