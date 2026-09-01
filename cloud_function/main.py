"""GCP Cloud Function backing the GEE sampling app (deployed name: zsv_data_store).

Proxies the GEE sampling app (gee_scripts/02_sampling_app.js) to Google Sheets,
since GEE Code Editor apps cannot call the Sheets/Drive APIs directly.

Auth model:
  - No API key. Access is restricted purely by the request's Origin header,
    which must match a GEE Code Editor / GEE App domain (see ALLOWED_ORIGIN
    below). This is enough because the function only reads/writes sampling
    data, not anything sensitive to the wider internet, and GEE Apps/Code
    Editor cannot spoof an arbitrary Origin header.
  - Drive/Sheets access uses the function's own runtime service account via
    Application Default Credentials (no key file needed) - build(...) below
    picks this up automatically. That service account must be shared
    (Editor access) on the Drive folder given by DRIVE_FOLDER_ID.

Write path (implemented below):
  POST <function-url>?name=<sheet-name>   body: JSON array of row values
  Finds (or creates) a Sheet called <sheet-name> inside DRIVE_FOLDER_ID and
  appends the posted rows to it.

Known gap - read/"fetch" path (NOT implemented here):
  The sampling app also calls this endpoint as
  GET <function-url>?name=<sheet-name>&fetch=<a1-range>
  expecting {"success": true, "data": [[...], ...]} back (used for the
  leaderboard and the to-fetch/to-do list of sample PLOTIDs). That branch
  existed in the live deployment this was cleaned up from, but wasn't
  captured in the source snapshot this file is based on, so it has been
  left out rather than guessed at. Add a `fetch` branch here (a
  spreadsheets().values().get(...).execute() call) before redeploying if
  you need the app's leaderboard/to-do-list features to work.
"""

import json
import os
import re
import uuid

from googleapiclient.discovery import build

DRIVE_FOLDER_ID = os.environ["DRIVE_FOLDER_ID"]

ALLOWED_ORIGIN = re.compile(r"https://.*\.earthengine\.app|https://code\.earthengine\.google\.com")

drive_service = build("drive", "v3", cache_discovery=False)
sheets_service = build("sheets", "v4", cache_discovery=False)


def exec(request):
    origin = request.environ.get("HTTP_ORIGIN", "")

    if not ALLOWED_ORIGIN.fullmatch(origin):
        return ("Access Denied", 403)

    headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }

    if request.method == "OPTIONS":
        return ("", 204, headers)

    name = request.args.get("name")
    spreadsheet_id = None

    if name:
        results = drive_service.files().list(
            q=f"'{DRIVE_FOLDER_ID}' in parents and name='{name}'",
            fields="files(id, name)",
        ).execute()
        items = results.get("files", [])
        if items:
            spreadsheet_id = items[0]["id"]

    if spreadsheet_id is None:
        name = name or str(uuid.uuid4())
        created = drive_service.files().create(body={
            "name": name,
            "parents": [DRIVE_FOLDER_ID],
            "mimeType": "application/vnd.google-apps.spreadsheet",
        }).execute()
        spreadsheet_id = created["id"]

    sheets_service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A:A",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"majorDimension": "ROWS", "values": request.json},
    ).execute()

    return (json.dumps({"success": True, "name": name}), 200, headers)
