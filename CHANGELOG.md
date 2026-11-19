# Changelog

Changes in this fork compared to the original [jdickey1/imap-email-mcp](https://github.com/jdickey1/imap-email-mcp) 1.0.0.

## 1.1.0

### New tools
- **`reply_email`**: reply or reply-all in the same conversation thread (`In-Reply-To`/`References`, "Re:" subject, quoted original, including HTML-only emails). Send now or save as a draft. Marks the original as answered when sent.
- **`send_draft`**: send a saved draft exactly as written (recipients, body, attachments), then remove it from Drafts. Restores reply threading that Proton strips from saved drafts.
- **`mark_email`**: mark read/unread and star/unstar, one or many emails.
- **`move_email`**: move or archive one or many emails; folder names resolved case- and delimiter-insensitively, special folders like Archive found by their IMAP flag.
- **`download_attachment`**: save one (by index or name) or all attachments; never overwrites existing files.

### Improved tools
- **Attachments** on `send_email`, `create_draft`, `update_draft`, `reply_email` (25 MB total).
- **`search_emails`**: new filters `to`, `text`, `since`, `before`, `unread_only`, `starred_only`, `has_attachment`, `all_folders`; results include folder, one-line preview, unread/starred/attachment flags, and a total match count. Date filters use local time.
- **`list_emails`**: previews and unread/starred/attachment flags; `unseen_only` and `since_date` can now be combined (previously one overrode the other).
- **`get_email`**: attachments are numbered for use with `download_attachment`.
- **`list_folders`**: returns real folder paths (e.g. `Folders/Receipts`, previously shown as `Folders.Receipts`, which didn't work in other tools).
- **`delete_email`**: moves to Trash by default; permanent deletion only with `permanent: true` or when deleting from Trash. Reports which email was deleted.
- **`update_draft`**: checks the draft exists, saves the new version first, then removes the old one (previously deleted first, so a failure could lose the draft).
- Drafts are now built with nodemailer's message composer (correct encoding of non-ASCII subjects/names, attachments, Bcc kept on drafts).

### New settings
- `FROM_NAME`: sender display name.
- `SIGNATURE_FILE` (default `signature.txt` next to `index.js`): automatic signature on new emails, drafts and replies; skipped if already present; `include_signature: false` to turn off per email. Re-read on every use.
- `IMAP_PASSWORD_CREDENTIAL`: read the password from the computer's password store instead of the config file: Windows Credential Manager, macOS Keychain, or the Linux Secret Service keyring (`secret-tool`). Includes `save-password.ps1` (Windows) and `save-password.sh` (macOS/Linux) to save it securely.
- `SMTP_REQUIRE_TLS`: refuse to send unless SMTP upgrades to TLS.
- `ATTACHMENT_DIR`, `ATTACHMENT_BLOCK_DIRS`.

### Security
- Upgraded nodemailer 6.10 → 10.3.1, fixing 22 published advisories (including address-parsing bugs that could deliver a reply to a different domain than shown).
- All single email IDs must be positive whole numbers; ID lists are validated (max 500). Prevents IMAP sequence sets like `1:*` ("every message") from reaching delete/update operations.
- Attachments are refused from system and app-settings folders (Windows: AppData, ProgramData, Windows; macOS: `~/Library`, `/Library`, `/System`, `/etc`, `/var`, `/usr`; Linux: `/etc`, `/proc`, `/sys`, `/var`, `/usr`, `/root`, ...), hidden dot-folders in the user folder, the server's own folder, and key/certificate/password/settings files, checked by real path (symlinks, junctions and `..` resolved). Case-insensitive on Windows/macOS, case-sensitive on Linux.
- Downloads can only be saved inside the Downloads folder (or `ATTACHMENT_DIR`), checked by real path.
- Reply references no longer include Proton-internal message IDs.

### Performance
- Listing and searching fetch only the IDs of matches, then headers for just the emails shown (previously downloaded headers for every match).
- Result limits capped at 100; folder list fetched once per request.
- Fixed: multi-email operations used `SEARCH UID a,b,c`, which Proton Bridge answers with only one match, so bulk moves silently affected one email. Now uses `UID FETCH`.

### Requirements
- Node.js 20 or newer (required by nodemailer 10).

### Platforms
- Windows, macOS and Linux. The macOS and Linux password-store and blocklist rules are covered by automated checks but have not yet been tried on a real Mac or Linux machine; reports welcome.

### Known limitations
- IMAP STARTTLS (`autotls`) is not supported: the `imap` library's STARTTLS upgrade crashes on current Node. Use implicit TLS (`IMAP_TLS=true`, e.g. Proton Bridge in SSL mode).
- `npm audit` reports a regular-expression DoS in an old `semver` used by `imap` → `utf7`. It is only reachable through version strings, not email content.
