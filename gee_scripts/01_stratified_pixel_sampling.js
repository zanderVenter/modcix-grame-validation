/**
 * Pipeline stage: stratified random sample of 10x10m GRAME pixels.
 *
 * Draws an equal-allocation stratified random sample of GRAME pixels (10m
 * resolution grassland mowing-event counts) within a set of previously
 * selected 2x2km sample grids, using GRAME class (0-4 mowing events/year) as
 * the stratum. Exports the sampled points as a GEE table asset - this asset
 * is what gee_scripts/02_sampling_app.js reads to build the sampling
 * campaign UI.
 *
 * Run in the GEE Code Editor (code.earthengine.google.com). Paste this file
 * in, edit the CONFIG block below, then Run.
 */

// ============================================================
// CONFIG - edit before running
// ============================================================
// GEE asset root: the projects/<root>/ prefix your permanent assets live
// under. NOT necessarily the GCP project you sign in with for Earth Engine -
// e.g. this pipeline's original assets live under projects/nina/, a legacy
// asset namespace unrelated to any specific GCP project's billing/auth
// (matches gee_project.asset_root in config/catalog.yaml, if you're keeping
// this in sync with the Python side).
var GEE_ASSET_ROOT = 'projects/YOUR_GEE_ASSET_ROOT/';

// GRAME (Grassland Mowing Events) rasters ingested via
// scripts/planetscope_to_gee_ingestion.py / the notebook's WEkEO section.
var GRAME_2021_ASSET = GEE_ASSET_ROOT + 'Europe_misc/CLMS_HRLVLCC_GRAME_S2021_R10m';
var GRAME_2023_ASSET = GEE_ASSET_ROOT + 'Europe_misc/CLMS_HRLVLCC_GRAME_S2023_R10m';

// The 2x2km sample grid selected in the earlier simple-random-sample stage
// (notebooks/01_sample_design_and_grame_ingestion.ipynb), uploaded as a GEE asset.
var SAMPLE_GRID_ASSET = GEE_ASSET_ROOT + 'modcix_planetscope_grid_samples_simp_rnd';

// Where to export the resulting stratified pixel sample.
var OUTPUT_ASSET_ID = 'modcix_sample_pts_v2';
// ============================================================

var grame2021raw = ee.ImageCollection(GRAME_2021_ASSET),
    grame2023raw = ee.ImageCollection(GRAME_2023_ASSET),
    // Rough bounding box for mainland Europe, used to drop overseas/outlier tiles.
    europeBounds = ee.Geometry.Polygon(
        [[[-39.854453862192486, 73.18131171662316],
          [-39.854453862192486, 25.022927897255943],
          [54.01273363780751, 25.022927897255943],
          [54.01273363780751, 73.18131171662316]]], null, false),
    grid = ee.FeatureCollection(SAMPLE_GRID_ASSET);

grid = grid.select(['GRD_ID']);

Map.addLayer(grid, {}, 'grid', 0);
Map.addLayer(grid.style({fillColor: '#00000000', color: 'red'}), {}, 'grid outline', 0);

grame2021raw = grame2021raw.filterBounds(europeBounds);
grame2023raw = grame2023raw.filterBounds(europeBounds);

var proj = grame2021raw.first().projection();
print('GRAME native projection', proj);

var grame2021 = grame2021raw.mosaic().rename('grame2021');
Map.addLayer(grame2021, {min: 0, max: 1, palette: ['white', 'green']}, 'grame2021', 0);
var grame2023 = grame2023raw.mosaic().rename('grame2023');
Map.addLayer(grame2023.randomVisualizer(), {}, 'grame2023', 0);

// GRAME code 253 = non-herbaceous, 255 = outside mapped area - mask both out
// so the stratification is only over valid 0-4 mowing-event pixels.
var stratImg = grame2021.updateMask(grame2021.neq(253).and(grame2021.neq(255)));
Map.addLayer(stratImg.randomVisualizer(), {}, 'stratification image', 0);

// Equal allocation: sampleSize points are drawn per stratum (per mowing-event
// count 0-4), independent of how common each stratum is on the ground.
var stratSamples = getEqualAllocationStratifiedSample(stratImg, grid, 200, 10, proj, 234);

Export.table.toAsset({
  collection: stratSamples,
  description: OUTPUT_ASSET_ID,
  assetId: GEE_ASSET_ROOT + OUTPUT_ASSET_ID
});

/**
 * Draws an equal-allocation stratified random sample from stratImage over
 * aoi, and derives a stable PLOTID from each point's rounded coordinates.
 */
function getEqualAllocationStratifiedSample(stratImage, aoi, sampleSize, scale, proj, seed) {
  var sample = stratImage.rename('stratum')
    .reproject(proj.atScale(scale))
    .stratifiedSample({
      seed: seed,
      numPoints: sampleSize, // points per stratum (equal allocation)
      region: aoi,
      classBand: 'stratum',
      tileScale: 2,
      projection: proj,
      scale: scale,
      geometries: true
    });

  sample = sample.map(function (ft) {
    var lon = ee.Number(ee.List(ft.geometry().coordinates()).get(0)).multiply(1e14).round().divide(1e14);
    var lat = ee.Number(ee.List(ft.geometry().coordinates()).get(1)).multiply(1e14).round().divide(1e14);
    return ft.set(
      'PLOTID', ee.String('a').cat(ee.String(lon).replace('\\.', '-')).cat('_').cat(ee.String(lat).replace('\\.', '-')),
      'LONGITUDE', lon,
      'LATITUDE', lat
    );
  });

  return sample.sort('PLOTID');
}
