# Backups and restore

Admins can download or restore a portable ZIP backup in **Settings → Administration → Backup and restore**. During first-run setup, a backup can be imported before creating an account.

## Backup contents

The versioned archive contains the SQLite application data, project and personal settings, user accounts (including password hashes), and every uploaded file (documents and collection images, with their folder structure). It does not contain active login sessions. OIDC settings, calendar-feed tokens, and other values stored in application settings are included, so treat backup files as sensitive credentials and store them securely.

OCR language models are stored separately under `DATA_DIR/ocr-models` and are not included. Download them again from OCR settings if needed. Environment variables and external identity-provider configuration are also not part of the archive.

Web Push VAPID keys are sensitive application settings and are included. Device subscriptions and notification jobs/delivery history are excluded from portable backups and cleared on restore. Users must explicitly enable push again on each device after signing in.

Paperless source links and local document copies are preserved. Personal Paperless API tokens, automatic tag-import rules and per-user access grants are excluded. After restore, administrators must re-grant member access before members reconnect and explicitly re-enable automation; administrators retain implicit access. Historical unresolved transfers must be reconciled explicitly, not replayed as new uploads. The deployment encryption key is external to the archive. Bauplan backups do not replace a backup of the Paperless archive. See [Paperless integration](paperless.md).

The application accepts ZIP backups up to 128 MB and limits expanded archive contents to 256 MB. Only archives created with a supported Bauplan backup format version are accepted.

## Restore

Restoring from Settings replaces the current database content and uploaded files; it does not merge. The app validates the whole archive and its document hashes before changing live data. Keep a separate copy of the current backup before restoring.

Backups from older versions with a flat upload folder can still be restored: files are sorted into the current folder layout, and idea images stored as documents are converted to collection images.

All active sessions are invalidated after restore. The user performing the restore is signed out and must sign in again with an account from the imported backup. During first-run setup, importing a backup with accounts sends the user to sign-in instead of creating a new admin account. If a backup contains no accounts, setup continues with the first-admin form.

Use an in-app backup to move the app's database and uploaded documents together. For an operational filesystem backup, also preserve the configured `DATA_DIR` and `UPLOADS_DIR`; this additionally retains local OCR language models. See [operations](operations.md).
