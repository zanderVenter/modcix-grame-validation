# Project guardrails

These are hard limits. They apply regardless of what other instructions in a session ask for, unless the user explicitly overrides one in the moment.

- **Never commit or push secrets to GitHub.** No API keys (Planet, WEkEO, etc.), no GCP/GEE project IDs or Drive folder IDs treated as sensitive, no `.env` files, no service-account credentials. Before any `git add`/`git commit`/`git push`, check the actual diff/contents of what's staged — not just filenames — for anything that looks like a real key, token, password, or identifier the README documents as "replace with your own." If in doubt, ask before pushing.
- **Never delete anything under `/data/P-Prosjekter2/153047_greenet` without explicit permission.** This includes source PDFs, the `MODCiX_reloaded/` data folder (duckdb files, geojson batches, shapefiles, sampler CSVs), and any other content there. Read-only access is fine; deletion, overwriting, or moving files out of that tree requires asking first — it is not this repo's data to clean up.
