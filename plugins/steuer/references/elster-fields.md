# ELSTER Field Mapping — Generic Reference

Maps calculated EÜR amounts to specific ELSTER form fields for a typical German Freiberufler (selbständige Arbeit, §18 EStG). All Zeile / KZ references match recent versions of the form — verify against the actual current-year form before filing.

> Replace every `[PLACEHOLDER]` with your own personal data. This plugin intentionally does NOT store StNr, IdNr, name, address, bank details, marital status, or religion. Keep those in a private file outside this repository.

---

## Anlage EÜR (Einnahmenüberschussrechnung)

### General Information

| Field | Value |
|-------|-------|
| Steuernummer | `[YOUR_BUSINESS_STNR]` |
| Art der Tätigkeit | `[YOUR_ACTIVITY]` (e.g. "Softwareentwicklung") |
| Einkunftsart | Selbständige Arbeit (Freiberufler) |
| Zuordnung | Steuerpflichtige Person |

### Betriebseinnahmen (Business Income)

| Zeile | KZ | Field Name | What Goes Here |
|-------|-----|------------|---------------|
| 14 | 135 | Umsatzsteuerfreie / nicht steuerbare Betriebseinnahmen | All income from non-EU clients (§3a Abs 2 UStG). List each client separately: name + EUR total. |
| 22 | — | Summe Betriebseinnahmen | Auto-calculated. |

> **Why Zeile 14?** Software services to non-EU business clients are "nicht steuerbar" under §3a Abs 2 UStG (Leistungsort = Empfängerort, outside Germany). No VAT is charged. Confirm this applies to your specific service mix.

### Betriebsausgaben (Business Expenses)

| Zeile | KZ | Field Name | What Goes Here |
|-------|-----|------------|---------------|
| 30 | 110 | Bezogene Fremdleistungen | Contractor / freelancer platform costs. |
| 33 | 130 | AfA auf bewegliche Wirtschaftsgüter | Depreciation from Anlage AVEÜR (assets > 800 EUR net). |
| 35 | 146 | Aufwendungen für GWG (§6 Abs 2 EStG) | Equipment under 800 EUR net (immediate full deduction). |
| 52 | 155 | Aufwendungen für Telekommunikation | Internet + phone, after applying business-use % (commonly 40% / 30%). |
| 53 | 156 | Beiträge, Gebühren, Abgaben und Versicherungen | IHK / Chamber of Commerce, professional associations, business insurance. |
| 56 | 159 | Aufwendungen für EDV | All SaaS, cloud, AI tools, domains, marketing tools. |
| 65 | 168 | Übrige unbeschränkt abziehbare Betriebsausgaben | Bank fees, currency conversion fees, misc. |
| 72 | — | Summe Betriebsausgaben | Auto-calculated. |

### Gewinnermittlung (Profit Calculation)

| Zeile | Field Name | What Goes Here |
|-------|------------|---------------|
| 73 | Summe Betriebseinnahmen | Carried from Zeile 22. |
| 74 | Summe Betriebsausgaben | Carried from Zeile 72. |
| 92 / 95 / 97 | Steuerpflichtiger Gewinn / Verlust | Income minus expenses. |

---

## Umsatzsteuererklärung (Annual VAT Declaration)

### General Information

| Field | Value |
|-------|-------|
| Steuernummer | `[YOUR_BUSINESS_STNR]` |
| Unternehmen | `[YOUR_ACTIVITY]` |

### Key Fields

| Zeile | KZ | Field Name | What Goes Here |
|-------|-----|------------|---------------|
| 33 | 45 | Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland) | Total income in full EUR — all freelance income for the year. |

### Notes

- For software services to non-EU business clients: "nicht steuerbar" per §3a Abs 2 UStG.
- Verbleibende Umsatzsteuer: **0 EUR** if all income is non-EU services.
- No Vorsteuer to deduct unless you actively paid German USt on inputs.
- No ZM (Zusammenfassende Meldung) needed for clients in Drittländer (US, UK, etc.). EU B2B clients require a ZM.

---

## ESt 1A (Mantelbogen — Income Tax Main Form)

### General Information

| Field | Value |
|-------|-------|
| Steuernummer | `[YOUR_PERSONAL_STNR]` |
| IdNr | `[YOUR_IDNR]` |
| Name | `[YOUR_NAME]` |
| Address | `[YOUR_ADDRESS]` |
| Bank details | `[YOUR_BANK_DETAILS]` |
| Familienstand | `[CONFIRM_WITH_USER]` |
| Religion | `[CONFIRM_WITH_USER]` |

> Personal and business filings may use **different Steuernummern** (e.g. when the Finanzamt for personal taxes differs from the one for the business). Always confirm which StNr belongs to which form.

---

## Anlage S (Einkünfte aus selbständiger Arbeit)

| Zeile | Field Name | What Goes Here |
|-------|------------|---------------|
| 4 | Beruf / Betrag | Beruf = `[YOUR_ACTIVITY]`. Betrag = Gewinn from EÜR (full EUR, no cents). |

- Einkunftsart: **Freiberufliche Tätigkeit** (§18 EStG)
- The amount in Zeile 4 must match the Gewinn in Anlage EÜR.
- **No Gewerbesteuer** for Freiberufler.

---

## Anlage Vorsorgeaufwand (Insurance Deductions)

### Kranken- und Pflegeversicherung

| Item | Amount |
|------|--------|
| Krankenversicherung | `[YOUR_KV_TOTAL]` (annual total) |
| Type | `[CONFIRM: gesetzlich (GKV) or privat (PKV)]` |

**If gesetzlich (GKV):**
- Basisabsicherung → Zeile 11
- Pflegeversicherung → Zeile 13

**If privat (PKV):**
- Basisabsicherung → Zeile 23
- Pflegeversicherung → Zeile 25

---

## Quick Reference

| Need to enter… | Form | Zeile / KZ |
|---|---|---|
| All client income (per client) | Anlage EÜR | 14 / KZ 135 |
| Contractors | Anlage EÜR | 30 / KZ 110 |
| Depreciation | Anlage EÜR | 33 / KZ 130 |
| Small equipment | Anlage EÜR | 35 / KZ 146 |
| Internet + Phone | Anlage EÜR | 52 / KZ 155 |
| IHK + Insurance | Anlage EÜR | 53 / KZ 156 |
| SaaS + Marketing | Anlage EÜR | 56 / KZ 159 |
| Bank fees + Misc | Anlage EÜR | 65 / KZ 168 |
| Total income (USt) | Umsatzsteuererklärung | KZ 45 |
| Gewinn | Anlage S | Zeile 4 |
| Health insurance | Anlage Vorsorgeaufwand | Zeile 11/13 (GKV) or 23/25 (PKV) |

## Important Reminders

- **All amounts in ELSTER: full EUR only**, no cents.
- **Two Steuernummern are common** (personal vs business). Use the right one per form.
- **Standard freelancer deadline**: 31.07. of the following year.
- **You are not a tax advisor.** Verify with a Steuerberater for anything non-obvious.
