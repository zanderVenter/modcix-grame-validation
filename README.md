# MODCiX reloaded: GRAME validation

Code supporting **MODCiX reloaded**, a continuation of the MODCiX consortium
(Schweider et al. 2026, *Remote Sensing of Environment* 342:115466) that validates the
Copernicus **GRAME** (Grassland Mowing Events) product - a 10m-resolution Copernicus
Land Monitoring Service layer giving 0-4 mowing events per pixel per year across
EEA38+UK - against an independent, PlanetScope-imagery-based reference sample
collected by the consortium.

## Pipeline status

| # | Stage | Status | Where |
|---|---|---|---|
| 1 | Simple random sample of 2x2km grid cells over Europe | Done | [`notebooks/01_sample_design_and_grame_ingestion.ipynb`](notebooks/01_sample_design_and_grame_ingestion.ipynb) |
| 2 | Equal-allocation stratified random sample of 10x10m GRAME pixels (strata = mowing-event count) | Done | [`gee_scripts/01_stratified_pixel_sampling.js`](gee_scripts/01_stratified_pixel_sampling.js) |
| 3 | Ingest PlanetScope imagery (Planet Labs API) into a GEE asset | Done | [`scripts/planetscope_to_gee_ingestion.py`](scripts/planetscope_to_gee_ingestion.py) |
| 4 | GEE sampling app + Cloud Function backend (Google Sheets store) | Done | [`gee_scripts/02_sampling_app.js`](gee_scripts/02_sampling_app.js), [`cloud_function/`](cloud_function/) |
| 5 | Sampling campaign with the MODCiX consortium | Done | (campaign output, not in this repo) |
| 6 | Quantify sampler agreement, flag points needing re-verification | Not started | |
| 7 | Consolidate final reference sample | Not started | |
| 8 | Quantify GRAME accuracy (mowing-event counts + temporal detection) vs. both this PlanetScope sample and the original MODCiX sample; write up as a paper | Not started | |

## Repository map

```
config/           .env template + committed catalog.yaml (see "Secrets" below)
src/               shared config-loading code (used by the notebook and scripts/)
notebooks/         sample design (2km grid) and GRAME product ingestion (WEkEO -> GEE)
scripts/           standalone PlanetScope -> GEE ingestion script (Planet API search/order/relay)
gee_scripts/       Google Earth Engine Code Editor scripts (pixel sampling, sampling app)
cloud_function/    GCP Cloud Function backing the sampling app (Sheets read/write proxy)
```

## Setup

1. Create the environment:
   ```bash
   conda env create -f environment.yml
   conda activate modcix-grame-validation
   ```
2. Copy the secrets template and fill in your own values:
   ```bash
   cp config/template.env config/.env
   ```
   `config/.env` is git-ignored. `config/catalog.yaml` is committed but only contains
   `${VAR}` placeholders resolved from `config/.env` at runtime (via `src/config.py`) -
   never put real values directly into `catalog.yaml`.
3. Authenticate to Earth Engine and gcloud (only needed the first time, or after
   switching machines/accounts):
   ```bash
   earthengine authenticate
   gcloud auth application-default login
   ```

## Secrets and identity

Nothing in this repo should reveal a real API key or a specific GCP/GEE project. Three
places carry that information, and each is handled differently because of what's
technically possible:

- **Python (notebook, `scripts/`)**: reads secrets from `config/.env` via
  `src/config.py`'s `load_catalog()`. Never hardcode a key or project ID in a
  `.py` file or notebook cell - add it to `config/template.env` and reference it
  through `catalog[...]` instead.
- **GEE Code Editor scripts (`gee_scripts/*.js`)**: GEE Apps run client-side with no
  environment-variable support, so each file has a `CONFIG` block of `var` constants
  near the top (GEE asset prefix, Cloud Function URL, Sheet name, ...). Edit those
  before running/publishing your own copy - see the comments in each file.
- **Cloud Function (`cloud_function/`)**: the sampling app's backend - the code that
  reads/writes the Google Sheet it stores data in - is hosted as a
  [GCP Cloud Function](https://console.cloud.google.com/functions/) on the
  **Python 3.12** runtime. It has no secrets in its source: the Drive folder ID is
  read from the `DRIVE_FOLDER_ID` environment variable set at `gcloud functions
  deploy` time, and access is controlled by request origin, not an API key. See
  [`cloud_function/README.md`](cloud_function/README.md) for the full deploy
  walkthrough.

## Running the pipeline

1. **Sample design + GRAME ingestion** - open
   [`notebooks/01_sample_design_and_grame_ingestion.ipynb`](notebooks/01_sample_design_and_grame_ingestion.ipynb)
   and run top to bottom. Produces the sample grid cells and ingests the official
   GRAME product (via WEkEO) as a GEE asset.
2. **PlanetScope ingestion** - run the standalone script against the exported grid:
   ```bash
   python scripts/planetscope_to_gee_ingestion.py --help
   ```
3. **Stratified pixel sampling** - paste
   [`gee_scripts/01_stratified_pixel_sampling.js`](gee_scripts/01_stratified_pixel_sampling.js)
   into the [GEE Code Editor](https://code.earthengine.google.com/), edit its `CONFIG`
   block, and run.
4. **Sampling app** - deploy your own Cloud Function first (see
   [`cloud_function/README.md`](cloud_function/README.md)), then paste
   [`gee_scripts/02_sampling_app.js`](gee_scripts/02_sampling_app.js) into the Code
   Editor, edit its `CONFIG` block to point at your GEE assets and deployed Cloud
   Function, and either run it directly or publish it as a GEE App.

## Data

Large geospatial inputs/outputs (GRAME rasters, sample grids, sampler responses) live
on the NINA project drive, not in this repository - `config/.env`'s `PROJDIR` points
at that location locally. `.gitignore` excludes common geospatial formats accordingly.

## Citation

Schweider, M., Lobert, F., Weber, D., Reinermann, S., Asam, S., Sarvia, F., De Petris, S., Borgogno-Mondino, E., Muhuri, A., Oppelt, N., Atzberger, C., Tsardanidis, I., Kontoes, C., Godechal, F., Lucau-Danila, C., Planchon, V., Gariod, A., Huet, C., Valero, S., Mallet, C., Morel, J., Rossi, M., Vuolo, F., Dujakovic, A., Schaumberger, A., Klingler, A., Holtgrave, A.-K., Venter, Z., Sonnenschein, R., De Vroey, M., Radoux, J., Buck, O., Franke, A.K., Ostrowski, A., Schumacher, U., Hostert, P., & Erasmi, S. (2026).
Mowing detection intercomparison exercise (MODCiX) - Evaluation of grassland mowing detection algorithms across Europe.
*Remote Sensing of Environment*, 342, 115466. https://doi.org/10.1016/j.rse.2026.115466
