# Mash Ops v2 — inside the current Ops repo and site

The new portal lives **beside** the current one on the same Netlify site:

| | Current portal | v2 |
|---|---|---|
| Page | `/` (index.html) | `/v2/` |
| API | `/api/*` (store, attendees, …) | `/api/v2/*` (one function, `v2-api.mjs`) |
| Data | Netlify Blobs | Neon project **mash-ops** |
| Sign-in | Same Microsoft app and redirect address | same |

Nothing in the current portal was changed. v2's menu links back to the current portal for
Delegates, Speakers and Community until those move across.

## Files this adds

```
v2/                               the v2 front end (index.html, assets/)
netlify/functions/v2-api.mjs      every /api/v2/* call — verifies the Microsoft token, then routes
netlify/functions/v2-sync-calendar.mjs   every 30 min: events from the Mash calendar
netlify/functions/v2-outbox-tick.mjs     every minute: sends up to 20 queued emails
netlify/v2/lib/                   auth, db, rota, mail, onday, tables, points, sponsors, events
netlify/v2/db/schema.sql          Neon schema — applied on every deploy (idempotent)
netlify/v2/test/run.mjs           44 end-to-end checks:  DATABASE_URL=… npm test
netlify/v2/test/ui.mjs            browser pass (needs: npm i --no-save playwright)
docs/v2-LEDGER-ENDPOINT.md        the endpoint to add to Mash Ledger for sponsors
.gitattributes                    stops the CRLF/LF churn this repo has had
```

`package.json` gains two dependencies and two scripts; `netlify.toml` gains the build command
(`npm run migrate`, which skips with a warning if `DATABASE_URL` isn't set) and a rule that stops
`/netlify/*` source files being served as pages.

## New environment variables

| Name | What |
|---|---|
| `DATABASE_URL` | Neon → mash-ops → Connect → **pooled** connection string. Scope: Builds + Functions. |
| `OPS_ADMINS` | Comma-separated emails who can use Admin, sync and leaderboard rules. |
| `OPS_SECRET_KEY` | 32 random bytes, base64 — encrypts Grip passwords. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never change it once logins are saved. |
| `OPS_MAIL_DRY_RUN` | Optional — `1` queues schedule emails without sending. |
| `HUBSPOT_TOKEN` | For Scan check. A HubSpot private app token with **crm.objects.contacts.read** only. |
| `LEDGER_API_URL`, `LEDGER_API_KEY` | Later, once the Ledger endpoint exists. |

`TENANT_ID`, `OPS_GRAPH_CLIENT_ID`, `OPS_GRAPH_CLIENT_SECRET` and `OPS_MAIL_SENDER` are already on
the site from the briefing emails — v2 reuses them.

## Scan check (shows)

Show floor → **Scan check**. It compares HubSpot (approved registrations, pulled live) with Reftech and Grip
(CSV exports uploaded each time) and matches people by email:

1. **Not in every system**: who's missing from which source. It flags possible matches with the same name and company under another email.
2. **Badge type differs**: across all three, after each system's spellings are mapped to a tidy name (**Badge types**).
3. **Scan ID differs**: Grip and Reftech must agree, and both must match HubSpot's `pas_scan_id` where HubSpot has one.

**Which is right?** sets which source is correct for badge types and scan IDs. Both default to **HubSpot**, which holds delegates' badge types and scan IDs. Anyone without a HubSpot scan ID (exhibitors, for now) falls back to Reftech.
The **fix files** then correct the other systems, written in each system's own import layout once its
template is uploaded (**Upload templates**: map each template column to a field or a fixed value).
Fix files that *update* people (badge, scan ID) carry only the Registration ID, email, names and the fixed field. Company, job title and headline are left blank so nothing edited in Grip is overwritten. Add-people files fill them in, with Headline as "Job Title - Company".
**Accept** removes a known exception from the counts, with an optional reason.
Each event needs its registration code (CFX / EPS / PAS) set in Admin.

### Scan check: to do later (not needed for launch)
- [ ] Add `HUBSPOT_TOKEN` (contacts read only) and set each show's Reg code in Admin.
- [x] Grip template: Sean's `Delegate_Confex-upload-template.csv` is saved as the default (17 Oct). Its 2 instruction rows are kept, files are split one per badge type (Grip imports one data type at a time), and Registration ID, Email, First, Last, Headline, Company Name, Job Title and Scan ID are mapped.
- [ ] Other shows' Grip templates: their custom profile fields may differ. Upload each under Upload templates and tick "Only for this show".
- [ ] Confirm Registration IDs: existing people keep Grip's own (map the Registration ID column when uploading the Grip export). New people get `HS` + their HubSpot record ID. Check this fits how Mash creates Grip Registration IDs.
- [ ] Confirm Grip can change someone's data type (badge type) by importing them into the new type's file. If it can't, badge fixes in Grip are a manual job.
- [ ] Reftech template: same, once Reftech provides one. Until then Reftech fix files use the plain layout.
- [ ] Exhibitors: decide where exhibitor badge types and scan IDs come from. If not HubSpot, either load that source or confirm the Reftech fallback is right.
- [ ] First real run: load all three, then tidy the badge names under Badge types (saved per event).
- [ ] When Grip or Reftech offer an API, replace the CSV upload for that source (`uploadSource` → a pull like `pullHubspot`).

## Delegates, Sponsors, Speakers, Staff, All attendees, Community (moved from the current portal, Oct 2026)
- **Data:** Neon tables `attendee`, `room_need`, `delegate_note`, `delegate_seen`, `event_onsite`, `community_*`, `staff_roster` and `setting`. The calendar sync also stores rooms total and build/breakdown days.
- **Import:** Admin → Import from the current portal. It reads the old Blobs store and is safe to re-run. See `docs/v2-CUTOVER.md` for the switch.
- **HubSpot:** delegates by Joining Instructions, email lookup for walk-ins and speakers, and the staff roster. The token needs contacts read, and the Admin dropdown also needs `crm.schemas.contacts.read`.
- **Briefing emails** go through the outbox with an `.ics` invite. Build and breakdown days come from the calendar.
- **Calendar endpoints (no sign-in, names and counts only):** `/api/v2-public/staffing` and `/api/v2-public/community-summary`.
- **Tests:** `npm test` runs `run.mjs` and `attendees.mjs`. HubSpot is mocked, and the importer is tested against a fake copy of the old store.
