# Installable app and offline use

Bauplan is a Progressive Web App (PWA). On a supported browser, use **Install app** or **Add to Home Screen** in the browser menu. On iPhone or iPad, open the site in Safari, choose **Share**, then **Add to Home Screen**. The app must be served over HTTPS, except when testing on localhost.

## Before going offline

1. Open Bauplan while online and sign in on the browser profile and device you will use offline.
2. Allow the service worker to finish installing, then open the project once so its workspace snapshot is saved.
3. Reopen the app online after updates so the latest static app shell is installed.

The app shell and versioned static assets are cached. Authenticated API responses, private file URLs, and other server responses are not cached by the service worker. Workspace data and queued file uploads are stored locally in account-scoped IndexedDB. Previously uploaded document contents, OCR, and server-backed account or administration settings require a connection.

## Offline behavior

While offline, the previously cached workspace can be viewed and edited. Creates, edits, and deletes are written to the local workspace and queued for replay. Document uploads are queued with their file data. The header shows connection and pending-sync status; queued changes synchronize when a connection returns or when **Sync changes now** is selected.

The server checks each queued change against the exact row the device originally edited. If another device or user changed that row first, Bauplan keeps both versions and pauses that change for a decision:

- **Use server version** discards the queued local change.
- **Keep offline changes** rebases the local version on the current server row and retries it.

Resolve conflicts before signing out or changing accounts, or explicitly confirm discarding the pending work. Successful sign-out clears this account's local snapshot and queue.

Offline access is available only after the account has been used on that browser profile. A browser cannot verify whether a server-side session was revoked while the device was disconnected; offline access is therefore device/profile scoped, not a fresh authentication check. Local browser storage is not encrypted and should not be used on a shared browser profile. Clearing browser site data also removes the offline workspace and any unsynchronized changes.
