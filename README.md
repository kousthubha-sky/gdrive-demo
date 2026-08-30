# Drive

A Google Drive-like file manager.
Sign in with Google, then upload, rename, search, download, delete and share files.

File bytes live in an S3 bucket; file metadata lives in Postgres.
One Express process serves both the REST API and the built React SPA, so there is a single origin, a single deploy and no CORS configuration.

## Stack

| Layer | Choice |
| --- | --- |
| API | Node 22, Express 5, TypeScript |
| Auth | Google OAuth 2.0 via `passport-google-oauth20`, session as a signed JWT in an `httpOnly` cookie |
| Database | Postgres (Neon) via Prisma |
| Storage | AWS S3 (or any S3-compatible store) via `@aws-sdk/client-s3` |
| Web | React 19, Vite, Tailwind CSS 4 |

## Repository layout

```
.
├── server/            Express API + Prisma schema
│   ├── prisma/        schema.prisma and migrations
│   ├── src/           routes, auth, S3 and validation
│   └── test/          node:test unit tests
├── web/               React SPA (Vite)
├── Dockerfile         multi-stage build of the whole app
└── docker-compose.yml app + Postgres for local containers
```

## Prerequisites

- Node.js 22 or newer, and npm 10 or newer.
- A Postgres database. [Neon](https://neon.tech) has a free tier and is what the defaults assume.
- An AWS account with an S3 bucket, or any S3-compatible store such as Cloudflare R2 or MinIO.
- A Google Cloud project with an OAuth 2.0 client.

## Setup

### 1. Install

```bash
npm install
```

If npm reports that install scripts were skipped, approve the ones Prisma and esbuild need:

```bash
npm install-scripts approve @prisma/client prisma @prisma/engines esbuild && npm install
```

### 2. Create the Google OAuth client

1. Open the [Google Cloud console credentials page](https://console.cloud.google.com/apis/credentials).
2. Configure the OAuth consent screen. External + Testing is fine; add your own Google account under **Test users**.
3. Create credentials → **OAuth client ID** → **Web application**.
4. Under **Authorised redirect URIs** add exactly `http://localhost:4000/api/auth/google/callback`.
   Add your production equivalent (`https://your-app.example.com/api/auth/google/callback`) as a second URI when you deploy.
5. Copy the client ID and client secret into `.env`.

The redirect URI must match `${APP_URL}/api/auth/google/callback` character for character, including the scheme and any trailing path.
A mismatch is the single most common cause of `redirect_uri_mismatch`.

### 3. Create the S3 bucket

1. Create a bucket in the region you will use, for example `ap-south-1`.
2. Leave **Block all public access** switched on.
   Nothing in this app needs public objects; downloads are served through short-lived presigned URLs that expire after five minutes.
3. Create an IAM user with programmatic access and attach an inline policy scoped to the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

4. Copy the access key ID and secret access key into `.env`.

To use Cloudflare R2 or MinIO instead, set `S3_ENDPOINT` to that service's endpoint and keep the rest of the variables as they are.

### 4. Configure the environment

```bash
cp .env.example .env
```

Fill in every value.
The server validates its environment at boot and exits with a list of what is missing rather than failing later at request time.

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public origin of the API. Determines the OAuth callback URL. |
| `WEB_URL` | Where the browser lands after login. `http://localhost:5173` in development, same as `APP_URL` in production. |
| `DATABASE_URL` | Neon pooled connection string. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 2. |
| `JWT_SECRET` | Any long random string: `openssl rand -hex 32`. |
| `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | From step 3. |
| `S3_ENDPOINT` | Only for S3-compatible stores. Leave blank for AWS. |
| `MAX_UPLOAD_BYTES` | Upload size cap. Defaults to 100 MB. |

### 5. Create the database tables

```bash
npm run db:push
```

Or, to apply the checked-in migration instead:

```bash
npm run db:deploy
```

Run these from the repository root.
The Prisma CLI reads `.env` relative to its working directory, so all `db:*` scripts live in the root `package.json` alongside the `.env` file rather than in `server/`.

### 6. Run it

```bash
npm run dev
```

The API starts on <http://localhost:4000> and the Vite dev server on <http://localhost:5173>.
Open the Vite URL.
Vite proxies `/api` to the API, so the browser only ever talks to one origin and the session cookie works without any CORS setup.

## Tests

```bash
npm --workspace server test
```

Covers the filename sanitiser, which is the one place untrusted input is echoed back into a response header.

## Production build

```bash
npm run build
npm start
```

`npm run build` compiles the SPA to `web/dist` and the API to `server/dist`.
`npm start` applies pending migrations and then starts the API, which detects `web/dist` and serves it with an SPA fallback.
The whole app is then available on a single port.

## Docker

```bash
cp .env.example .env   # fill it in; DATABASE_URL is overridden by compose
docker compose up --build
```

This starts Postgres and the app together on <http://localhost:4000>.
Set `APP_URL` and `WEB_URL` to `http://localhost:4000` in `.env` first, and add `http://localhost:4000/api/auth/google/callback` to the Google OAuth client.

To build the image on its own:

```bash
docker build -t drive .
docker run --env-file .env -p 4000:4000 drive
```

## Deploying

The app is one long-running Node process, so any host that runs a container or a Node service works.
Render is used below because its free tier needs no card.

### Render

1. Push this repository to GitHub.
2. In Render, create a **Web Service** from the repository.
   - Environment: **Docker** (the `Dockerfile` at the repository root is picked up automatically).
   - Alternatively use a Node environment with build command `npm ci && npm run build` and start command `npm start`.
3. Add every variable from `.env.example` under **Environment**.
   - `APP_URL` and `WEB_URL` both become your Render URL, for example `https://drive-xyz.onrender.com`.
   - `NODE_ENV` must be `production` so the session cookie is marked `Secure`.
4. Deploy.
   The start command runs `prisma migrate deploy`, so the schema is created on first boot.
5. Back in the Google Cloud console, add `https://drive-xyz.onrender.com/api/auth/google/callback` to the OAuth client's authorised redirect URIs.

### A note on Vercel

Vercel runs serverless functions with an ephemeral filesystem, which is fine here because file bytes go to S3 rather than to disk.
If you deploy there, deploy `web/` as the static site and the API separately, and set `WEB_URL` to the static site's origin.
A single always-on service (Render, Railway, Fly.io, or any VPS) is simpler and is what the instructions above assume.

## API

All routes require the session cookie except the two OAuth entry points.
Errors come back as `{ "error": "..." }` with a meaningful status code.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe. |
| `GET` | `/api/auth/google` | Start the Google OAuth flow. |
| `GET` | `/api/auth/google/callback` | OAuth callback; sets the session cookie and redirects to `WEB_URL`. |
| `GET` | `/api/auth/me` | The signed-in user. |
| `POST` | `/api/auth/logout` | Clear the session cookie. |
| `GET` | `/api/files?q=&scope=` | List files. `q` searches by name, case-insensitively. `scope` is `all`, `mine` or `shared`. |
| `POST` | `/api/files` | Upload. `multipart/form-data` with a single `file` field. |
| `GET` | `/api/files/:id/url` | A presigned download URL, valid for five minutes. `?disposition=inline` to view rather than download. |
| `PATCH` | `/api/files/:id` | Rename. Body `{ "name": "..." }`. |
| `DELETE` | `/api/files/:id` | Delete the row and the S3 object. |
| `POST` | `/api/files/:id/shares` | Share with another user. Body `{ "email": "..." }`. |
| `DELETE` | `/api/files/:id/shares/:userId` | Revoke a share. |

## Design notes

**Sessions.**
Google identity is verified by Passport, then the server issues its own JWT and stores it in an `httpOnly`, `SameSite=Lax` cookie, marked `Secure` in production.
This keeps the token out of reach of JavaScript, needs no session table, and survives a restart or a second instance without sticky sessions.

**Private bucket, presigned reads.**
Objects are never public.
The client asks for a URL, the server checks access and signs one that expires in five minutes.
A leaked link stops working on its own.

**Object keys are namespaced per user** (`users/<userId>/<uuid><ext>`) and stored under a unique constraint, so a stale metadata row can never point at another account's object.

**Access checks are queried, not filtered.**
Ownership and share membership are part of the `WHERE` clause rather than a check applied to fetched rows, so there is no path where a wrong or missing check leaks a row.
Non-owners get `404` rather than `403`, which avoids confirming that a file id exists.

**Filenames are sanitised on the way in.**
Path separators become dashes and control characters are dropped, because the name is echoed back in a `Content-Disposition` header.
This is the one piece of logic with a unit test.

**Delete order.**
The metadata row is removed first and the S3 object second.
A row with no object is a broken download; an object with no row is invisible and merely costs storage.
The database is the source of truth, so it wins, and a failed object delete is logged rather than failing the request.

**Upload failure is cleaned up.**
If the object uploads but the metadata write fails, the object is deleted again rather than left orphaned.

## Implemented

- Google OAuth sign-in and sign-out, with a secure cookie session.
- Upload (button, plus drag and drop anywhere) with a live progress bar.
- Rename, delete, and download through presigned URLs.
- Debounced search by filename.
- Sharing with another registered user, and revoking a share. Shared files appear under **Shared with me**.
- Docker and Docker Compose.
- Validation and error handling on every endpoint, with a `413` on oversized uploads.

## Not implemented

- Folders. The assignment describes a flat file list, so files are flat.
- Trash and restore. Delete is immediate and permanent.
- Public share links. Sharing is to a named account that has signed in at least once.
