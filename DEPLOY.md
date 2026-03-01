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

## 1) Deploy backend
1. Push project to GitHub.
2. Create backend service using folder `backend`.
3. Build command: `npm install`
4. Start command: `npm run dev`
5. Add env vars:
   - `PORT=4000`
   - `JWT_SECRET=<strong-random-secret>`
   - `CORS_ORIGIN=<your-frontend-url>`
6. Attach persistent disk and ensure backend `data` folder is on that disk.
7. Copy backend URL, e.g. `https://todo-api.onrender.com`.

## 2) Deploy frontend
1. Create frontend project from folder `frontend`.
2. Build command: `npm run build`
3. Output dir: `dist`
4. Add env var:
   - `VITE_API_BASE_URL=https://todo-api.onrender.com`
5. Deploy and copy frontend URL.

## 3) Final CORS update
Set backend `CORS_ORIGIN` to your final frontend URL (or comma-separated URLs if needed), for example:

`CORS_ORIGIN=https://your-frontend.vercel.app`

Then redeploy backend.

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
