# Mash Media — Attendee Portal

A shared ops portal that centralises **who's attending** across the same 21 events the
[Mash Event Tracker](https://masheventtracker.netlify.app/) covers (CN, EN, AAA, PAS, Confex).

Three areas per event:

- **Delegates** — pulled **live from HubSpot**. A person appears the moment their
  **Joining Instructions are signed** (the `joining_instructions` field contains that
  event's code). Approvals/rejections stay with marketing in HubSpot; this list is read-only.
- **Sponsors** — add each sponsor and log the attendees they're sending. Saved for the whole team.
- **Speakers** — add individually or bulk-upload a CSV. Saved for the whole team.

**Record ID / badging.** Delegates carry their HubSpot **Record ID** (the badging scan ID).
Sponsors and speakers are entered by hand or bulk-upload, so they have no Record ID — when
you add or import one, the portal **searches HubSpot by email**: if they're already a contact,
it attaches their Record ID and fills in job title, company, dietary and accessibility. No match
just means no Record ID yet — in that case the portal **generates a badge ID** instead:
the event prefix + a 4-digit sequential number (e.g. `GETS0001`), numbered per event across
sponsors and speakers, so everyone is scannable. HubSpot matches keep their real Record ID;
only unmatched people get a generated one. Record ID / badge ID shows in every table and export,
and on the check-in sheet.

Badge prefixes are defined in `public/index.html` (`BADGE_PREFIX`) — e.g. GETS, DCLEG, MLS, LCCS.
Adjust them there if you want different codes.

Delegates come straight from HubSpot every time the page loads. Sponsors & speakers are stored
on the site (Netlify Blobs) so everyone on ops sees the same data.

---

## Deploy (new, separate Netlify site)

Same flow you used for the event tracker.

1. **Put this folder in a Git repo** (GitHub) or drag-and-drop deploy.
   - If dragging: unzip, then drag the **contents** (so `netlify.toml`, `public/`, `netlify/`
     sit at the top level — not the wrapper folder). This avoids the "one level too deep" 404.
2. In Netlify: **Add new site → Import / Deploy**, publish directory `public`,
   functions directory `netlify/functions` (already set in `netlify.toml`).
3. **Add the HubSpot token** — Site config → Environment variables → add:
   - Key: `HUBSPOT_TOKEN`
   - Value: your HubSpot Private App token (the same one the event tracker uses).
     It only needs **`crm.objects.contacts.read`**.
4. **Netlify Blobs** is on automatically for functions — no setup. It stores sponsors & speakers.
5. Deploy. Open the site; delegates load live, sponsors/speakers persist for everyone.

> Preview tip: opening `public/index.html` on its own works too — it shows sample data and a
> "Preview" badge, so you can click around before it's wired to HubSpot.

---

## Each new event cycle

Open `netlify/functions/_shows.mjs` and update the list. Each event needs one line with its
exact **Joining Instructions** option value from HubSpot:

```js
{ id: 'cn-cls', brand: 'CN', name: 'Creative Leaders Summit', short: 'CLS',
  date: '2026-07-29', ji: 'CN CLS 26' },
```

Find the `ji` value in HubSpot → Settings → Properties → Contact → **Joining Instructions**
→ copy the option's value exactly. Commit and redeploy.

The 21 events currently configured were verified against the live tracker — the delegate
counts match exactly (e.g. DC Legal 24, CLS 33, LC Consumer 19, GETS 21, OLS 4).

---

## Files

```
netlify.toml                       Netlify build + functions config
package.json                       one dependency: @netlify/blobs
public/index.html                  the whole portal (self-contained)
netlify/functions/_shows.mjs       the 21 events → JI code mapping
netlify/functions/attendees.mjs    GET /api/attendees  (live HubSpot delegate pull)
netlify/functions/lookup.mjs       GET/POST /api/lookup (email -> HubSpot Record ID + details)
netlify/functions/store.mjs        GET/POST /api/store  (shared sponsors + speakers)
```
