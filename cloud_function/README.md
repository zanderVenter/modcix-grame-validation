# Cloud Function: sampling app backend

This is the backend for the GEE sampling app (`gee_scripts/02_sampling_app.js`). GEE
Code Editor apps run entirely client-side and cannot call the Google Sheets/Drive
APIs directly, so the app POSTs/GETs to this HTTP Cloud Function, which reads and
writes a Google Sheet on the app's behalf.

It is a plain [GCP Cloud Function](https://console.cloud.google.com/functions/) -
`main.py` + `requirements.txt`, no framework - deployed on the **Python 3.12**
runtime (see the deploy command below). You manage it from the Cloud Console
(Cloud Functions section) or via `gcloud functions ...` on the CLI; there's no
other infrastructure involved.

## How it works

- **Access control**: no API key. The function only accepts requests whose `Origin`
  header matches a GEE domain (`https://*.earthengine.app` or
  `https://code.earthengine.google.com`) - see `ALLOWED_ORIGIN` in `main.py`. This is
  sufficient because a browser won't let arbitrary pages spoof the `Origin` header,
  and GEE Apps/Code Editor pages are the only thing that should be calling this.
  (Note: this cleaned-up version matches the *whole* origin against the pattern,
  which is slightly stricter than the original `re.findall`-based substring check -
  worth knowing if you're diffing against an older deployment.)
- **Google auth**: the function uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) -
  i.e. its own Cloud Functions runtime service account - to call the Drive and
  Sheets APIs. No key file is checked into this repo or needed at deploy time.
- **Storage**: submitted rows are appended to a Google Sheet living inside one
  Drive folder (`DRIVE_FOLDER_ID`). One sheet per `name` query param (the sampling
  app uses `GOOGLESHEET` from `gee_scripts/02_sampling_app.js` as this name); the
  function creates the sheet if it doesn't already exist.
- **Reading data back**: `GET <url>?name=<sheet>&fetch=<a1-range>` returns
  `{"success": true, "data": [[...], ...]}` for that range (`fetch=1`/`fetch=true`
  is shorthand for all of `Sheet1`). Used by the app for the leaderboard and the
  to-fetch/to-do list. **Only works if `<sheet>` already exists and its name starts
  with `public_`** - this is a deliberate second access-control layer so a caller
  can't read back an arbitrary sheet in the Drive folder, only ones you've named as
  shareable. Make sure `GOOGLESHEET` in `gee_scripts/02_sampling_app.js` starts with
  `public_` if you want the leaderboard/to-do-list features to work.

## Deploying your own copy

1. Create (or reuse) a Google Drive folder to hold the response spreadsheets, and
   note its folder ID (the long ID in its URL).
2. Deploy the function to your own GCP project:

   ```bash
   gcloud functions deploy zsv_data_store \
     --project=YOUR_GCP_PROJECT \
     --region=us-central1 \
     --runtime=python312 \
     --source=cloud_function \
     --entry-point=exec \
     --trigger-http \
     --allow-unauthenticated \
     --set-env-vars=DRIVE_FOLDER_ID=YOUR_DRIVE_FOLDER_ID
   ```

3. Find the function's runtime service account (Cloud Console -> Cloud Functions ->
   your function -> Details -> "Runtime service account", or
   `gcloud functions describe zsv_data_store --project=YOUR_GCP_PROJECT`), and
   share the Drive folder from step 1 with that service account as an **Editor**.
4. Take the deployed trigger URL
   (`https://<region>-<project>.cloudfunctions.net/zsv_data_store`) and put it in
   the `CLOUD_FUNCTION_URL` constant at the top of `gee_scripts/02_sampling_app.js`.
5. `--allow-unauthenticated` is required since GEE Apps call this function as an
   anonymous browser request - access is controlled by the Origin check inside the
   function itself (see above), not by IAM.
