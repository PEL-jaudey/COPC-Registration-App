# Pelotonia New Rider Clinic — Registration App

A server-side registration app for the Pelotonia New Rider Clinic. Attendees select one of four time slots (max 75 per session), read and acknowledge a liability waiver, and submit their information. An admin panel lets staff view and export all registrations.

---

## Features

- Four time slots with live capacity tracking (75 max each)
- Waiver pop-up with acknowledgment checkbox before registration is accepted
- Duplicate email detection per session
- Admin panel to view, filter, and remove registrations
- CSV export of all registrations
- Pelotonia branding (colors, fonts, layout)
- Data stored in Supabase (PostgreSQL)

---

## Project Structure

```
registration-app/
├── public/
│   └── index.html       # Frontend — registration form, slot cards, waiver modal, admin panel
├── server.js            # Express server — API routes, Supabase queries
├── package.json
├── .env                 # Your local secrets (never commit this)
└── .env.example         # Template — copy to .env and fill in values
```

---

## Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- A [Supabase](https://supabase.com) account and project (free tier works fine)

---

## 1. Supabase Setup

### Create the table

In your Supabase project go to **SQL Editor** and run:

```sql
create table registrations (
  id              uuid primary key default gen_random_uuid(),
  slot_id         text        not null,
  slot_label      text        not null,
  fname           text        not null,
  lname           text        not null,
  email           text        not null,
  questions       text        default '',
  waiver_accepted boolean     not null default true,
  registered_at   timestamptz not null default now()
);

-- Prevents the same email from registering twice for the same slot
create unique index on registrations (slot_id, lower(email));
```

### Get your API keys

1. In your Supabase project click **Project Settings** (gear icon) → **API**
2. Copy the following:

| Value | Where to find it |
|---|---|
| **Project URL** | "Project URL" section |
| **Service role key** | "Project API keys" → `service_role` row → click Reveal |

> Use the `service_role` key (not the `anon` key). It allows the server to read and write data without Row Level Security getting in the way. Never expose it in the browser or commit it to Git.

---

## 2. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your values:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
PORT=3000
```

---

## 3. Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

The server connects to Supabase over the internet so your local app reads and writes the same database as any deployed version.

---

## 4. Deployment

### Railway (recommended — easiest)

1. Push this project to a GitHub repository
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repository — Railway auto-detects Node.js and runs `npm start`
4. In your Railway project go to the **Variables** tab and add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
5. Railway provides a public URL (e.g. `https://your-app.up.railway.app`) — share that link with registrants

### Render

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New Web Service** → connect your repo
3. Set **Build Command** to `npm install` and **Start Command** to `npm start`
4. Add environment variables in the Render dashboard
5. Deploy — Render provides a public URL

> **Note:** Render's free tier spins the app down after 15 minutes of inactivity. The first request after that takes ~30 seconds to wake up. Upgrade to a paid plan to avoid this for a production event.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/slots` | Returns all four slots with live capacity counts |
| `POST` | `/api/register` | Submits a new registration |
| `GET` | `/api/registrations` | Returns all registrations (add `?slotId=slot1` to filter) |
| `DELETE` | `/api/registrations/:id` | Removes a registration by ID |

### POST /api/register — request body

```json
{
  "slotId": "slot1",
  "fname": "Jane",
  "lname": "Smith",
  "email": "jane@example.com",
  "questions": "Optional question text",
  "waiverAccepted": true
}
```

---

## Session Dates

| Slot | Date | Time |
|---|---|---|
| slot1 | May 15, 2026 | 12:00 PM |
| slot2 | May 30, 2026 | 12:00 PM |
| slot3 | June 13, 2026 | 12:00 PM |
| slot4 | June 27, 2026 | 12:00 PM |

To change dates or times edit the `SLOTS` array at the top of `server.js`.

---

## Changing Capacity

The per-session cap is set in one place in `server.js`:

```js
const MAX_CAPACITY = 75;
```

Change that number and restart the server — no database changes needed.
