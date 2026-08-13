# Mash Ops (Attendee) Portal — Status

**One-liner:** Shared operations portal centralising who's attending each event — delegates (live from HubSpot), sponsors and speakers (added/CSV-uploaded), plus on-site staffing, rooms and nearest-station logistics. Used by the ops team.

**Status:** Live.

**Repo & location**
- Workspace folder / Git root (GitHub Desktop): `repos/MashOPSportal`
- Full path: `C:\Users\SeanThornton\OneDrive - Mash Media LTD\Desktop\MASH PORTAL BUILD\repos\MashOPSportal`
- GitHub: `https://github.com/seatho-MASH/MashOPSportal` · branch `main`

**Where it runs:** Netlify, Git-connected auto-deploy. Static publish `.` + functions. Microsoft sign-in.

**Stack:** `index.html` + `auth.js`. Netlify Functions (ESM). Netlify Blobs for team-entered data. Bundled UK stations list for nearest-station.

**Integrations:** HubSpot (delegates — appear when Joining Instructions signed for that event code; sponsor/speaker email lookup by contact), Microsoft Graph app-only (send briefing emails), SharePoint Events list, Community Portal (community-sponsors read/write).

**Key env vars:** `HUBSPOT_TOKEN` (+ `HUBSPOT_ACCESS_TOKEN`/`HUBSPOT_PRIVATE_APP_TOKEN` aliases), `OPS_GRAPH_CLIENT_ID`/`OPS_GRAPH_CLIENT_SECRET`, `OPS_MAIL_SENDER`, `SP_SITE_HOST`, `SP_SITE_PATH`, `SP_EVENTS_LIST`, `TENANT_ID`, `PORTAL_ORIGIN`.

**Key files / architecture**
- `netlify/functions/attendees.mjs`, `staff.mjs`, `store.mjs` (Blobs incl. on-site details), `nearest-station.mjs` + `stations.mjs`, `send-briefing.mjs` (Graph sendMail + .ics), `public-staffing.mjs` (CORS read for the calendar), `community-sponsors.mjs`, `lookup.mjs`, `_graph.mjs`, `_shows.mjs`. `index.html` — the UI.

**Data stores:** Netlify Blobs (sponsors, speakers, on-site details, rooms/staffing); HubSpot (delegates, read-only); SharePoint Events list.

**Done:** Delegates live from HubSpot, sponsor/speaker entry + CSV upload with email lookup + badge-ID generation, on-site details panel + nearest-station auto-calc, rooms/staffing totals exposed to the calendar, send-briefing (email + calendar invite), CORS staffing read.

**Outstanding / next steps:** End-to-end test of the briefing email + calendar invite (task #23). Community-portal fulfilment tracking ties in here (task #60).

**Known issues & gotchas:** Delegate list is read-only (approvals stay in HubSpot/marketing). Nearest-station uses a bundled list — keep it if adding venues offline.

**Deploy / go-live notes:** See `DEPLOY.md` in this repo. Push to `main`; static, no build.

**Related docs & assets in workspace:** `OPs portal - OPs tool.zip` (original), `Event tracker - Summit tracker.zip`, `SharePoint Import - Events.xlsx`.
