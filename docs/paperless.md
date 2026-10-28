# Paperless-ngx integration

The optional integration connects Bauplan to one self-hosted Paperless-ngx instance. Each authorized Bauplan member uses their **own Paperless API token**. Paperless remains the archive; Bauplan stores local document copies for project work.

Transfers can be manual in either direction or use an explicitly enabled tag-based import from Paperless, **not continuous two-way synchronization**. Changing metadata, replacing files or deleting a document in either app does not change the other app.

## Configure the instance

1. Configure `PAPERLESS_SETTINGS_KEY` on the Bauplan server before connecting personal accounts. It must contain exactly 64 hexadecimal characters (32 random bytes); generate it with `openssl rand -hex 32` and keep it outside source control. The key encrypts stored personal API tokens; do not casually rotate it or lose it. Docker Compose passes the variable from your deployment environment.
2. An administrator enables Paperless in **Settings → Administration** and enters the Paperless base URL, without `/api`. This URL must be reachable from the Bauplan container/server. `localhost` inside a container means that container, not the host.
3. Configure the browser-facing URL if it differs from the internal server URL. Links use this URL; they do not carry API tokens.
4. In **Settings → Users**, enable **Paperless access** for each member who should use the connector. All members start without access, including existing members when upgrading to database migration v8. Administrators always have access without a grant; pending accounts never have data access.
5. Each authorized member connects a personal token under **Settings → Personal**. Create it in the Paperless profile. Search and preview use only that member's permissions. Export additionally requires upload permissions.

Members without a grant see neither the personal Paperless panel nor the document toolbar, selections or source/status controls. Server functions and background workers enforce the same restriction; hiding UI is not the authorization boundary. Administrator settings remain available, and configured document tools remain visible to authorized users even when transfers are globally disabled. Open pages refresh access settings every 30 seconds; server-side revocation applies immediately to new operations and import commits.

Revoking access requires confirmation, removes the personal token and automatic tag-import rule, and pauses queued/active export tracking while preserving accepted task IDs. A request already accepted by Paperless may still finish remotely; revocation cannot recall it. After granting access again, the member must reconnect their token, explicitly re-enable any automation, and reconcile paused transfers before retrying. Already imported local files and shared source links are not deleted; all approved project members can still use the ordinary local documents.

Use HTTPS outside a trusted local container network. Bauplan contacts only the configured destination; requests must not redirect credentials to a different host. No cloud service receives document content.

For paginated metadata lists, Bauplan constructs each page request using the configured server URL. Paperless's `next` value only indicates that another page exists; its destination is never followed. This also supports reverse proxies that advertise an internal host or HTTP URL in pagination responses, without forwarding tokens to those addresses.

Changing the configured instance invalidates personal connections. Disconnecting an account does not remove local files or source links. A Paperless link does not grant another Bauplan member access to the remote document; opening Paperless requires their own browser session.

### Local development with npm

Generate a key once in your terminal:

```sh
openssl rand -hex 32
```

Keep the generated value in a password manager or another secure location. In the terminal where you start Bauplan, set that same value and start the development server:

```sh
export PAPERLESS_SETTINGS_KEY='PASTE_YOUR_64_CHARACTER_HEX_KEY_HERE'
npm run dev
```

The exported variable remains set for subsequent starts in that terminal. In a new terminal, set it again using the **same key**. Restart the development server after changing its environment. Do not generate a fresh key on every start: existing encrypted tokens would become unreadable and users would need to reconnect.

The connector reads `process.env.PAPERLESS_SETTINGS_KEY` on the server. Exporting it before starting npm avoids reliance on framework-specific environment-file loading. Never prefix this secret with `VITE_`, expose it to client code, put it in a shared screenshot, or commit it to source control. There is currently no UI field for this encryption key.

For local testing, set the server URL to the address reachable from the machine running `npm run dev`, for example `https://paperless.example.de`. Leave the browser URL empty if your browser uses that same address; Bauplan then uses the server URL for links. Docker service names such as `http://paperless:8000` typically resolve only inside their Docker network, not on the host running npm.

After startup, enable the instance under **Settings → Administration**, connect your own Paperless API token under **Settings → Personal**, and try a non-sensitive test document. Import shares its local copy with the Bauplan project; export creates a real remote processing task.

If saving the URLs reports `no such column: browser_url` after updating an earlier development build, restart the Bauplan server with the updated code. Database migration v6 adds the missing source-link column and preserves existing links and credentials; do not delete the database. Existing links inherit the browser URL only from their matching configured instance. If that instance URL is no longer available, migration stops and rolls back instead of assigning an incorrect archive URL.

## Import into Bauplan

Choose **Import from Paperless** in Documents. Search the personal archive, filter the results and preview a document before selecting it. Import creates a local copy of the original file and retains its Paperless identity.

**Importing shares that local copy with every approved member of the Bauplan project**, even if they cannot see the original in Paperless. The confirmation explicitly explains this boundary.

Paperless text and metadata supply suggestions to Bauplan's existing rule-based field extraction. Review and confirm the amount, dates, contact, trade and assignment as an expense, offer or filed document. Import does not automatically create a financial record. Raw Paperless text is not retained as another full-text archive. If text is missing or insufficient, enter fields manually or explicitly request local analysis.

An already linked Paperless document resolves to the existing Bauplan document, without another file or financial record. File limits and supported formats still apply.

### Automatic import by tag (Paperless → Bauplan only)

Under **Settings → Personal → Your Paperless connection**, connect your own token, then choose an existing tag under **Automatically import from Paperless**. Confirm that every matching document's local copy will be shared with all approved Bauplan members and save the rule. The rule is off by default and personal to that account; another member cannot read or change it.

The running Bauplan server checks existing and newly tagged documents every five minutes, even with no browser open. Saving schedules the first pass immediately (normally within the worker's 15-second wake interval). One pass processes at most 25 matches in stable ID order. Larger result sets resume on the next page in subsequent passes, then start again at page one. The settings show the last pass's imported, skipped and failed counts plus any error. Failures are retried on subsequent scans; if a changing remote result set invalidates a page, the next pass starts at page one.

Imports create local documents only, retaining the original and the usual Paperless link. Suggested metadata is available through the existing assignment workflow, but no offer, expense, contact or payment is created automatically. The automation never uploads to Paperless, changes its tags or deletes remote documents. Removing the tag does not delete a local copy. Deleting a local copy while its source remains tagged allows it to be imported again.

Duplicate prevention is shared by automatic and manual imports:

- The same configured instance and Paperless document ID resolve to the existing shared source, including documents previously exported by Bauplan.
- Original SHA-256 contents are compared with local files of the same size, inside the import transaction. Byte-identical files reuse the existing document without overwriting reviewed fields. Different bytes are not considered duplicates based on names or OCR text.
- An unlinked identical local document receives the source link unless it has an unresolved transfer. If it already has a different source or unresolved transfer, that tracking is preserved and the new match is skipped. Such matches may be downloaded again in later scans for content comparison, but do not create another local copy.
- A durable per-rule lease prevents concurrent workers from claiming the same pass; the import transaction also prevents duplicate local creation by concurrent manual or automatic imports.

Select **Disable automatic import** and save to remove the rule. Disabling the integration or losing the owner's approved role pauses processing; disconnecting/deleting the account or changing the configured instance removes its rule. A running download cannot commit after its rule has been removed or replaced. Personal rules are excluded from portable backups and cleared on restore, so restoring cannot unexpectedly start new imports. Reconnect and explicitly enable the rule again.

## Archive Bauplan scans and uploads

Scan or upload normally; Bauplan saves the file locally first. In Documents, select one or several visible documents and choose **Transfer to Paperless**. Selection does not include hidden search results. Files still queued in a browser's offline storage must finish uploading to Bauplan first.

Review the filenames and titles. Supply a document date only when confirmed from the document itself, not from its upload time, payment date or due date. Optionally select existing Paperless tags, document type and correspondent. The integration does not create these metadata objects automatically.

Transfer uses the initiating member's personal account. A document has **one shared Paperless link**, not an archive copy for each member.

Paperless accepts uploads asynchronously:

- **Queued / transferring:** the request is being submitted.
- **Processing:** Paperless accepted a task; archiving has not finished.
- **Linked:** processing succeeded and a remote document ID is known.
- **Failed:** the individual document could not be archived.
- **Unknown / paused:** the outcome requires reconciliation or renewed access.

Mixed selections can partially succeed. Check the result for each document; a submitted batch is not an all-success archive confirmation. The local file stays available when Paperless is down or processing fails.

## Presence filters and status checks

Paperless tools are initially collapsed. A full-width **Paperless** header and its expandable tools share one panel above the document search. The header displays whether the tools are shown or hidden, with a matching chevron and accessible expanded state. Inside, filtering/import and selection actions are grouped separately. Expand it to show filters, transfer actions, document checkboxes and source-link details. Closing the tools clears the selection and resets the Paperless filter to all documents; ordinary search and category filters remain unchanged. Collapsing the tools does not cancel submitted transfers.

When the integration is enabled, Documents offers:

- **Present in Paperless:** a known, successfully established Paperless link, from either import or export.
- **Not present in Paperless:** no established link. A pending, failed or unknown transfer is still distinguished with its own badge.

These are **known-link filters**, not an exhaustive live inventory or content-based duplicate detector. An unlinked file might already exist in Paperless.

Use **Check Paperless status** to verify selected links with your own credentials. An unavailable server, revoked token, forbidden response or inaccessible document does not prove remote deletion. Bauplan retains the link and shows the access/check state instead of enabling a blind re-upload.

## Interrupted transfers and duplicates

Active and unresolved transfers are protected against repeated submissions. The server persists processing task IDs so it can reconcile accepted uploads independently of the open dialog.

A lost upload response is inherently ambiguous: Paperless may have accepted the file even though Bauplan did not receive its task ID. Bauplan does not assume the API has an idempotency key and does not automatically repeat that upload.

Resolve the transfer by finding and linking the existing authorized Paperless document. Do not rely on its filename alone. Abandoning tracking does **not** cancel remote processing or delete the remote file. A later upload could create a duplicate. Paperless duplicate-consumption failures remain explicit; they are not silently reported as a successful link to an unverified document.

## Backups and deployment

Local file copies and established source links belong in Bauplan backups. Personal Paperless tokens, automatic import rules and per-user access grants are excluded from portable backups. After restoring, administrators must explicitly grant member access again before members reconnect and opt into automation. Administrators retain their implicit access. Restoring must not replay old upload requests. Keep a separate backup of Paperless itself: Bauplan does not back up the remote archive.

The environment encryption key is not part of portable backups. Filesystem backups containing the live SQLite database may contain encrypted tokens and must be protected alongside the deployment secret.

The integration is disabled by default. Without it, existing scans, uploads, local recognition, offline work and budget calculations continue unchanged.

## Compatibility

The connector uses the Paperless REST API: token authorization, paginated document queries, metadata, original downloads/previews, multipart `post_document` and consumption task results. See the [Paperless API documentation](https://docs.paperless-ngx.com/api/) and the schema served by your installation at `/api/schema/view/`.

Requests explicitly select API version **9**. Installations that do not support it must be upgraded or require a separately implemented compatibility path; Bauplan does not silently switch to an unknown response format. Existing source links and explicit tracking abandonment remain available when the configured integration is disabled.

Automated tests use controlled responses. A particular installation's compatibility, reverse proxy, permissions and processing pipeline should be checked with a non-sensitive test document before using the integration for project records. No real Paperless installation or credentials were supplied during development; do not treat mocked tests as certification of a specific release.
