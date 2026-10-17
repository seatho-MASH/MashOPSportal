# The one endpoint Mash Ops needs from Mash Ledger

Mash Ops pulls each event's sponsors from the Ledger. Nothing in Ops writes to the Ledger.

## Request

```
GET /api/v1/ops-sponsors?entry=<calendar event id>
X-Mash-Key: <key scoped ops-sponsors:read>
```

`entry` is the **calendar** id (e.g. `cn-als`, `eps-event-production-show`). The Ledger already
maps calendar entries to its ledgers per edition in `portal_event_map` (entry + edition), so it
resolves the right book itself.

## Response

```json
{ "sponsors": [
  { "ref": "co:12345", "company": "Arena Racing Company", "tier": "Engagement",
    "contact_name": "Jo Bloggs", "contact_email": "jo@example.com" }
] }
```

| Field | Rule |
|---|---|
| `ref` | Stable key per sponsor on that event — the company id is ideal. Ops upserts on it. |
| `company` | As the Ledger shows it. |
| `tier` | From the product: Headline / Engagement / Content Sponsorship → `Headline` / `Engagement` / `Content`; other sponsorship products by name. |
| `contact_*` | The deal's contact, if there is one. |

## Which lines count

- Read **`v_ledger_line`**, not `hs_deal_mirror` — the ReMash supplier pull found the mirror covers
  18 of 128 lines on Confex. *The ledger is the source of truth.*
- Live lines whose line type is **Sponsorship** only (not stands, tickets, advertising).
- One row per **company** per event, not per line.
- Cancelled / withdrawn lines drop out; Ops marks sponsors that disappear as removed, never deletes.

## Key

New scope `ops-sponsors:read`, minted the same way as the others (Sean runs it, never pasted in chat):

```
DATABASE_URL=... node db/api-key.mjs issue "Mash Ops" ops-sponsors:read
```

Then on the **Mash Ops** Netlify site: `LEDGER_API_URL=https://mashledger.netlify.app` and `LEDGER_API_KEY=<key>`.
