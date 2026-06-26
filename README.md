# UHFR: Outbreak Port Harcourt

Multiplayer RP-first zombie-apocalypse survival prototype with a server-side OpenAI GM.

## Local Run

```powershell
node server.mjs
```

Local browser:

```text
http://localhost:4173
```

Phones on the same Wi-Fi use the LAN URL printed by the server.

## Public Browser Access

For players outside your Wi-Fi, deploy the server to a public host such as Render, Railway, Fly.io, or a VPS. The app must run as a Node web service because the OpenAI key stays server-side.

### Render Setup

1. Push this project to a Git repository.
2. Create a new Render Blueprint or Web Service from the repository.
3. Use `render.yaml` or set:
   - Start command: `node server.mjs`
   - Environment variable: `OPENAI_API_KEY`
   - Environment variable: `OPENAI_MODEL=gpt-4.1-mini`
   - Environment variable: `DATA_DIR=/var/data`
4. Add a persistent disk mounted at `/var/data` if you want room state to survive restarts.
5. Share the Render HTTPS URL with players.

Health check:

```text
/api/health
```

Network/config check:

```text
/api/network
```

## Security Notes

- Do not commit `.env`.
- Keep `OPENAI_API_KEY` only in local `.env` or hosting provider environment variables.
- The browser never receives the OpenAI API key.
