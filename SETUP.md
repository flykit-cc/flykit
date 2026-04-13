# flykit-cc setup checklist

This is the one-time setup to take both repos from local scaffolding to a live site at flykit.cc with auto-deploy.

## 0 — Prerequisites

- GitHub account: `kaiomp`
- Personal Vercel account (free tier is fine)
- Domain `flykit.cc` registered (any registrar)

## 1 — Create the GitHub org

1. Go to <https://github.com/account/organizations/new>
2. Org name: `flykit-cc`
3. Plan: Free
4. (Optional) Add a profile README later via `flykit-cc/.github` repo

## 2 — Create the two repos

Both must be **public** (open-source).

```bash
# From this machine:
cd /path/to/flykit
gh repo create flykit-cc/flykit --public --source=. --remote=origin --description "Open-source Claude Code plugins for everyday workflows"

cd /path/to/flykit-web
gh repo create flykit-cc/flykit-web --public --source=. --remote=origin --description "Landing page for flykit.cc"
```

> If `gh` isn't installed: `brew install gh && gh auth login`

## 3 — Initial commits + push

```bash
# flykit (marketplace + plugins)
cd /path/to/flykit
git add .
git commit -m "Initial commit: flykit marketplace with steuer plugin"
git push -u origin main

# flykit-web (landing page)
cd /path/to/flykit-web
git add .
git commit -m "Initial commit: flykit.cc landing page"
git push -u origin main
```

## 4 — Set up Vercel project (personal account)

1. <https://vercel.com/new> → Import the `flykit-cc/flykit-web` repo
   - **Skip the GitHub integration** — don't connect for auto-deploy. Free tier doesn't allow org integration anyway.
   - Just create the project so you can grab the IDs.
   - Framework: Next.js (auto-detected)
   - Set the **production domain** to `flykit.cc` (Settings → Domains)

2. **Disconnect** the Git integration after the project is created (Settings → Git → Disconnect). We deploy via GitHub Actions, not Vercel's auto-deploy.

3. Generate a **Vercel access token**: <https://vercel.com/account/tokens> → Create new → name it `flykit-deploy` → no expiration → copy the token.

4. Grab the IDs:
   ```bash
   # In /path/to/flykit-web:
   npx vercel link --yes
   cat .vercel/project.json
   # → copy `orgId` and `projectId`
   rm -rf .vercel  # don't commit this
   ```

5. Create a **GitHub fine-grained PAT** for cross-repo triggering (used by the `flykit` repo to dispatch `flykit-web`'s deploy workflow):
   - https://github.com/settings/personal-access-tokens/new
   - Token name: `flykit-cross-repo-trigger`
   - Resource owner: `flykit-cc` (the org)
   - Repository access: Only select repositories → `flykit-cc/flykit-web`
   - Permissions → Repository permissions → **Actions: Read and write**
   - Copy the token — you only see it once.

## 5 — Add GitHub secrets

### `flykit-cc/flykit-web` repo

Settings → Secrets and variables → Actions → New repository secret. Add three:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | the access token from step 4.3 |
| `VERCEL_ORG_ID` | from step 4.4 |
| `VERCEL_PROJECT_ID` | from step 4.4 |

### `flykit-cc/flykit` repo

Same place. Add one:

| Secret | Value |
|---|---|
| `FLYKIT_WEB_DEPLOY_PAT` | the PAT from step 4.5 |

## 6 — Point DNS to Vercel

In your domain registrar's DNS settings for `flykit.cc`:

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

Vercel will provision an SSL cert automatically once DNS resolves (~5 min).

## 7 — Verify

1. Push a tiny change to `flykit-web` (e.g., edit README) → check Actions tab → deploy succeeds → site live at flykit.cc
2. Push a tiny change to a plugin in `flykit` → check Actions tab → deploy hook fires → flykit.cc rebuilds within a minute and reflects the change

Done. The system is now self-maintaining: every push to either repo updates the site automatically.

---

## Future contributors

Anyone who PRs to `flykit-cc/flykit-web` or `flykit-cc/flykit` triggers your Vercel project to deploy (via the GitHub Action using YOUR token in the secrets). They don't need their own Vercel account.

If you ever want to stop allowing PR-triggered deploys, change the `on:` trigger in `.github/workflows/deploy.yml` to require maintainer approval (`workflow_dispatch` only, or restrict to `main` after merge).
