# Hostinger website downloads

Publishing a stable GitHub release runs `.github/workflows/publish-website-downloads.yml`. It downloads the signed release installers, verifies their GitHub SHA-256 digests, uploads them to Hostinger over SSH, checks their public URLs, then atomically replaces `/downloads/website-downloads.json`. The website reads that manifest at runtime. A failed upload leaves the previous manifest and links intact.

## One-time setup

1. Deploy the updated `sqlMate-landing` static export once. Its `DownloadActions` component reads the manifest; older site builds still contain versioned download links. Do not remove the hosted `downloads/` directory when uploading the site.
2. In Hostinger hPanel for `sqlmate.io`, enable **Advanced > SSH Access**. Generate a dedicated, unencrypted deploy key for unattended GitHub Actions use:

   ```bash
   ssh-keygen -t ed25519 -C sqlmate-github-release -f "$HOME/.ssh/sqlmate-hostinger-deploy" -N ""
   ```

3. Add the contents of `~/.ssh/sqlmate-hostinger-deploy.pub` to Hostinger's **Add SSH key** section. Keep the private key out of the repository and chat. Test an interactive SSH connection with the host, username, and port shown in hPanel, and verify the server fingerprint before trusting it.
4. In `Nitish27/sqlMate` > **Settings > Secrets and variables > Actions**, add these repository **secrets**:

   | Secret | Value |
   | --- | --- |
   | `HOSTINGER_SSH_PRIVATE_KEY` | Full contents of `~/.ssh/sqlmate-hostinger-deploy` including the BEGIN/END lines. |
   | `HOSTINGER_SSH_KNOWN_HOSTS` | The verified `[host]:port` entry from `~/.ssh/known_hosts`. Run `ssh-keygen -F '[host]:port' -f "$HOME/.ssh/known_hosts"` to locate it; copy the key line, not the comment. |

5. Add these repository **variables** on the adjacent Variables tab. Use the exact hPanel values; confirm the document-root path via SSH or Hostinger File Manager before setting it:

   | Variable | Example |
   | --- | --- |
   | `HOSTINGER_HOST` | Hostinger SSH IP or host name. |
   | `HOSTINGER_PORT` | `65002` if that is the port shown in hPanel. |
   | `HOSTINGER_USER` | Hostinger SSH username. |
   | `HOSTINGER_DOWNLOADS_PATH` | `/home/USERNAME/domains/sqlmate.io/public_html/downloads` |

The workflow accepts only a `sqlmate.io` downloads path under the hosting account, so a typo cannot redirect uploads to another website. Do not store the Hostinger password in Actions.

## First sync and later releases

Because v0.8.0 was published before this workflow existed on `main`, run **Actions > publish-website-downloads > Run workflow** with `tag` set to `v0.8.0` after merging the workflow. For future stable releases, the `release: published` event runs it automatically. It refuses draft, prerelease, incomplete, or non-latest releases and never updates the website manifest before all three public installer URLs work.

Verify `https://sqlmate.io/downloads/website-downloads.json`, the three versioned installer URLs in that file, and the site's Mac/Windows buttons. If the workflow fails, inspect the failed step; the website keeps its previous links. Rerun the same workflow after fixing credentials or path settings.
