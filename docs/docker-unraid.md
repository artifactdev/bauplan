# Docker and Unraid setup

Bauplan runs as a Node.js container. The SQLite database and downloaded OCR language models use the persistent `/data` path; uploaded documents use `/uploads`. The app does not require a hosted database, authentication provider, OCR service, or file service.

## Plain Docker

Build the app image from the project root:

```sh
docker build -t bauplan:latest .
```

Create persistent host directories and start the container:

```sh
mkdir -p ./bauplan-data
mkdir -p ./bauplan-documents
docker run -d \
  --name bauplan \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "$(pwd)/bauplan-data:/data" \
  -v "$(pwd)/bauplan-documents:/uploads" \
  bauplan:latest
```

Open <http://localhost:3000>. Create the admin account on first launch. Back up both host directories independently.

For OCR, an administrator downloads German and/or English language models in **Settings → Text recognition (OCR)**. Downloads are explicit and stored under `/data/ocr-models`; keep the `/data` mapping persistent. The OCR engine does not need network access after the models are installed. No second container or OCR environment variables are needed.

## Unraid

The repository includes [`unraid/bauplan.xml`](../unraid/bauplan.xml), which maps persistent data, documents, and the web port.

### 1. Make the app image available

Unraid's Docker template pulls a container image; it does not build the repository's Dockerfile. Build the image on a machine with Docker, then publish it to a registry reachable by Unraid. For example, after replacing the placeholders with your registry namespace:

```sh
docker build -t ghcr.io/OWNER/bauplan:latest .
docker push ghcr.io/OWNER/bauplan:latest
```

For a private registry, configure its credentials in Unraid before installing the template. Alternatively, build the image directly on Unraid after copying the project there and use the local image name in the template; image updates then need to be built manually.

### 2. Install the Bauplan template

1. Copy `unraid/bauplan.xml` to `/boot/config/plugins/dockerMan/templates-user/my-bauplan.xml` on Unraid.
2. Edit the `Repository` value in the XML to your published image, such as `ghcr.io/OWNER/bauplan:latest`.
3. In Unraid, open **Docker → Add Container → Template**, select **bauplan**, and review its settings.
4. Set **Database and OCR models** to a persistent host path, for example `/mnt/user/appdata/bauplan`. This maps to `/data` and stores `renovierung.db` and downloaded language models.
5. Set **Documents** to a separate persistent host path. The example defaults to `/mnt/user/appdata/bauplan-documents`; this maps to `/uploads`.
6. Set **Web UI Port (host)** to an unused host port (3000 by default) and apply. The container port stays at 3000.
7. Open `http://<unraid-ip>:<host-port>` and create the initial admin account.

Back up the database/model and document paths independently. Recreating or updating the container preserves them as long as both host paths remain mapped.

#### Existing Docker/Unraid data

Earlier Docker configurations stored documents in an `uploads/` directory inside the database mapping. Before changing an existing installation to the separate `/uploads` mount, stop the app and copy the old files into the new documents host directory. For example:

```sh
mkdir -p /mnt/user/appdata/bauplan-documents
cp -a /mnt/user/appdata/bauplan/uploads/. /mnt/user/appdata/bauplan-documents/
```

Adjust both host paths to match your existing database mapping and new documents location. Keep the existing SQLite database and its document records unchanged; only copy the uploaded files. Then configure the separate documents mapping and start the app again.

## Authentication and network access

Local email/password sign-in works without external services. OCR processing is local after explicitly downloaded models are installed. Admin-initiated model downloads require outbound HTTPS access to the pinned jsDelivr package URLs; no document content is sent to those URLs. OIDC can be enabled in Settings, but then the app must be able to reach the configured identity provider. For a setup with no outbound runtime connections, leave OIDC disabled and transfer the pinned language model files into `/data/ocr-models/` through a trusted channel.
