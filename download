# Deploy checklist — Mash Attendee Portal (GitHub → Netlify)

The site publishes from the **repo root** (no `public/` folder), so uploads can't lose it.

## 1. Put these files in a GitHub repo (structure matters)
Repo root must look EXACTLY like this:

```
index.html
netlify.toml
package.json
.gitignore
README.md
netlify/
  functions/
    _shows.mjs
    attendees.mjs
    lookup.mjs
    store.mjs
```

Uploading via github.com: New repo → "uploading an existing file" →
**drag the whole `netlify` FOLDER in as a folder** (not the files one by one),
plus `index.html`, `netlify.toml`, `package.json`. Confirm you can see the
`netlify/functions` path in the repo before moving on. Commit.

## 2. Connect Netlify
Add new site → Import an existing project → GitHub → this repo.
`netlify.toml` sets publish = "." and functions = "netlify/functions".
Leave the build command blank. Deploy.

## 3. Environment variable
Site configuration → Environment variables → add
`HUBSPOT_TOKEN` = your HubSpot private-app token. Then Deploys → Trigger deploy.

## 4. Token scopes
- `crm.objects.contacts.read`  (delegates + email lookup)
- `crm.objects.companies.read` (primary company name)

## Check it worked
- Home page loads the portal (not a 404).
- An event with signed JIs shows delegates (live).
- `/api/attendees` returns JSON (not the HTML page).
If the home page 404s, the files landed one level too deep — the repo root must
contain `index.html` directly.
