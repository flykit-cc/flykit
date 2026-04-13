# German EÜR Tax Categories

Generic mapping of common business expense categories to EÜR (Einnahmenüberschussrechnung) lines for Freiberufler. This file is intentionally generic — replace example merchants with your own. Always verify against the current-year ELSTER form.

> **Disclaimer**: This is a starting point, not tax advice. Confirm classifications with a Steuerberater for your specific situation.

---

## Income (Betriebseinnahmen)

| Category | EÜR Zeile | KZ | Description |
|----------|-----------|-----|-------------|
| `business_income` | 14 | 135 | All freelance income from non-EU clients (§3a Abs 2 UStG, "nicht steuerbar"). List each client separately with its EUR total. |
| `business_income_de` | 14 | 135 | Income from German/EU clients. If you charge USt, check whether KZ 14 is correct for your specific situation. |

**Examples (replace with your own):**

```jsonc
{
  "[YOUR_CLIENT_A]":  { "type": "client_income", "country": "US", "currency": "USD" },
  "[YOUR_CLIENT_B]":  { "type": "client_income", "country": "DE", "currency": "EUR" },
  "[YOUR_PLATFORM]":  { "type": "client_income", "country": "US", "currency": "USD",
                        "notes": "Freelancer payment platform" }
}
```

---

## Business Expenses (Betriebsausgaben)

### `edv_kosten` — IT / Software (Zeile 56 / KZ 159)

100% deductible. Software subscriptions, cloud infrastructure, AI tools, domains, marketing.

```jsonc
{
  "[CLOUD_PROVIDER]":     { "category": "edv_kosten", "deductible_percent": 100 },
  "[SAAS_TOOL]":          { "category": "edv_kosten", "deductible_percent": 100 },
  "[AI_API]":             { "category": "edv_kosten", "deductible_percent": 100 },
  "[DOMAIN_REGISTRAR]":   { "category": "edv_kosten", "deductible_percent": 100 },
  "[CODE_HOSTING]":       { "category": "edv_kosten", "deductible_percent": 100 }
}
```

### `telekommunikation` — Internet / Phone (Zeile 52 / KZ 155)

Partial deduction based on business use percentage. Common defaults: internet 40%, phone 30%.

```jsonc
{
  "[INTERNET_PROVIDER]":  { "category": "telekommunikation", "deductible_percent": 40 },
  "[MOBILE_CARRIER]":     { "category": "telekommunikation", "deductible_percent": 30 }
}
```

### `fremdleistungen` — Contractors (Zeile 30 / KZ 110)

Payments to other freelancers / contractors / freelance platforms.

```jsonc
{
  "[FREELANCER_PLATFORM]": { "category": "fremdleistungen", "deductible_percent": 100 },
  "[SUBCONTRACTOR_NAME]":  { "category": "fremdleistungen", "deductible_percent": 100 }
}
```

### `gwg_equipment` — Small Equipment (Zeile 35 / KZ 146)

Hardware under 800 EUR net price — fully deductible in the year of purchase under §6 Abs 2 EStG.

```jsonc
{
  "[ELECTRONICS_STORE]":  { "category": "gwg_equipment", "deductible_percent": 100 },
  "[OFFICE_SUPPLY]":      { "category": "gwg_equipment", "deductible_percent": 100 }
}
```

### `afa` — Depreciation (Zeile 33 / KZ 130)

Assets > 800 EUR net are depreciated over their useful life (laptop 3 years, furniture 13 years, etc.). Use Anlage AVEÜR. This plugin does not currently compute AfA — track separately.

### `marketing` — Advertising (Zeile 56 / KZ 159)

Same line as EDV-Kosten on the current form.

```jsonc
{
  "[AD_PLATFORM]":        { "category": "marketing", "deductible_percent": 100 },
  "[MARKETING_AGENCY]":   { "category": "marketing", "deductible_percent": 100 }
}
```

### `beitraege_gebuehren` / `versicherungen` — Fees & Insurance (Zeile 53 / KZ 156)

Chamber of Commerce, professional association fees, business insurance.

```jsonc
{
  "[CHAMBER_OF_COMMERCE]": { "category": "beitraege_gebuehren", "deductible_percent": 100 },
  "[PROFESSIONAL_ASSOC]":  { "category": "beitraege_gebuehren", "deductible_percent": 100 },
  "[BUSINESS_INSURANCE]":  { "category": "versicherungen",      "deductible_percent": 100 }
}
```

### `sonstige` — Other (Zeile 65 / KZ 168)

Bank fees, currency conversion fees, miscellaneous business costs that don't fit elsewhere.

```jsonc
{
  "[BANK_FEES]":          { "category": "sonstige", "deductible_percent": 100 }
}
```

---

## What Goes Where (Quick Reference)

| Category | EÜR Line |
|----------|----------|
| Contractors | 30 / KZ 110 |
| Depreciation (>800 EUR net) | 33 / KZ 130 |
| Small equipment (<800 EUR net) | 35 / KZ 146 |
| Internet + Phone | 52 / KZ 155 |
| Insurance + Fees (IHK, GEMA, etc.) | 53 / KZ 156 |
| SaaS / Software / Cloud / Marketing | 56 / KZ 159 |
| Bank fees + Misc | 65 / KZ 168 |

## Personal Expenses (NOT deductible)

Personal spending should be tagged as `personal` and excluded from EÜR totals. Common categories: groceries, restaurants, personal transport, personal entertainment, personal hobbies. Even if paid from a business card, they don't go in the EÜR.

## Skip / Internal

These transaction types aren't income or expenses and should be skipped:

- `CONVERSION` — currency conversion within the same account
- `INTERBALANCE` — internal transfer between own accounts
- `CARD_CHECK` — temporary auth hold (no actual money moved)
- Self-transfers (counterparty matches your own name)
