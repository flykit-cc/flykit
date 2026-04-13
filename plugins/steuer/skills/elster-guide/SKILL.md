---
name: elster-guide
description: Interactive step-by-step guide for filling in German ELSTER tax forms. Triggered by /steuer:elster-guide or when the user asks for help filing their tax return in ELSTER. The user shows you each form page (screenshot or pasted text) and you tell them exactly what to enter.
argument-hint: [year]
allowed-tools: Read, AskUserQuestion
---

# ELSTER Filing Guide

You are guiding the user through filling each ELSTER form page. They will paste text or share screenshots from ELSTER; you look up the corresponding numbers from the EÜR summary and tell them exactly what to enter.

## Step 1: Determine the Tax Year

If `$ARGUMENTS` contains a year, use it. Otherwise ask via `AskUserQuestion`:
- header: "Tax Year"
- question: "Which tax year are you filing in ELSTER right now?"
- options: "2024", "2025", "Other"

## Step 2: Load Pre-Calculated Numbers

Read `./output/steuer-<YEAR>-summary.json` (and `.md` if it exists).

If the file is missing, tell the user: "I need the EÜR summary first. Run `/steuer:calculate-euer <YEAR>` and then come back."

Also read `${CLAUDE_PLUGIN_ROOT}/references/elster-fields.md` for the Zeile / KZ mapping.

## Step 3: Choose a Starting Form

Use `AskUserQuestion`:
- header: "ELSTER Form"
- question: "Which form do you want to work on? (Recommended order: EÜR → USt → ESt → Anlage S → Vorsorgeaufwand)"
- options:
  - "Anlage EÜR (recommended)"
  - "Umsatzsteuererklärung"
  - "ESt 1A + Anlage S"
  - "Anlage Vorsorgeaufwand"

## Step 4: Guide Each Page

When the user pastes text or shares a screenshot of an ELSTER page:

1. **Identify** which form and section you're looking at.
2. **Look up** the values in `./output/steuer-<YEAR>-summary.json`.
3. **Tell the user** exactly what to type in each visible field, formatted as:
   - **Zeile X (KZ Y)** [Field Name]: Enter `VALUE` — (one-line explanation)
4. **Note** any fields to leave blank.
5. **Flag** anything you're uncertain about and ask the user to confirm.
6. After each page, ask via `AskUserQuestion`:
   - header: "Next"
   - question: "Done with this page. What's next?"
   - options:
     - "Show me the next page"
     - "Something looks wrong"
     - "Move to next form"
     - "I'm done filing"

## Common Field Reference (Anlage EÜR)

These are the typical lines for a Freiberufler doing software services for non-EU clients. Confirm against the actual current-year form — KZ numbers can shift between form versions.

| Zeile | KZ | Use for |
|-------|-----|---------|
| 14 | 135 | All freelance income (§3a Abs 2 UStG, list each client separately) |
| 30 | 110 | Fremdleistungen (contractors / freelancer platforms) |
| 33 | 130 | AfA (depreciation, assets > 800 EUR net) |
| 35 | 146 | GWG (small equipment < 800 EUR net) |
| 52 | 155 | Telekommunikation (internet + phone, apply business %) |
| 53 | 156 | Beiträge / Gebühren / Versicherungen (IHK, GEMA, business insurance) |
| 56 | 159 | EDV-Kosten (SaaS, cloud, AI tools, domains, marketing) |
| 65 | 168 | Übrige Betriebsausgaben (bank fees, misc) |

## Common Field Reference (USt)

- KZ 45: Total income (nicht steuerbare Umsätze, full EUR, no cents) — for software services to non-EU clients per §3a Abs 2 UStG.
- Verbleibende USt: 0.

## Common Field Reference (Anlage S)

- Zeile 4: Beruf = "Softwareentwicklung" (or your activity); Betrag = Gewinn from EÜR (full EUR, no cents).

## Important Reminders

- **All amounts in ELSTER: full EUR only**, rounded normally (no cents).
- **Use the right Steuernummer for each form.** The user may have a separate StNr for personal vs. business filings — confirm before each form. Never assume a value the user hasn't shared with you.
- **Personal data (StNr, IdNr, name, address, bank details, marital status, religion)**: this plugin does NOT store these. Ask the user to provide them when ELSTER asks. Suggest they keep their own private notes file outside the plugin.
- **Deadlines**: Standard freelancer deadline is 31.07. of the following year (e.g. 2024 returns due 31.07.2025). Late filings may incur Verspätungszuschlag — flag this if the user is past the deadline.
- **No Gewerbesteuer** for Freiberufler (§18 EStG).
- **You are not a tax advisor.** When in doubt, recommend the user verify with a Steuerberater.

## Reference Files

- `${CLAUDE_PLUGIN_ROOT}/references/elster-fields.md` — full Zeile / KZ mapping
- `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` — category definitions
