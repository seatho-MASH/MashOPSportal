# Switching from the current portal to v2

Until you switch, the current portal at `/` is the master for delegates, sponsors, speakers,
staff, rooms, notes and the Community planner. v2's copies are refreshed each time
you press **Admin → Import from the current portal → Import now**. Anything typed into
those v2 pages before the switch is overwritten by the next import.

## The switch (about 10 minutes)

1. Tell the team not to edit in the current portal for ten minutes.
2. In v2, open **Admin** and press **Import now**. Check the report. It names any old
   event ids that aren't on the calendar, which are skipped.
3. Spot-check one or two events in v2: Sponsors (with their attendees), Speakers, Staff,
   Community planner, All attendees.
4. Add the block below to the top of `netlify.toml`, then commit and push. It:
   - sends `/` to `/v2/`
   - answers the calendar's two links from v2, so the calendar needs **no change**
   - closes the old data endpoints, which don't check who's asking
5. Sign in at `/` once to check: you should land on v2 and the Microsoft sign-in should complete.
6. After a week or two with nothing missing, delete the old files:
   - `index.html`, `auth.js`, `download`
   - `netlify/functions/` except the `v2-*` files

```toml
# --- v2 is the portal (switch-over) ---------------------------------------
[[redirects]]
  from = "/"
  to = "/v2/"
  status = 302
  force = true

# The calendar's links keep working, now answered from v2.
[[redirects]]
  from = "/api/public-staffing"
  to = "/api/v2-public/staffing"
  status = 200
  force = true
[[redirects]]
  from = "/api/community-summary"
  to = "/api/v2-public/community-summary"
  status = 200
  force = true

# The old data endpoints are retired.
[[redirects]]
  from = "/api/store"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/community-store"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/staff"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/attendees"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/lookup"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/admin-events"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/audit"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/send-briefing"
  to = "/404.html"
  status = 410
  force = true
[[redirects]]
  from = "/api/nearest-station"
  to = "/404.html"
  status = 410
  force = true
```

The team portal's Community tile points at `/#community`. After the switch that lands on
v2's Overview. Repoint it to `/v2/#/community` when convenient.

## What moved where

| Current portal | v2 |
|---|---|
| Delegates (HubSpot by Joining Instructions + walk-ins) | Delegates |
| Sponsors + their attendees | Sponsors (reps under each sponsor; Ledger sponsors too) |
| Community | Community planner |
| Speakers (single + bulk) | Speakers |
| Staff (roster, external, on-site, briefing) | Staff (roster list now editable in Admin) |
| All Attendee Data | All attendees (print + export) |
| History | History (old entries imported with their times) |
| Overview (community cover) | Community cover |
| Admin (Joining Instructions) | Admin (same dropdown + Check, plus import and staff roster) |

Rooms, notes, badge IDs (numbering carries on), first-seen dates and meetings delivered all come across.

## Rolling back

Remove the block from `netlify.toml` and push. The current portal's data is untouched by
the import, so it is exactly as it was at the switch.
