#!/usr/bin/env python3
"""Ingest PlanetScope imagery into a Google Earth Engine asset, in one go.

For each sample grid cell in the input file(s), this script:
  1. Searches the Planet Data API for PSScene scenes (with an 8-band surface
     reflectance asset) matching the date range and cloud-cover threshold,
     and keeps scenes covering more than --overlap-threshold percent of the
     grid cell.
  2. Submits a Planet Orders API v2 order per grid cell, requesting direct
     delivery into a staging GEE collection.
  3. Polls each order and, once it succeeds, relays (renames) the delivered
     assets from the staging collection into the permanent target collection.

Extracted from the "Query Planet Labs API" / "Submit orders to Planet API"
sections of notebooks/01_sample_design_and_grame_ingestion.ipynb - see that
notebook for the sample-design steps that produce the grid input file(s).

Usage:
    python scripts/planetscope_to_gee_ingestion.py \\
        --grid-files data/for_gee/modcix_planetscope_grid_samples.shp \\
        --start-date 2021-01-01 --end-date 2021-12-31 \\
        --target-collection PlanetScope/Europe_2kmGridSample_ortho_analytic_8b_sr \\
        --staging-collection test_planetscope

Secrets (Planet API key, GEE project/bucket) are read from config/catalog.yaml
via config/.env - see README.md for setup.
"""

import argparse
import time
from datetime import datetime

import ee
import geopandas as gpd
import pandas as pd
import requests
from requests.auth import HTTPBasicAuth
from shapely.geometry import shape

from src.config import load_catalog

PLANET_SEARCH_URL = "https://api.planet.com/data/v1/quick-search"
PLANET_ORDERS_URL = "https://api.planet.com/compute/ops/orders/v2"
ITEM_TYPE = "PSScene"
PRODUCT_BUNDLE = "analytic_8b_sr_udm2"
REQUIRED_ASSET = "ortho_analytic_8b_sr"


def load_grid(grid_files: list[str]) -> gpd.GeoDataFrame:
    gdfs = [gpd.read_file(f) for f in grid_files]
    grid = gpd.GeoDataFrame(pd.concat(gdfs, ignore_index=True))
    return grid.to_crs("EPSG:4326")


def search_planet_by_grid(grid_gdf, api_key, start_date, end_date, cloud_cover_max):
    """Query the Planet Data API per grid cell, return {grid_id: [scene_id, ...]} and scene metadata."""
    auth = HTTPBasicAuth(api_key, "")
    grid_results = {}
    all_found_features = []

    for _, row in grid_gdf.iterrows():
        grid_id = row["GRD_ID"]
        print(f"Searching cell: {grid_id}...")

        search_filter = {
            "type": "AndFilter",
            "config": [
                {"type": "GeometryFilter", "field_name": "geometry", "config": row.geometry.__geo_interface__},
                {"type": "DateRangeFilter", "field_name": "acquired", "config": {"gte": start_date, "lte": end_date}},
                {"type": "RangeFilter", "field_name": "cloud_cover", "config": {"lte": cloud_cover_max}},
                {"type": "AssetFilter", "config": [REQUIRED_ASSET]},
            ],
        }
        query = {"item_types": [ITEM_TYPE], "filter": search_filter}

        cell_scene_ids = []
        response = requests.post(PLANET_SEARCH_URL, auth=auth, json=query)
        while response.status_code == 200:
            data = response.json()
            for feature in data["features"]:
                scene_id = feature["id"]
                cell_scene_ids.append(scene_id)
                all_found_features.append({
                    "id": scene_id,
                    "grid_id": grid_id,
                    "instrument": feature["properties"]["instrument"],
                    "view_angle": feature["properties"]["view_angle"],
                    "gee_date": feature["properties"]["acquired"],
                    "cloud_cover": feature["properties"]["cloud_cover"],
                    "geometry": shape(feature["geometry"]),
                })
            next_url = data["_links"].get("_next")
            response = requests.get(next_url, auth=auth) if next_url else None
            if response is None:
                break

        grid_results[grid_id] = list(set(cell_scene_ids))

    return grid_results, all_found_features


def filter_by_overlap(scene_features, grid_gdf, overlap_threshold):
    """Keep only scenes covering more than overlap_threshold percent of their grid cell."""
    scenes_gdf = gpd.GeoDataFrame(scene_features, crs="EPSG:4326")
    merged = scenes_gdf.merge(
        grid_gdf[["GRD_ID", "geometry"]],
        left_on="grid_id", right_on="GRD_ID", suffixes=("_scene", "_grid"),
    )

    def overlap_pct(row):
        if not row["geometry_scene"].intersects(row["geometry_grid"]):
            return 0.0
        return (row["geometry_scene"].intersection(row["geometry_grid"]).area / row["geometry_grid"].area) * 100

    merged["overlap_percent"] = merged.apply(overlap_pct, axis=1)
    high_quality = merged[merged["overlap_percent"] > overlap_threshold].copy()
    print(f"Found {len(merged)} total scenes, {len(high_quality)} with >{overlap_threshold}% grid coverage.")
    return high_quality


def submit_grid_order(grid_id, scene_ids, grid_geometry, api_key, gcp_project, staging_collection):
    order_name = f"Grid_{grid_id}_{datetime.now().strftime('%m%d_%H%M')}"
    payload = {
        "name": order_name,
        "products": [{"item_ids": scene_ids, "item_type": ITEM_TYPE, "product_bundle": PRODUCT_BUNDLE}],
        "tools": [{"clip": {"aoi": grid_geometry.__geo_interface__}}],
        "delivery": {"google_earth_engine": {"project": gcp_project, "collection": staging_collection}},
    }
    response = requests.post(PLANET_ORDERS_URL, auth=(api_key, ""), json=payload)
    if response.status_code == 202:
        order_id = response.json().get("id")
        print(f"Submitted grid {grid_id} -> order {order_id}")
        return order_id, order_name
    print(f"Order submission failed for grid {grid_id}: {response.status_code} {response.text}")
    return None, None


def relay_staging_to_target(staging_path, target_path):
    """Rename (move) every asset currently in the staging collection into the target collection."""
    try:
        assets = ee.data.listAssets({"parent": staging_path}).get("assets", [])
    except Exception as e:
        print(f"Error listing assets in {staging_path}: {e}")
        return

    if not assets:
        print("Staging collection is empty, nothing to relay.")
        return

    moved = 0
    for asset in assets:
        source_id = asset["name"]
        destination_id = f"{target_path}/{source_id.split('/')[-1]}"
        try:
            ee.data.renameAsset(source_id, destination_id)
            moved += 1
        except Exception as e:
            print(f"Failed to move {source_id}: {e}")
    print(f"Relayed {moved} assets from {staging_path} to {target_path}.")


def monitor_and_relay(order_info, api_key, staging_path, target_path, poll_seconds=600, post_success_wait=300):
    """Poll Planet orders until each finishes, then relay its assets to the target collection."""
    remaining = dict(order_info)
    while remaining:
        for order_id in list(remaining):
            res = requests.get(f"{PLANET_ORDERS_URL}/{order_id}", auth=(api_key, ""))
            if res.status_code != 200:
                continue
            state = res.json().get("state")
            if state in ("success", "partial"):
                print(f"{remaining[order_id]} ({order_id}) is {state}. Waiting {post_success_wait}s for GEE indexing...")
                time.sleep(post_success_wait)
                relay_staging_to_target(staging_path, target_path)
                del remaining[order_id]
            elif state == "failed":
                print(f"{remaining[order_id]} ({order_id}) FAILED.")
                del remaining[order_id]
        if remaining:
            time.sleep(poll_seconds)

    # catch any assets that landed after the last order finished
    relay_staging_to_target(staging_path, target_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--grid-files", nargs="+", required=True, help="Grid cell vector file(s) (shp/geojson) with a GRD_ID column")
    parser.add_argument("--start-date", required=True, help="ISO date, e.g. 2021-01-01")
    parser.add_argument("--end-date", required=True, help="ISO date, e.g. 2021-12-31")
    parser.add_argument("--cloud-cover-max", type=float, default=0.3)
    parser.add_argument("--overlap-threshold", type=float, default=25.0, help="Minimum scene/grid-cell overlap percent to keep a scene")
    parser.add_argument("--staging-collection", default="test_planetscope", help="Temporary GEE collection Planet delivers into")
    parser.add_argument("--target-collection", required=True, help="Final GEE asset path, relative to your GEE asset root (config/catalog.yaml gee_project.asset_root), e.g. PlanetScope/my_collection")
    parser.add_argument("--poll-seconds", type=int, default=600, help="Seconds between order-status polls")
    args = parser.parse_args()

    catalog = load_catalog()
    # GCP project: used to authenticate (ee.Initialize) and as the delivery target for
    # Planet's GEE integration - this is the project you gcloud/earthengine-authenticate as.
    gcp_project = catalog["gee_project"]["name"]
    # GEE asset root: the projects/<root>/... prefix under which the final, permanent
    # assets live. For legacy (pre-Cloud-projects) GEE assets this is unrelated to the
    # GCP project above - e.g. this pipeline's assets live under projects/nina/... even
    # though ee.Initialize() authenticates against a different GCP project.
    asset_root = catalog["gee_project"]["asset_root"]
    api_key = catalog["planet_account"]["apikey"]

    ee.Initialize(project=gcp_project)

    grid_gdf = load_grid(args.grid_files)
    print(f"Loaded {len(grid_gdf)} grid cells.")

    start_date = f"{args.start_date}T00:00:00.000Z"
    end_date = f"{args.end_date}T23:59:59.000Z"
    _, scene_features = search_planet_by_grid(grid_gdf, api_key, start_date, end_date, args.cloud_cover_max)
    high_quality_scenes = filter_by_overlap(scene_features, grid_gdf, args.overlap_threshold)

    # Planet delivers into the staging collection under the GCP project (its GEE
    # integration writes there directly); the final home is under the asset root.
    staging_path = f"projects/{gcp_project}/assets/{args.staging_collection}"
    target_path = f"projects/earthengine-legacy/assets/projects/{asset_root}/{args.target_collection}"

    submitted = []
    for grid_id in high_quality_scenes["GRD_ID"].unique():
        scene_ids = high_quality_scenes[high_quality_scenes["GRD_ID"] == grid_id]["id"].tolist()
        grid_geom = grid_gdf[grid_gdf["GRD_ID"] == grid_id].iloc[0].geometry
        order_id, order_name = submit_grid_order(grid_id, scene_ids, grid_geom, api_key, gcp_project, args.staging_collection)
        if order_id:
            submitted.append((order_id, order_name))

    if not submitted:
        print("No orders were submitted - nothing to relay.")
        return

    monitor_and_relay(dict(submitted), api_key, staging_path, target_path, poll_seconds=args.poll_seconds)
    print("Done. Assets ingested into:", target_path)


if __name__ == "__main__":
    main()
