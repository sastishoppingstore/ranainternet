# Customer Website

A lightweight, public, bilingual (English / اردو) site for end customers. No login.

| Page | URL | Purpose |
|---|---|---|
| Home / packages | `/` | Company intro, package cards (from the live **Packages** table), contact + hours |
| Apply | `/apply.html` | Connection application form |
| Track | `/track.html` | Track an application by reference + phone |

## How an application flows

1. Customer opens **Apply**, fills name, CNIC, phone, WhatsApp, address, area,
   preferred package and optional notes, and submits.
2. The form posts to `POST /api/public/application` (rate-limited, no auth) and returns
   a **reference number** (e.g. `APP-7F3A2C`).
3. The customer is told to keep the reference and phone number to track status.
4. On the owner side the application lands in **Applications → New** and moves through
   survey → installation → activation (see Admin Guide).

## Tracking

- The success screen links directly to `track.html?ref=…&phone=…`.
- `track.html` calls `GET /api/public/track/:ref?phone=…` and shows the current stage
  (New / Surveyed / In installation / Activated / Rejected) plus, when activated, the
  customer code and package.
- A reference alone (no phone) is not enough to look up an application — both are
  required, which prevents enumeration.

## Public API (no auth)

| Method & path | Returns |
|---|---|
| `GET /api/public/company` | company name, logo, contact, hours |
| `GET /api/public/packages` | active packages with `id`, speeds, PKR price, install fee |
| `GET /api/public/areas` | service areas / zones |
| `POST /api/public/application` | creates application → `{ ref, message }` |
| `GET /api/public/track/:ref?phone=` | current status for a reference+phone pair |

> The apply form reads the **live** package list (including each package's `id`) and
> the live area list, so the owner can add/rename packages or areas and the website
> updates with no code change.

## i18n

Static strings use `data-i18n` keys with `I18N.en` / `I18N.ur` dictionaries in
`public/js/site.js`. A language toggle re-renders the whole page via
`window.renderDynamic()`. Currency is always formatted as PKR.

## Notes / honest behavior

- The site only **collects** applications; it does not claim a connection is provisioned.
- No payment is taken on the website (payments are recorded by the owner).
- Rate limiting + basic input sanitising on the public submit endpoint.
