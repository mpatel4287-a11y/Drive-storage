# Cloud Storage Portal

A high-performance, private, web-based cloud media storage portal designed for 4–5 trusted members to store, manage, and transfer original-quality photos and 4K/8K videos with zero compression, zero transcoding, and maximum bandwidth saturation.

---

## Key Features

1. **100% Original Media Fidelity**:
   - Zero resizing, re-encoding, or compression. Exact byte fidelity is preserved end-to-end.

2. **Turbo Parallel Multi-Stream Engine**:
   - **Parallel Upload (6 Streams)**: The client browser partitions large video files into 6 concurrent stream slices and transmits them in parallel to the backend over HTTP. The backend streams and reassembles them sequentially into Google Drive's resumable upload session adhering to the 256 KiB boundary specification.
   - **Parallel Download (6 Streams)**: Files are partitioned into 6 concurrent HTTP `Range` request streams and reassembled client-side into a single binary stream/blob for download speeds that saturate network capacity.
   - **Direct-to-Drive Fallback**: High-speed chunked direct upload directly to Google Drive's resumable endpoints for standard devices.

3. **Hierarchical Permissions & Access Control**:
   - **Admin**: Permanent superuser. Approves join requests, promotes/demotes managers, configures granular permissions, and can access all files.
   - **Manager**: Can approve join requests, manage permissions, create custom storage folders, and browse library files.
   - **Member**: Standard user with customizable granular permission toggles (`can_upload`, `can_download`, `can_preview`, `can_delete`, `can_rename`, `can_create_folder`, `can_share`).

4. **Public Join Requests**:
   - Public registration puts accounts in `pending` status.
   - Admins or Managers approve users with pre-configured access profiles:
     - Full Access (`can_upload` + `can_download` + `can_preview`)
     - Download Only (`can_download` + `can_preview`)
     - Upload Only (`can_upload`)
     - Preview Only (`can_preview`)

5. **Direct QR Camera Roll Upload**:
   - Generate time-limited QR codes from the desktop portal.
   - Scan with any smartphone to open a camera roll upload interface without logging into the phone.

6. **Security & Reliability**:
   - SlowAPI IP rate limiting on authentication routes (login, registration, password resets).
   - Filename path traversal sanitization and size limit validation.
   - Automated maintenance routine for pruning abandoned multi-stream sessions and expired tokens.

---

## Directory Structure

```
cloud-storage-portal/
├── backend/
│   ├── alembic/                # Database migrations
│   ├── app/
│   │   ├── api/                # FastAPI routers (auth, media, members, folders, qr, permissions)
│   │   ├── core/               # Config, security, rate limiter
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic validation schemas
│   │   └── services/           # Google Drive, multi-stream engine, folder & maintenance services
│   ├── staging/                # Fast temporary staging on high-capacity drive
│   ├── tests/                  # Pytest automated test suite
│   ├── requirements.txt
│   └── alembic.ini
├── frontend/
│   ├── src/
│   │   ├── components/         # Modals, Navbar, MediaGallery, QR uploader
│   │   ├── utils/              # turboDownloader.js, turboUploader.js, api.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
└── start_portal.sh             # Unified startup script
```

---

## Quick Start

### 1. Launch Services

Run the unified startup script:
```bash
./start_portal.sh
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **Swagger Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)

### 2. Maintenance Routine

To run maintenance cleanup manually:
```bash
cd backend
PYTHONPATH=. .venv/bin/python -m app.services.maintenance
```

### 3. Run Backend Tests

```bash
cd backend
PYTHONPATH=. .venv/bin/pytest tests/ -v
```

---

## 24/7 Cloud Deployment on Render

This project includes a native `render.yaml` blueprint for one-click deployment on [Render](https://render.com).

### Step 1: Connect to Render
1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Blueprint**.
3. Select your GitHub repository: `Drive-storage`.
4. Render will automatically detect `render.yaml` and configure:
   - **Backend Web Service** (`drive-storage-api`)
   - **Frontend Static Site** (`drive-storage-portal`)

### Step 2: Configure Environment Variables
In the Render dashboard for `drive-storage-api`, fill in:
- `DATABASE_URL`: Your cloud PostgreSQL URL (e.g. from Supabase or Neon).
- `GOOGLE_TOKEN_JSON`: The contents of your `token.json` file.
- `GOOGLE_CLIENT_SECRET_JSON`: The contents of your `google_client_secret.json` file.
- `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL`: Your email credentials for password resets.

### Step 3: Deploy
Click **Apply**. Render will automatically build the backend, apply Alembic database migrations, build the frontend, and give you 24/7 online public HTTPS URLs.
