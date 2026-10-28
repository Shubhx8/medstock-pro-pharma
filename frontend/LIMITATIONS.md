# Known Limitations (prototype scope)

- **Low-stock alerts use the medicine's first batch.** The `Alert` table only has `batch_id`, so LOW_STOCK / OUT_OF_STOCK alerts are attached to the medicine's first batch, which may be an expired one. This is a schema limitation, not a UI bug.
- **Single-medicine sales only.** The schema (`Sale` + `Sold_In`) and the seed data support multi-line sales, but the UI has no cart and creates one-medicine sales.
- **No real authentication.** The "Logged in as" picker is simulated, and roles are enforced only for disposal approval (Admin / Pharmacist).
- **Date format is mm/dd/yy by design.** This can be ambiguous for Indian users, who commonly use dd/mm/yy. It is a known trade-off.
