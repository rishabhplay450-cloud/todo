# Public Hosting Guide (React + Express + SQLite)

This app can be hosted publicly and used by anyone.

## Recommended setup
- Frontend: Vercel (or Netlify)
- Backend: Render Web Service (or Railway/Fly.io)
- Database: SQLite file on a persistent disk/volume (required)

## Important SQLite note
SQLite is file-based. If your host restarts without persistent storage, data is lost.
Use a provider that supports persistent disk/volume:
- Render: add a persistent disk to backend service
- Railway: mount a persistent volume
- Fly.io: attach a volume

## 1) Deploy backend (Render)
1. Push project to GitHub.
2. In Render, choose **New +** → **Blueprint** and select this repo.
3. Render will read `render.yaml` automatically.
4. Set env var:
   - `PORT=4000`
   - `JWT_SECRET=<strong-random-secret>` (or keep auto-generated)
   - `CORS_ORIGIN=<your-frontend-url>`
5. Confirm persistent disk is attached to `/opt/render/project/src/backend/data`.
6. Deploy and copy backend URL, e.g. `https://todo-backend.onrender.com`.

## 2) Deploy frontend (Vercel)
1. In Vercel, import this repo.
2. Set root directory to `frontend`.
3. `vercel.json` already defines Vite build/output.
4. Add env var:
   - `VITE_API_BASE_URL=https://todo-api.onrender.com`
5. Deploy and copy frontend URL.

## 3) Final CORS update
Set backend `CORS_ORIGIN` to your final frontend URL (or comma-separated URLs if needed), for example:

`CORS_ORIGIN=https://your-frontend.vercel.app`

Then redeploy backend.

## 3.1) Final quick check
- Backend health: `https://<backend-url>/health`
- Frontend opens: `https://<frontend-url>`
- Signup works and data remains after refresh.

## 4) Verify
- Open frontend URL.
- Signup/Login.
- Create todos in Notepad and Advanced modes.
- Refresh and confirm data persists.

## Security checklist
- Use a strong `JWT_SECRET`.
- Do not keep `CORS_ORIGIN=*` in production.
- Use HTTPS URLs only.
- Rotate secrets if exposed.
