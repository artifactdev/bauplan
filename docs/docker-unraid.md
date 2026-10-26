# Docker and Unraid setup

Bauplan runs as a Node.js container. The SQLite database and uploaded documents use separate container paths: `/data` for the database and `/uploads` for documents. The app does not require a hosted database, authentication provider, or file service.

## Plain Docker

Build the app image from the project root:

```sh
docker build -t bauplan:latest .
```

Create separate persistent host directories and start the container:

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

Open <http://localhost:3000>. On first launch, create the admin account. The host directory mounted at `/data` contains `renovierung.db`; the separate host directory mounted at `/uploads` contains uploaded documents. Back up both directories.

If a different host port is needed, change the left side of the port mapping, for example `-p 8088:3000`; the application still listens on port 3000 inside its container.

### Optional local OCR container

The app can run without OCR. To enable document recognition, build the companion image:

```sh
docker build -t bauplan-ocr:latest ./ocr
docker network create bauplan
docker run -d \
  --name bauplan-ocr \
  --restart unless-stopped \
  --network bauplan \
  bauplan-ocr:latest
```

If the app was already started without OCR, recreate only its container on the same network and set `OCR_URL`. Keep both bind mounts so the database and documents persist:

```sh
docker rm -f bauplan
docker run -d \
  --name bauplan \
  --restart unless-stopped \
  --network bauplan \
  -p 3000:3000 \
  -e OCR_URL=http://bauplan-ocr:8000 \
  -v "$(pwd)/bauplan-data:/data" \
  -v "$(pwd)/bauplan-documents:/uploads" \
  bauplan:latest
```

The OCR container does not need a host port mapping.

## Unraid

The repository includes an Unraid user-template example at [`unraid/bauplan.xml`](../unraid/bauplan.xml). The template maps the database and documents independently and maps the web port.

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
4. Set **Database appdata** to a persistent host path, for example `/mnt/user/appdata/bauplan`. This maps to `/data` and stores `renovierung.db`.
5. Set **Documents** to a separate persistent host path. The example defaults to `/mnt/user/appdata/bauplan-documents`, but you can choose another share or disk path, such as `/mnt/user/documents/bauplan`. This maps to `/uploads`.
6. Set **Web UI Port (host)** to an unused host port (3000 by default) and apply. For example, set it to `8088` if host port 3000 is already in use. The container port stays at 3000.
7. Open `http://<unraid-ip>:<host-port>` (for example `http://192.168.1.20:8088`) and create the initial admin account.

Back up the database and documents host paths independently. Recreating or updating the container preserves data as long as both host paths remain mapped.

#### Existing Docker/Unraid data

Earlier Docker configurations stored documents in an `uploads/` directory inside the database mapping. Before changing an existing installation to the separate `/uploads` mount, stop the app and copy the old files into the new documents host directory. For example:

```sh
mkdir -p /mnt/user/appdata/bauplan-documents
cp -a /mnt/user/appdata/bauplan/uploads/. /mnt/user/appdata/bauplan-documents/
```

Adjust both host paths to match your existing database mapping and new documents location. Keep the existing SQLite database and its document records unchanged; only copy the uploaded files. Then configure the separate documents mapping and start the app again.

### 3. Optional OCR on Unraid

OCR is a separate container. The repository includes [`unraid/bauplan-ocr.xml`](../unraid/bauplan-ocr.xml), which is a template for the OCR image.

1. Build and publish the OCR image from `ocr/`, for example `ghcr.io/OWNER/bauplan-ocr:latest`, then set that image in the OCR template.
2. Create a user-defined Docker network named `bauplan` on Unraid (once, from the Unraid terminal):

   ```sh
   docker network create bauplan
   ```

3. Add both containers and set **Network Type** to the custom `bauplan` network. Do not publish an OCR port to the host.
4. In the Bauplan template, add an environment variable `OCR_URL` with value `http://bauplan-ocr:8000`. The OCR container's name in Unraid must be `bauplan-ocr` for this address to resolve.
5. Apply/restart both containers. OCR is then accessible to the app over the private Docker network.

If you do not need automatic recognition, omit `OCR_URL` and do not install the OCR container, or explicitly disable OCR in the app settings.

Admins can configure the shared OCR provider, service URL, recognition languages, and optional API key in **Settings → Text recognition (OCR)**. Saved settings override `OCR_URL`. For encrypted credentials, set a stable `OCR_SETTINGS_KEY` on the app using 64 hexadecimal characters (`openssl rand -hex 32`); keep it separately from SQLite backups.

For optional **Docling Serve**, use [`unraid/bauplan-docling.xml`](../unraid/bauplan-docling.xml) with the pinned CPU image on the same private network. Prepopulate its model-assets bind mount before starting the container; an empty directory hides bundled models. Select Docling Serve and `http://bauplan-docling:5001` in the app and run the processing test. Detailed model-copy commands and offline settings are in [OCR](ocr.md). Do not publish the service port unless needed for a separate host, in which case protect it with network controls, HTTPS, and authentication.

The app deliberately allows all HTTP(S) destinations, including internal addresses, without SSRF isolation. Grant OCR configuration access only to trusted admins.

### Unraid template image placeholders

The checked-in XML files use example image names. Change each `Repository` value to your own published image before installing. Publish both images for OCR support:

```sh
docker build -t ghcr.io/OWNER/bauplan:latest .
docker push ghcr.io/OWNER/bauplan:latest
docker build -t ghcr.io/OWNER/bauplan-ocr:latest ./ocr
docker push ghcr.io/OWNER/bauplan-ocr:latest
```

## Authentication and network access

Local email/password sign-in works without external services. OIDC can be enabled in Settings, but then the app must be able to reach the configured identity provider. For a setup with no outbound runtime connections, leave OIDC disabled. Docker needs network access while pulling base images and downloading build dependencies.
