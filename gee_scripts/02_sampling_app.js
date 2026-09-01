/**
 * Grassland mowing reference sampling app.
 *
 * GEE Code Editor App (Apps > Publish) used by the MODCiX consortium to
 * label mowing-event dates against PlanetScope + Sentinel-2 NDVI time
 * series at each sample point (see gee_scripts/01_stratified_pixel_sampling.js
 * for how those sample points were generated).
 *
 * Submissions are POSTed to the Cloud Function in cloud_function/, which
 * appends them to a Google Sheet (GEE Apps can't call Sheets/Drive directly).
 * See cloud_function/README.md for how to deploy your own backend.
 */

// ============================================================
// CONFIG - edit before publishing your own copy of this app
// ============================================================
// 'dev' uses the dummyData below instead of hitting the Cloud Function -
// useful for testing the UI without a live backend. Switch to 'live' once
// GEE_ASSET_PREFIX and CLOUD_FUNCTION_URL below point at your own resources.
var MODE = 'dev';

// Prefix for your own GEE assets, matching gee_scripts/01_stratified_pixel_sampling.js.
var GEE_ASSET_PREFIX = 'projects/YOUR_GEE_PROJECT/';

// Trigger URL of your deployed cloud_function/main.py (see cloud_function/README.md).
var CLOUD_FUNCTION_URL = 'https://REGION-YOUR_GCP_PROJECT.cloudfunctions.net/zsv_data_store';

// Contact shown to samplers if a submission fails.
var CONTACT_EMAIL = 'your.email@example.com';

// The name of the Google Sheet where the data is stored (used as the Cloud
// Function's `name` query param, which finds-or-creates a sheet by this name
// in the configured Drive folder - see cloud_function/main.py).
// Structure of that sheet (see cloud_function/README.md for setup):
//   - "Sheet1": raw rows pushed from the app on each submission
//   - "to_fetch": PLOTIDs with < 2 submissions in Sheet1 - the app pulls its
//     to-do list of unprocessed sample points from here (not implemented
//     server-side yet, see cloud_function/main.py's documented gap)
//   - "leaderboard": per-sampler submission counts, shown on the app's login screen
var GOOGLESHEET = 'YOUR_SHEET_NAME';
// ============================================================


var dummyData = [
  ['PLOTID'],
  ['a1-56029467927432_45-82930175441583'],
  //['a-7-06955587529353_40-75900037485715'],
  //['a-6-02196227442353_37-50530664939668']
];

var dummyData2 = [
  ["", "count", "", "", ""],
  ["luke", 24, 1, "🥇", "🥇 luke [24]"],
  ["pete_jacobs", 24, 1, "🥇", "🥇 pete_jacobs [24]"],
  ["zander", 19, 3, "🥉", "🥉 zander [19]"],
  ["Trond", 17, 4, "4)", "4) Trond [17]"],
  ["Balint", 7, 5, "5)", "5) Balint [7]"],
];

function fetchData(key, sheetcols, data, callback) {
 
  var payload = JSON.stringify(data);
  var request = new XMLHttpRequest();
  request.onload = function() {
    try {
      callback(JSON.parse(request.responseText));
    } catch (e) {
     callback({ success: false, error: "Python Error" });
    }
  };
  request.timeout = 20000;
  request.ontimeout = request.onerror = function() {
     
    callback({ success: false, error: "Connection Error" });
  };
  request.open("POST", CLOUD_FUNCTION_URL + "?name=" + key + "&fetch=" + sheetcols, true);
  request.responseType = "text";
  request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
  request.send(payload);
}


var grassland2021 = ee.ImageCollection(GEE_ASSET_PREFIX + 'Europe_misc/CLMS_HRLVLCC_GRAME_S2021_R10m');
var grame_proj = ee.Projection({
  "crs": "EPSG:3035",
  "transform": [
    10,
    0,
    2900000,
    0,
    -10,
    1800000
  ]
})

var planetScope = ee.ImageCollection(GEE_ASSET_PREFIX + "PlanetScope/Europe_2kmGridSample_ortho_analytic_8b_sr"),
    geometry = /* color: #98ff00 */ee.Feature(
        ee.Geometry.Point([9.301772968679005, 51.630294691295454]),
        {
          "PLOTID": "test_1",
          "system:index": "0"
        }),
    geometry2 = /* color: #0b4a8b */ee.Feature(
        ee.Geometry.Point([9.317952053456837, 51.62499322368817]),
        {
          "PLOTID": "test_2",
          "system:index": "0"
        });


/**** =========================================================================
Grassland mowing reference app
Rewritten as:
- Far-left user input panel
- Top dashboard = PlanetScope
- Bottom dashboard = Sentinel-2
Each dashboard has:
  (1) sample map thumbnail
  (2) NDVI graph raw
  (3) NDVI graph cloud-masked
  (4) RGB timelapse
- A filmstrip row below showing NDVI thumbnails around current timelapse index
- Clicking raw NDVI chart moves timelapse to nearest image date
- Moving timelapse slider updates filmstrip
============================================================================= ****/

// -----------------------------------------------------------------------------
// SETTINGS
// -----------------------------------------------------------------------------

var sessionID = ee.Date(Date.now()).millis().getInfo();

var INDEX = 0;

// Change this to control number of filmstrip images shown.
// 3 = current index +/- 3, so up to 7 thumbnails.
var FILMSTRIP_HALF_WINDOW = 3;

// -----------------------------------------------------------------------------
// INPUTS / ASSETS
// -----------------------------------------------------------------------------
// Assumes `planetScope` is already imported in the GEE script.
//

var samples = ee.FeatureCollection([geometry, geometry2]).toList(10000);
var samples = ee.FeatureCollection(GEE_ASSET_PREFIX + 'modcix_sample_pts_v2')
  .filter(ee.Filter.neq('stratum', 255));
print(ui.Chart.feature.histogram(samples, 'stratum'))

/*
samples = samples.randomColumn('rnd', 123).sort('rnd')
Export.table.toDrive({
  collection:samples,
  description:'samples',
  fileFormat:'CSV'
})
*/
//samples = samples.filter(ee.Filter.inList('PLOTID', ['a14-42357011838088_47-44001449453533']))
//samples = samples.toList(10000);

var ndviTs = ee.FeatureCollection(GEE_ASSET_PREFIX + 'modcix_planetscope_ndvi_ts_v2')
var ndviTs_s2 = ee.FeatureCollection(GEE_ASSET_PREFIX + 'modcix_s2_ndvi_ts_v2')

//print(ndviTs_s2.distinct(['PLOTID']).reduceColumns(ee.Reducer.toList(), ['PLOTID']))

//print(getPlanetNDVIChart('a12-72275960293152_51-8096495357348', ''))
//print(ndviTs.filter(ee.Filter.eq('PLOTID', 'a12-72275960293152_51-8096495357348')))

// -----------------------------------------------------------------------------
// PLANETSCOPE BAND SETUP
// -----------------------------------------------------------------------------
planetScope = planetScope.select(
  ['B6', 'B4', 'B2', 'B8', 'Q6', 'Q5', 'Q4'],
  ['red', 'green', 'blue', 'nir', 'Q6', 'Q5', 'Q4']
);

// -----------------------------------------------------------------------------
// TIME / VIS SETTINGS
// -----------------------------------------------------------------------------
var endviPalette =
  'FFFFFF, CE7E45, DF923D, F1B555, FCD163, 99B718, 74A901, 66A000, 529400, 3E8601, 207401, 056201, 004C00, 023B01, 012E01, 011D01, 011301';

var startYear = 2021;
var endYear = 2021;
var startMonth = 1;
var endMonth = 12;

var cloudFilterThresh_sent = 50;
var cloudFilterThresh_landsat = 50;

var QA_BAND = 'cs_cdf';
var CLEAR_THRESHOLD = 0.60;

// Sentinel-2 band names
var S2_BANDS = ['QA60', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12'];
var S2_NAMES = ['QA60', 'cb', 'blue', 'green', 'red', 'R1', 'R2', 'R3', 'nir', 'swir1', 'swir2'];

// Landsat band names
var Landsat_BANDS = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'];
var Landsat_NAMES = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'];

// -----------------------------------------------------------------------------
// STYLES
// -----------------------------------------------------------------------------
var titleStyle = {
  fontFamily: 'cormorantgaramond-light',
  fontSize: '22px',
  color: '#000000',
  backgroundColor: '#ffffff',
  margin: '2px'
};

var headingStyle = {
  fontFamily: 'cormorantgaramond-light',
  fontSize: '20px',
  color: '#000000',
  backgroundColor: '#ffffff',
  margin: '2px'
};

var subHeadingStyle = {
  fontFamily: 'monospace',
  fontSize: '12px',
  color: '#222222',
  backgroundColor: '#ffffff',
  margin: '2px',
  fontWeight: 'bold'
};

var textStyle = {
  fontFamily: 'monospace',
  fontSize: '11px',
  color: '#322220',
  backgroundColor: '#ffffff',
  padding: '2px',
  margin: '2px'
};

var textStyleBold = {
  fontFamily: 'monospace',
  fontSize: '11px',
  color: '#322220',
  backgroundColor: '#ffffff',
  fontWeight: 'bold',
  margin: '2px'
};

// Text and panel styles


var titleStyleDark = {fontFamily:'cormorantgaramond-light', fontSize:'22px',color:'#c1c0c0',  backgroundColor: '#00000000',  margin:'2px'};
var headingStyleDark = {fontFamily:'cormorantgaramond-light', fontSize:'18px', color:'#c1c0c0',backgroundColor: '#00000000',  margin:'2px'};
var textStyleDark = {fontFamily:'monospace', fontSize:'11px', color:'#c1c0c0',backgroundColor: '#00000000', padding:'2px', margin:'2px', textAlign: 'left'};
var textStyleEmphasis = {fontFamily:'monospace', fontSize:'13px',textDecoration: 'underline', color:'#322220',backgroundColor: '#ffffff'};
var textStyleWarning = {fontFamily:'monospace', fontSize:'12px', color:'#c87cff',backgroundColor: '#ffffff', fontWeight: 'bold',  padding:'2px', margin:'2px'};
var textWhite = {fontFamily:'monospace','background-color': '#00000000', color:'#ffffff', fontSize: '13px',padding:'2px', margin:'2px'}



// -----------------------------------------------------------------------------
// UI: INTRO PANEL
// -----------------------------------------------------------------------------

// Intro panel
var introPanel = ui.Panel({
  style: {
    position:'top-center', 
    maxHeight: '500px',
    maxWidth: '600px'
  }
});


// Title text
var textTitle = ui.Label('MODCiX reloaded collector', titleStyle)
var textSubTitle = ui.Label("Find out more ℹ️", textStyle, 'https://www.researchgate.net/publication/395625676_Mowing_Detection_Intercomparison_Exercise_MODCiX_-_A_Cross-European_Evaluation_of_Grassland_Mowing_Detection_Algorithms')
var titlePanel = ui.Panel({
  widgets: [textTitle, textSubTitle],
  layout: ui.Panel.Layout.Flow('horizontal')
})

// Tutorial text intro
var tutorialText = ui.Label('If this is your first time, please go through our onboarding tutorial here:',textStyle);
var tutorialURL = ui.Label('>> MODCiX reloaded collector tutorial', textStyle, 'https://docs.google.com/document/d/1IQ9NPT-vjKtDAchBEtMhOXB7BO5pqoLi3MalE3RMYkI/edit?usp=sharing')

// Name text
var nameBox = ui.Textbox({placeholder: 'enter your name...'})

// Start app button
var startButton = ui.Button('Start app', startApp, true);

introPanel
  .add(titlePanel)
  .add(tutorialText)
  .add(tutorialURL)
  .add(nameBox)
  .add(startButton);

ui.root.widgets().reset([introPanel]);

// -----------------------------------------------------------------------------
// UI: LEFT INPUT PANEL
// -----------------------------------------------------------------------------
var appPanel = ui.Panel({
  layout: ui.Panel.Layout.Flow('horizontal'),
  style: {stretch: 'both'}
});

var leftPanel = ui.Panel({
  style: {
    width: '300px',
    padding: '8px',
    stretch: 'vertical',
    backgroundColor: '#ffffff'
  }
});

var rightPanel = ui.Panel({
  layout: ui.Panel.Layout.Flow('vertical'),
  style: {
    stretch: 'both',
    padding: '4px',
    backgroundColor: '#ffffff'
  }
});

var infoHeader = ui.Label('Grassland mowing reference', titleStyle);
var sampleInfoPanel = ui.Panel();

// -- Grassland question
var questionPanel_grassland = ui.Panel();
var qgText = ui.Label('1. Is this a permanent or temporary (e.g. seeded grass or fodder crops) grassland in 2021?', textStyle);
var grassSelect = ui.Select(['Yes', 'No', 'Uncertain', ''], '', '');

var grasslandDefinition = "The definition encompasses natural, semi-natural and managed or cultivated grasslands (according " +
"to their origin and utilization) as well as all types of grassland (permanent or seasonal) under " +
"highly heterogeneous biogeographic conditions (wet or dry climate, fertile or poor soil). " +
"Herbaceous cover within the context of the product is understood as herbaceous vegetation " +
"with at least 30% ground cover and with at least 30% graminoid species such as Poaceae, " +
"Cyperaceae and Juncaceae. The rate of 30% ground cover density shall be understood as a " +
"benchmark implicating that grasslands with ≥30% ground cover can usually be distinguished " +
"clearly from bare ground on earth observation data with the resolution of 10 metres. " +
"NB!! Arable fields with graminoids like winter wheat, barley and rye are explicitly excluded."

//var grasslandDefLabelExtra = ui.Label('See this p.18 on this link', 'https://land.copernicus.eu/en/technical-library/product-user-manual-grasslands-2017-present/@@download/file')

var definitionText =  ui.Panel({
  widgets: [
    ui.Label(grasslandDefinition, textStyle),
    ui.Label('Search "Table 7-1" in the HRL Grasslands user manual', textStyle, 'https://land.copernicus.eu/en/technical-library/product-user-manual-grasslands-2017-present/@@download/file')],
  layout: ui.Panel.Layout.Flow('vertical'),
  style: {shown:false}
})

var definitionButton = ui.Button('Definition ▶️', toggleDefinitionButton, false, {margin:'2px 2px 2px 4px'});
var toggleDefinitionFlag = 1;
function toggleDefinitionButton(){
  if (toggleDefinitionFlag == 1){
    definitionButton.setLabel('Definition 🔽')
    definitionText.style().set('shown', true);
    toggleDefinitionFlag = 0;
  } else {
    definitionButton.setLabel('Definition ▶️')
    definitionText.style().set('shown', false);
    toggleDefinitionFlag = 1;
  }
}

questionPanel_grassland.widgets().reset([
  qgText,
  definitionButton,
  definitionText,
  grassSelect
]);

// -- Skip question
var questionPanel_skip = ui.Panel();
var qsText = ui.Label('2. Is the app functional with full NDVI time series to proceed with interpretation?', textStyle);
var skipSelect = ui.Select(['Yes', 'No - skipping to next', ''], '', '');
questionPanel_skip.widgets().reset([
  qsText,
  skipSelect
]);


// -- Question 1: mowing event dates
var questionPanel_1 = ui.Panel();

var q1Text = ui.Label('3. Enter the date of each mowing event you can see (up to 7):', textStyle);
var q1Hint = ui.Label('Format example: 2021-06-15', textStyle);

var mowingDateBoxes = [];
var mowingConfidenceSelects = [];

var mowingDatePanel = ui.Panel({
  layout: ui.Panel.Layout.Flow('vertical')
});

function getCurrentTimelapseDate() {
  // Prefer PlanetScope if available, otherwise Sentinel-2
  var label = null;

  if (planetDashboard && planetDashboard.label) {
    label = planetDashboard.label.getValue();
  } else if (sentinelDashboard && sentinelDashboard.label) {
    label = sentinelDashboard.label.getValue();
  }

  if (!label) return '';

  // Labels are already YYYY-MM-dd from makeDailyMosaics()
  return String(label).substring(0, 10);
}

var confidenceItems = [
  'very low',
  'low',
  'medium',
  'high',
  '-confidence-'
];
/*
for (var i = 0; i < 7; i++) {
  var box = ui.Textbox({
    placeholder: 'Mow event ' + (i + 1) + ' date',
    style: {width: '130px'}
  });

  var conf = ui.Select({
    items: confidenceItems,
    value: '-confidence-',
    style: {width: '100px'}
  });

  mowingDateBoxes.push(box);
  mowingConfidenceSelects.push(conf);

  var row = ui.Panel({
    widgets: [box, conf],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {margin: '2px 0px'}
  });

  mowingDatePanel.add(row);
}
*/
for (var i = 0; i < 7; i++) {
  var box = ui.Textbox({
    placeholder: 'Mow event ' + (i + 1) + ' date',
    style: {width: '105px'}
  });

  var conf = ui.Select({
    items: confidenceItems,
    value: '-confidence-',
    style: {width: '100px'}
  });

  var useDateButton = ui.Button({
    label: '📅',
    style: {
      width: '32px',
      margin: '5px 2px',
      padding: '1px'
    }
  });

  // Capture this row's textbox
  (function(targetBox) {
    useDateButton.onClick(function() {
      var date = getCurrentTimelapseDate();
      if (date) {
        targetBox.setValue(date);
      }
    });
  })(box);

  mowingDateBoxes.push(box);
  mowingConfidenceSelects.push(conf);

  var row = ui.Panel({
    widgets: [box, useDateButton, conf],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {margin: '2px 0px'}
  });

  mowingDatePanel.add(row);
}

questionPanel_1.widgets().reset([q1Text, q1Hint, mowingDatePanel]);

// Question 2
var questionPanel_2 = ui.Panel();
var q2Text = ui.Label('3. How confident are you (1 to 10)?', textStyle);
var confidenceSlider = ui.Slider({
  min: 0,
  max: 10,
  value: 5,
  step: 1
});
questionPanel_2.widgets().reset([
  q2Text,
  ui.Panel([confidenceSlider])
]);

// Question 3
var questionPanel_3 = ui.Panel();
var q3Text = ui.Label('4. Notes:', textStyle);
var notesTextbox = ui.Textbox();
questionPanel_3.widgets().reset([
  q3Text,
  notesTextbox
]);

// Buttons
var backButton = ui.Button('Go Back', goBack);
var submitButton = ui.Button('Submit', handleSubmitButton);
var buttonPanel = ui.Panel({
  widgets: [backButton, submitButton],
  layout: ui.Panel.Layout.Flow('horizontal')
});

// URL for google
var googleurlText = ui.Label('See in Google Earth')

leftPanel
  .add(infoHeader)
  .add(sampleInfoPanel)
  .add(questionPanel_grassland)
  .add(questionPanel_skip)
  .add(questionPanel_1)
  //.add(questionPanel_2)
  .add(questionPanel_3)
  .add(buttonPanel);

// -----------------------------------------------------------------------------
// UI: DASHBOARD FACTORY
// -----------------------------------------------------------------------------
function createSensorDashboard(titleText) {
  highlightDate: null
  filmstripRefreshId: 0
  var title = ui.Label(titleText, headingStyle);

  var thumbPanel = ui.Panel({
    style: {
      width: '20%',
      height: '350px',
      margin: '2px',
      border: '1px solid #cccccc',
      padding: '0px'
    }
  });
  
  var rawChartPanel = ui.Panel({
    style: {
      width: '45%',
      height: '350px',
      margin: '2px',
      border: '1px solid #cccccc',
      padding: '0px'
    }
  });
  
  var timelapsePanel = ui.Panel({
    style: {
      width: '35%',
      height: '350px',
      margin: '2px',
      border: '1px solid #cccccc',
      padding: '0px'
    }
  });

  var mainRow = ui.Panel({
    widgets: [thumbPanel, rawChartPanel, timelapsePanel],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {stretch: 'horizontal'}
  });

  var filmstripHeader = ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {stretch: 'horizontal'}
  });

  var filmstripTitle = ui.Label('NDVI filmstrip', subHeadingStyle);

  var filmstripButton = ui.Button({
    label: 'Update filmstrip',
    style: {margin: '2px 0px 2px 10px', padding: '4px'}
  });
  
  var stretchButton = ui.Button({
    label: 'Update stretch',
    style: {margin: '2px', padding: '4px'}
  });
  
  var resetStretchButton = ui.Button({
    label: 'Reset stretch',
    style: {margin: '2px', padding: '4px'}
  });

  filmstripHeader.add(filmstripTitle).add(filmstripButton).add(stretchButton).add(resetStretchButton);

  var filmstripPanel = ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {
      height: '210px',
      margin: '2px',
      border: '1px solid #cccccc',
      padding: '2px',
      stretch: 'horizontal'
    }
  });

  var panel = ui.Panel({
    widgets: [title, mainRow, filmstripHeader, filmstripPanel],
    layout: ui.Panel.Layout.Flow('vertical'),
    style: {
      stretch: 'horizontal',
      margin: '4px 0px 10px 0px',
      padding: '4px',
      border: '1px solid #dddddd'
    }
  });

  return {
    panel: panel,
    thumbPanel: thumbPanel,
    rawChartPanel: rawChartPanel,
    timelapsePanel: timelapsePanel,
    filmstripPanel: filmstripPanel,
    filmstripButton: filmstripButton,
    stretchButton: stretchButton,
    resetStretchButton: resetStretchButton,
    

    point: null,
    bounds: null,
    imageList: null,
    imageCount: 0,
    currentIndex: 0,
    slider: null,
    label: null,
    timelapseMap: null,
    rgbVis: null,
    ndviVis: null,
    activeNdviVis: null,
    layers: [],
    layerNames: [],
    labels: [],
    filmstripRefreshId: 0,
    highlightDate: null
  };
}
var planetDashboard = createSensorDashboard('PlanetScope');
var sentinelDashboard = createSensorDashboard('Sentinel-2');

var sentinelDashboardShown = false;

var showSentinelButton = ui.Button({
  label: 'Show Sentinel-2 dashboard',
  onClick: function() {
    if (!sentinelDashboardShown) {
      rightPanel.add(sentinelDashboard.panel);
      sentinelDashboardShown = true;
      showSentinelButton.setLabel('Hide Sentinel-2 dashboard');
    } else {
      rightPanel.remove(sentinelDashboard.panel);
      sentinelDashboardShown = false;
      showSentinelButton.setLabel('Show Sentinel-2 dashboard');
    }
  },
  style: {
    margin: '4px 0px 8px 0px',
    padding: '4px'
  }
});

rightPanel.add(planetDashboard.panel);
rightPanel.add(showSentinelButton);

appPanel.add(leftPanel).add(rightPanel);

// -----------------------------------------------------------------------------
// GLOBAL STATE
// -----------------------------------------------------------------------------
var selected;
var selectedID;
var selectedName;

// -----------------------------------------------------------------------------
// NAVIGATION
// -----------------------------------------------------------------------------
function handleNext() {
  sampleInfoPanel.clear();
  print(INDEX)
  print(plotidList)
  selected = ee.Feature(samples.filter(ee.Filter.eq('PLOTID', plotidList[INDEX])).first());
  print(selected)
  selected.toDictionary().evaluate(function(dict) {
    print(dict)
    selectedID = dict['PLOTID'];

    sampleInfoPanel.add(
      ui.Label(
        'Index: ' + String(INDEX) + '   |   PLOTID: ' + String(selectedID),
        textStyleBold
      )
    );

    selected.geometry().coordinates().evaluate(function(coords) {
      showReferenceImages(coords, startYear, endYear);
      INDEX = INDEX + 1;
      var googleURL = 'https://earth.google.com/web/@'+String(coords[1]) +','+String(coords[0]) +',842.36345538a,627.3130837d,35y,0h,0t,0r'

      googleurlText.setUrl(googleURL)
      sampleInfoPanel.add(googleurlText)
      
      
    });
  });
}

function goBack() {
  INDEX = Math.max(0, INDEX - 2);
  handleNext();
}

function handleSubmitButton() {
  var mowingDates = mowingDateBoxes.map(function(box) {
    return box.getValue();
  });

  var mowingConfidences = mowingConfidenceSelects.map(function(sel) {
    return sel.getValue();
  });

  var data = [[
    selectedName,
    sessionID,
    selectedID,
    INDEX,
    grassSelect.getValue(),
    skipSelect.getValue(),

    mowingDates[0],
    mowingConfidences[0],
    mowingDates[1],
    mowingConfidences[1],
    mowingDates[2],
    mowingConfidences[2],
    mowingDates[3],
    mowingConfidences[3],
    mowingDates[4],
    mowingConfidences[4],
    mowingDates[5],
    mowingConfidences[5],
    mowingDates[6],
    mowingConfidences[6],

    confidenceSlider.getValue(),
    notesTextbox.getValue()
  ]];

  print(data);

  if (MODE != 'dev') {
    storeData(GOOGLESHEET, data, function(res) { return; });
  }

  mowingDateBoxes.forEach(function(box) {
    box.setValue('');
  });

  mowingConfidenceSelects.forEach(function(sel) {
    sel.setValue('-confidence-');
  });
  
  grassSelect.setValue('');
  skipSelect.setValue('');
  confidenceSlider.setValue(5);
  notesTextbox.setValue('');
  handleNext();
}

// -----------------------------------------------------------------------------
// REMOTE SENSING FUNCTIONS
// -----------------------------------------------------------------------------
function add_NDVI(image) {
  return image.addBands(
    image.normalizedDifference(['nir', 'red']).rename('ndvi')
  );
}

function maskPlanetScope(img) {
  var cloudMask = img.select('Q6').eq(0);
  var hazeMask = img.select('Q5').eq(0);
  var hazeMask2 = img.select('Q4').eq(0);
  return img.updateMask(cloudMask)
            .updateMask(hazeMask)
            .updateMask(hazeMask2);
}

function getS2(aoi, startYear, endYear, startMonth, endMonth, filterClouds, maskClouds) {
  var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

  var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterBounds(aoi)
    .filter(ee.Filter.calendarRange(startYear, endYear, 'year'))
    .filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'));

  if (filterClouds) {
    s2 = s2.filterMetadata('CLOUDY_PIXEL_PERCENTAGE', 'less_than', cloudFilterThresh_sent);
  }

  if (maskClouds) {
    s2 = s2.linkCollection(csPlus, [QA_BAND])
      .map(function(img) {
        return img.updateMask(img.select(QA_BAND).gte(CLEAR_THRESHOLD));
      });
  }

  s2 = s2.select(S2_BANDS, S2_NAMES)
    .select(['red', 'green', 'blue', 'nir'])
    .map(add_NDVI);

  return s2;
}

function rescaleLandsat(image) {
  var getFactorImg = function(factorNames) {
    var factorList = image.toDictionary().select(factorNames).values();
    return ee.Image.constant(factorList);
  };

  var scaleImg = getFactorImg([
    'REFLECTANCE_MULT_BAND_.|TEMPERATURE_MULT_BAND_ST_B10'
  ]);

  var offsetImg = getFactorImg([
    'REFLECTANCE_ADD_BAND_.|TEMPERATURE_ADD_BAND_ST_B10'
  ]);

  var scaled = image.select('SR_B.|ST_B10').multiply(scaleImg).add(offsetImg);

  return image.addBands(scaled, null, true);
}

function maskLandsatClouds(image) {
  var qaMask = image.select('QA_PIXEL').bitwiseAnd(parseInt('11111', 2)).eq(0);
  var saturationMask = image.select('QA_RADSAT').eq(0);
  return image.updateMask(qaMask).updateMask(saturationMask);
}

function getLandsat(aoi, startYear, endYear, startMonth, endMonth, filterClouds, maskClouds) {
  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(aoi)
    .filter(ee.Filter.calendarRange(parseInt(startYear), parseInt(endYear), 'year'))
    .filter(ee.Filter.calendarRange(parseInt(startMonth), parseInt(endMonth), 'month'));

  var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
    .filterBounds(aoi)
    .filter(ee.Filter.calendarRange(parseInt(startYear), parseInt(endYear), 'year'))
    .filter(ee.Filter.calendarRange(parseInt(startMonth), parseInt(endMonth), 'month'));

  var srCollection = l8.merge(l9).map(rescaleLandsat);

  if (filterClouds) {
    srCollection = srCollection.filterMetadata('CLOUD_COVER', 'less_than', cloudFilterThresh_landsat);
  }

  if (maskClouds) {
    srCollection = srCollection.map(maskLandsatClouds);
  }

  srCollection = srCollection
    .select(Landsat_BANDS, Landsat_NAMES)
    .select(['red', 'green', 'blue', 'nir'])
    .map(add_NDVI);

  return srCollection;
}

// -----------------------------------------------------------------------------
// COLLECTION BUILDERS
// -----------------------------------------------------------------------------

/*
function makeDailyMosaics(ic) {
  ic = ic
    .sort('system:time_start')
    .map(function(img) {
      var day = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd');
      return img.set('day', day);
    });

  var days = ee.List(ic.aggregate_array('day')).distinct();

  var daily = ee.ImageCollection(days.map(function(day) {
    day = ee.String(day);
    var dayCol = ic.filter(ee.Filter.eq('day', day)).sort('system:time_start');

    var mosaic = dayCol.mosaic();

    // keep a clean daily timestamp at midnight UTC for charting / labels
    var dayDate = ee.Date.parse('YYYY-MM-dd', day);

    return mosaic
      .set('day', day)
      .set('label', day)
      .set('system:time_start', dayDate.millis());
  }));

  return daily.sort('system:time_start');
}
*/
function makeDailyMosaics(ic) {
  // 1. Add a formatted date string to every image
  ic = ic.map(function(img) {
    var day = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd');
    
    // We set 'label' here too so the UI code doesn't break
    return img.set('day', day)
              .set('label', day); 
  });

  // 2. Sort by time so the earliest image of the day is first in line
  ic = ic.sort('system:time_start');

  // 3. Magic function: Keeps only the FIRST image for each unique 'day'
  var daily = ee.ImageCollection(ic.distinct('day'));

  return daily;
}

function getPlanetRaw(center) {
  var col = planetScope
    .filterBounds(center)
    .map(add_NDVI);
    
  return makeDailyMosaics(col);
}

function getPlanetMasked(center) {
  var col = planetScope
    .filterBounds(center)
    .map(maskPlanetScope)
    .map(add_NDVI);

  return makeDailyMosaics(col);
}

function getSentinelRaw(center) {
  var col = getS2(center, startYear, endYear, startMonth, endMonth, true, false);
  return makeDailyMosaics(col);
}

function getSentinelMasked(center) {
  var col = getS2(center, startYear, endYear, startMonth, endMonth, true, true);
  return makeDailyMosaics(col);
}
// -----------------------------------------------------------------------------
// UI HELPERS
// -----------------------------------------------------------------------------
function clearDashboard(dashboard) {
  dashboard.filmstripRefreshId = 0;
  dashboard.thumbPanel.clear();
  dashboard.rawChartPanel.clear();
  dashboard.timelapsePanel.clear();
  dashboard.filmstripPanel.clear();

  dashboard.point = null;
  dashboard.bounds = null;
  dashboard.imageList = null;
  dashboard.imageCount = 0;
  dashboard.currentIndex = 0;
  dashboard.slider = null;
  dashboard.label = null;
  dashboard.timelapseMap = null;
  dashboard.rgbVis = null;
  dashboard.ndviVis = null;
  dashboard.activeNdviVis = null;
  dashboard.layers = [];
  dashboard.layerNames = [];
  dashboard.labels = [];
  dashboard.highlightDate = null;
  
  dashboard.cachedTimeList = null; 
}


function getIntersectingPixelBounds(pt) {
  var point = ee.Geometry.Point(pt);
  
  var rndImg = ee.Image.random(123).multiply(1000).round().int().reproject(grame_proj)

  var pixel = rndImg.addBands(rndImg).reduceToVectors(ee.Reducer.first(), point);
  
  return pixel.style({fillColor:"#00000000", color:"red"});
}

function buildThumbnailMap(pt, dashboard) {
  dashboard.thumbPanel.clear();

  var point = ee.Geometry.Point(pt);
  var pixelBounds = getIntersectingPixelBounds(pt)
  var scale = 20;
  var bounds = point.buffer(scale * 120).bounds(scale);

  var thumbMap = ui.Map();
  thumbMap.setOptions('SATELLITE');
  thumbMap.setControlVisibility({
    all: false,
    zoomControl: false,
    layerList: false,
    mapTypeControl: false,
    fullscreenControl: false
  });
  thumbMap.centerObject(bounds, 17);
  thumbMap.layers().reset([
    ui.Map.Layer(pixelBounds, {}, 'sample pixel')
  ]);

  dashboard.thumbPanel.add(thumbMap);
}

function getPlanetNDVIChart(id, title, dashboardPS, highlightDate) {
  var tsSelect = ndviTs.filter(ee.Filter.eq('PLOTID', id))
  
  var dummyFeature = ee.Feature(null, {
    'system:time_start': ee.Date('2021-01-01').millis(),
    'ndvi_raw': 0.0,
    'ndvi_masked': 0.0,
    'PLOTID': 'id'
  });
  
  var dummyCollection = ee.FeatureCollection([dummyFeature]);
  
  tsSelect = dummyCollection.merge(tsSelect);
  
  tsSelect = tsSelect.sort('system:time_start');

  if (highlightDate) {
    tsSelect = tsSelect.map(function(f) {
      var dateString = ee.Date(f.get('system:time_start')).format('YYYY-MM-dd');
  
      var highlightValue = ee.Number(
        ee.Algorithms.If(
          ee.String(dateString).equals(ee.String(highlightDate)),
          f.get('ndvi_raw'),
          -9999
        )
      );
  
      return f.set('highlight_ndvi', highlightValue);
    });
  } else {
    tsSelect = tsSelect.map(function(f) {
      return f.set('highlight_ndvi', -9999);
    });
  }
  var chartPS = ui.Chart.feature.byFeature(
    tsSelect,
    'system:time_start',
    ['ndvi_raw', 'ndvi_masked', 'highlight_ndvi']
  )
  .setChartType('LineChart')
  .setOptions({
    height: 285,
    title: title,
    interpolateNulls: true,
    vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 1}},
    hAxis: {title: '', slantedText: true, slantedTextAngle: 45},
    lineWidth: 2,
    pointSize: 3,
    series: {
      0: {color: 'green'},
      1: {color: 'blue'},
      2: {
        color: 'red',
        lineWidth: 0,
        pointSize: 8,
        visibleInLegend: false
      }
    }
  });
  chartPS.onClick(function(xVal) {
    if (xVal === null || dashboardPS.imageList === null) return;
    
    var clickedTime = new Date(xVal).getTime();

    // Helper function to do the math and move the slider instantly
    var moveSlider = function(timeList) {
      if (!timeList || timeList.length === 0) return;
      var bestIdx = 0;
      var bestDiff = Math.abs(timeList[0] - clickedTime);
      for (var i = 1; i < timeList.length; i++) {
        var diff = Math.abs(timeList[i] - clickedTime);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (dashboardPS.slider) {
        dashboardPS.slider.setValue(bestIdx, true);
      }
    };

    // CHECK: Have we already downloaded the time list for this plot?
    if (dashboardPS.cachedTimeList) {
      // YES! Move the slider instantly (0 server requests)
      moveSlider(dashboardPS.cachedTimeList);
    } else {
      // NO. Fetch it from the server, save it, and then move the slider.
      // (This slight delay will only ever happen on the FIRST click)
      var timeListCol = ee.ImageCollection(dashboardPS.imageList)
        .reduceColumns(ee.Reducer.toList(), ['system:time_start'])
        .get('list');
        
      timeListCol.evaluate(function(timeList) {
        dashboardPS.cachedTimeList = timeList; // <-- Save it to memory!
        moveSlider(timeList);
      });
    }
  });
  return chartPS;
}

function rebuildNdviChartWithHighlight(dashboard) {
  if (!selectedID) return;

  dashboard.rawChartPanel.clear();

  if (dashboard === planetDashboard) {
    var chart = getPlanetNDVIChart(
      selectedID,
      'PlanetScope NDVI (raw vs cloud-masked)',
      dashboard,
      dashboard.highlightDate
    );
    dashboard.rawChartPanel.add(chart);
  }

  if (dashboard === sentinelDashboard) {
    var chart = getSentinelNDVIChart(
      selectedID,
      'Sentinel-2 NDVI (raw vs cloud-masked)',
      dashboard,
      dashboard.highlightDate
    );
    dashboard.rawChartPanel.add(chart);
  }
}

function getSentinelNDVIChart(id, title, dashboard, highlightDate) {
  var tsSelect = ndviTs_s2.filter(ee.Filter.eq('PLOTID', id))
  
  var dummyFeature = ee.Feature(null, {
    'system:time_start': ee.Date('2021-01-01').millis(),
    'ndvi_raw': 0.0,
    'ndvi_masked': 0.0,
    'PLOTID': 'id'
  });
  
  var dummyCollection = ee.FeatureCollection([dummyFeature]);
  
  tsSelect = dummyCollection.merge(tsSelect);
  
  tsSelect = tsSelect.sort('system:time_start')
  
  if (highlightDate) {
    tsSelect = tsSelect.map(function(f) {
      var dateString = ee.Date(f.get('system:time_start')).format('YYYY-MM-dd');
  
      var highlightValue = ee.Number(
        ee.Algorithms.If(
          ee.String(dateString).equals(ee.String(highlightDate)),
          f.get('ndvi_raw'),
          -9999
        )
      );
  
      return f.set('highlight_ndvi', highlightValue);
    });
  } else {
    tsSelect = tsSelect.map(function(f) {
      return f.set('highlight_ndvi', -9999);
    });
  }
  
  var chart = ui.Chart.feature.byFeature(
    tsSelect,
    'system:time_start',
    ['ndvi_raw', 'ndvi_masked', 'highlight_ndvi']
  )
  .setChartType('LineChart')
  .setOptions({
    height: 285,
    title: title,
    interpolateNulls: true,
    vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 1}},
    hAxis: {title: '', slantedText: true, slantedTextAngle: 45},
    lineWidth: 2,
    pointSize: 3,
    series: {
      0: {color: 'green'},
      1: {color: 'blue'},
      2: {
        color: 'red',
        lineWidth: 0,
        pointSize: 8,
        visibleInLegend: false
      }
    }
  });
  chart.onClick(function(xVal) {
    if (xVal === null || dashboard.imageList === null) return;
    
    var clickedTime = new Date(xVal).getTime();

    var moveSlider = function(timeList) {
      if (!timeList || timeList.length === 0) return;
      var bestIdx = 0;
      var bestDiff = Math.abs(timeList[0] - clickedTime);
      for (var i = 1; i < timeList.length; i++) {
        var diff = Math.abs(timeList[i] - clickedTime);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (dashboard.slider) {
        dashboard.slider.setValue(bestIdx, true);
      }
    };

    if (dashboard.cachedTimeList) {
      moveSlider(dashboard.cachedTimeList);
    } else {
      var timeListCol = ee.ImageCollection(dashboard.imageList)
        .reduceColumns(ee.Reducer.toList(), ['system:time_start'])
        .get('list');
        
      timeListCol.evaluate(function(timeList) {
        dashboard.cachedTimeList = timeList;
        moveSlider(timeList);
      });
    }
  });
  return chart;
}
function setTimelapseFrame(dashboard, idx) {
  idx = Math.round(Number(idx));
  idx = Math.max(0, Math.min(dashboard.imageCount - 1, idx));
  dashboard.currentIndex = idx;

  if (!dashboard.layers || dashboard.layers.length === 0) return;

  for (var i = 0; i < dashboard.layers.length; i++) {
    dashboard.layers[i].setOpacity(i === idx ? 1 : 0);
  }

  if (dashboard.label && dashboard.layerNames[idx]) {
    dashboard.label.setValue(dashboard.layerNames[idx]);
  }
}

function getFilmstripNdviVis(dashboard) {
  return dashboard.activeNdviVis || dashboard.ndviVis;
}

function makeFilmstripThumb(image, dashboard, frameIndex, region, refreshId) {
  if (dashboard.filmstripRefreshId !== refreshId) return;

  var ndviVis = getFilmstripNdviVis(dashboard);

  var clipped = ee.Image(image)
    .select('ndvi')
    .clip(region)
    .visualize(ndviVis);

  var lbl = dashboard.labels[frameIndex] || ('frame ' + frameIndex);

  var thumb = ui.Thumbnail({
    image: clipped,
    params: {
      region: region,
      dimensions: 140,
      format: 'png'
    },
    style: {
      width: '192px',
      height: '172px',
      margin: '1px',
      border: frameIndex === dashboard.currentIndex ? '3px solid red' : '1px solid #999999'
    }
  });

  var goButton = ui.Button({
    label: lbl,
    onClick: function() {
      if (dashboard.slider) {
        dashboard.slider.setValue(frameIndex, true);
      }
    },
    style: {
      fontSize: '9px',
      margin: '0px',
      padding: '1px'
    }
  });

  var panel = ui.Panel({
    widgets: [thumb, goButton],
    layout: ui.Panel.Layout.Flow('vertical'),
    style: {
      margin: '1px',
      padding: '0px'
    }
  });

  dashboard.filmstripPanel.add(panel);
}

function updateFilmstrip(dashboard) {
  dashboard.filmstripPanel.clear();
  if (!dashboard.imageList || dashboard.imageCount === 0 || !dashboard.timelapseMap) return;

  dashboard.filmstripRefreshId += 1;
  var refreshId = dashboard.filmstripRefreshId;

  var mapBounds = dashboard.timelapseMap.getBounds();
  var region = ee.Geometry.Rectangle(mapBounds, null, false);

  var start = Math.max(0, dashboard.currentIndex - FILMSTRIP_HALF_WINDOW);
  var end = Math.min(dashboard.imageCount - 1, dashboard.currentIndex + FILMSTRIP_HALF_WINDOW);

  for (var i = start; i <= end; i++) {
    makeFilmstripThumb(
      ee.Image(dashboard.imageList.get(i)),
      dashboard,
      i,
      region,
      refreshId
    );
  }
}

function updateFilmstripStretch(dashboard) {
  if (!dashboard.imageList || dashboard.imageCount === 0 || !dashboard.timelapseMap) return;

  var mapBounds = dashboard.timelapseMap.getBounds();
  var region = ee.Geometry.Rectangle(mapBounds, null, false);

  var centerImg = ee.Image(dashboard.imageList.get(dashboard.currentIndex)).select('ndvi');

  var percentiles = centerImg.reduceRegion({
    reducer: ee.Reducer.percentile([5, 95]),
    geometry: region,
    scale: 10,
    bestEffort: true,
    maxPixels: 1e6
  });

  percentiles.evaluate(function(p) {
    if (!p || p.ndvi_p5 === null || p.ndvi_p95 === null) {
      dashboard.activeNdviVis = dashboard.ndviVis;
      updateFilmstrip(dashboard);
      return;
    }

    var minVal = Number(p.ndvi_p5);
    var maxVal = Number(p.ndvi_p95);

    // Safety fallback if percentile range is invalid or too narrow
    if (!isFinite(minVal) || !isFinite(maxVal) || maxVal <= minVal) {
      dashboard.activeNdviVis = dashboard.ndviVis;
    } else {
      dashboard.activeNdviVis = {
        min: minVal,
        max: maxVal,
        bands: ['ndvi'],
        palette: dashboard.ndviVis.palette
      };
    }

    updateFilmstrip(dashboard);
  });
}

function resetFilmstripStretch(dashboard) {
  dashboard.activeNdviVis = null;
  updateFilmstrip(dashboard);
}

function buildTimelapse(images, dashboard, rgbVis, ndviVis, pt) {
  dashboard.timelapsePanel.clear();

  var point = ee.Geometry.Point(pt);
  var scale = 20;
  var bounds = point.buffer(scale * 120).bounds(scale);

  dashboard.point = point;
  dashboard.bounds = bounds;
  dashboard.rgbVis = rgbVis;
  dashboard.ndviVis = ndviVis;
  

  var timelapseMap = ui.Map();
  timelapseMap.setOptions('SATELLITE');
  timelapseMap.setControlVisibility({
    all: false,
    zoomControl: false,
    layerList: false,
    mapTypeControl: false,
    fullscreenControl: false
  });
  timelapseMap.centerObject(bounds, 17);

  dashboard.timelapseMap = timelapseMap;
  dashboard.timelapsePanel.add(timelapseMap);

  var imageCollection = ee.ImageCollection(images).sort('system:time_start');
  var imageList = imageCollection.toList(500);

  dashboard.imageList = imageList;
  
  ee.List(imageList.map(function(img) {
    return ee.String(ee.Image(img).get('label'));
  })).evaluate(function(labelList) {
    dashboard.labels = labelList || [];
  });

  imageList.size().evaluate(function(n) {
    dashboard.imageCount = n;
    dashboard.currentIndex = 0;
    dashboard.layers = [];
    dashboard.layerNames = [];

    if (!n || n < 1) {
      timelapseMap.add(ui.Label('No images found', {
        position: 'bottom-center',
        backgroundColor: 'ffffffcc',
        padding: '4px'
      }));
      return;
    }

    var slider = ui.Slider({
      min: 0,
      max: n - 1,
      value: 0,
      step: 1,
      style: {stretch: 'horizontal', margin: '0px'}
    });

    var label = ui.Label('Loading...', {
      fontSize: '12px',
      margin: '0px',
      padding: '0px'
    });

    var prevBtn = ui.Button({
      label: '◀',
      onClick: function() {
        var v = Number(slider.getValue());
        slider.setValue(Math.max(0, Math.round(v) - 1), true);
      },
      style: {margin: '0px', padding: '0px'}
    });

    var nextBtn = ui.Button({
      label: '▶',
      onClick: function() {
        var v = Number(slider.getValue());
        slider.setValue(Math.min(n - 1, Math.round(v) + 1), true);
      },
      style: {margin: '0px', padding: '0px'}
    });
    
    var highlightChartBtn = ui.Button({
      label: 'Highlight date on chart',
      onClick: function() {
        var currentDate = '';
    
        if (dashboard.label) {
          currentDate = String(dashboard.label.getValue()).substring(0, 10);
        }
    
        if (!currentDate) return;
    
        dashboard.highlightDate = currentDate;
        rebuildNdviChartWithHighlight(dashboard);
      },
      style: {
        margin: '0px',
        padding: '2px',
        fontSize: '10px'
      }
    });

    var controls = ui.Panel({
      widgets: [
        ui.Panel([prevBtn, nextBtn, highlightChartBtn], ui.Panel.Layout.Flow('horizontal')),
        ui.Panel([slider, label], ui.Panel.Layout.Flow('horizontal'))
      ],
      layout: ui.Panel.Layout.Flow('vertical'),
      style: {
        position: 'bottom-center',
        width: '95%',
        padding: '4px',
        backgroundColor: 'ffffffcc'
      }
    });

    timelapseMap.add(controls);

    dashboard.slider = slider;
    dashboard.label = label;

    ee.List.sequence(0, n - 1).evaluate(function(indices) {
      indices.forEach(function(i) {
        var img = ee.Image(imageList.get(i));
        var layer = ui.Map.Layer(img, rgbVis, 'frame_' + i, true);
        layer.setOpacity(i === 0 ? 1 : 0);
        timelapseMap.layers().add(layer);
        dashboard.layers.push(layer);

        ee.String(img.get('label')).evaluate(function(lbl) {
          dashboard.layerNames[i] = lbl;
          if (i === 0 && dashboard.label) {
            dashboard.label.setValue(lbl);
          }
        });
      });

      timelapseMap.layers().add(ui.Map.Layer(point, {color: 'red'}, 'sample point'));

      slider.onChange(function(v) {
        setTimelapseFrame(dashboard, v);
      });
    });

    dashboard.filmstripButton.onClick(function() {
      updateFilmstrip(dashboard);
    });
    dashboard.stretchButton.onClick(function() {
      updateFilmstripStretch(dashboard);
    });
    
    dashboard.resetStretchButton.onClick(function() {
      resetFilmstripStretch(dashboard);
    });
    
    
    
  });
}
// -----------------------------------------------------------------------------
// MAIN SHOW FUNCTION
// -----------------------------------------------------------------------------
function showReferenceImages(pt, startYear, endYear) {
  clearDashboard(planetDashboard);
  clearDashboard(sentinelDashboard);
  var center = ee.Geometry.Point(pt);

  var planetRaw = getPlanetRaw(center)//.limit(10);
  //var planetMasked = planetRaw.map(maskPlanetScope) // getPlanetMasked(center).limit(10);

  var sentRaw = getSentinelRaw(center)//.limit(10);
  var sentMasked = getSentinelMasked(center)//.limit(10);

  // PlanetScope row
  buildThumbnailMap(pt, planetDashboard);
  
  var planetCombinedChart = getPlanetNDVIChart(
    selectedID,
    'PlanetScope NDVI (raw vs cloud-masked)',
    planetDashboard,
    null
  );
  planetDashboard.rawChartPanel.add(planetCombinedChart);

  // RGB timelapse + NDVI filmstrip
  buildTimelapse(
    planetRaw.select(['red', 'green', 'blue', 'ndvi']),
    planetDashboard,
    {min: 0, max: 2000, bands: ['red', 'green', 'blue']},
    {min: 0, max: 1, bands: ['ndvi'], palette: endviPalette},
    pt
  );
  ui.util.setTimeout(function() {
    updateFilmstrip(planetDashboard);
    updateFilmstrip(sentinelDashboard);
  }, 1500);

  // Sentinel row
  buildThumbnailMap(pt, sentinelDashboard);

  var sentCombinedChart = getSentinelNDVIChart(
    selectedID,
    'Sentinel-2 NDVI (raw vs cloud-masked)',
    sentinelDashboard,
    null
  );
  sentinelDashboard.rawChartPanel.add(sentCombinedChart);

  buildTimelapse(
    sentRaw.select(['red', 'green', 'blue', 'ndvi']),
    sentinelDashboard,
    {min: 0, max: 2000, bands: ['red', 'green', 'blue']},
    {min: 0, max: 1, bands: ['ndvi'], palette: endviPalette},
    pt
  );
}

// -----------------------------------------------------------------------------
// DATA EXPORT
// -----------------------------------------------------------------------------
function storeData(key, data, callback) {
  var payload = JSON.stringify(data);

  var request = new XMLHttpRequest();
  request.onload = function() {
    callback(JSON.parse(request.responseText));
  };
  request.timeout = 20000;
  request.ontimeout = request.onerror = function() {
    callback({success: false, error: 'Connection Error'});
  };
  request.open(
    'POST',
    CLOUD_FUNCTION_URL + '?name=' + key,
    true
  );
  request.responseType = 'text';
  request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
  request.send(payload);
}




function handleData_leaderboard(payload) {
  if (payload.success){
    // Step 1: drop the header row
    var rows = payload.data.slice(1);
    
    // Step 2: build a panel
    var panel = ui.Panel({
      layout: ui.Panel.Layout.flow('vertical'),
      style: {backgroundColor: '#00000000', maxHeight: '150px'}
    });
    
    // Step 3: iterate rows and add labels
    rows.forEach(function(row) {
      var labelText = row[4]; // the prebuilt label, e.g. "🥇 luke [24]"
      var label = ui.Label(labelText, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#000000',
        backgroundColor: '#00000000',
        padding: '0px',
        margin: '0px',
        textAlign: 'left'
      });
      panel.add(label);
    });
    
    introPanel.add(ui.Label('Contributions from the team:', textStyle))
    introPanel.add(panel)
  }  else {
    introPanel.add(ui.Label('failed to collect data - please report error to ' + CONTACT_EMAIL))
  }
  
}

var plotidList;

// Helper function to shuffle an array (Fisher-Yates Shuffle)
function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
function handleData_todo(payload){
  if (payload.success){
    // 1. Process the raw data (exclude header)
    var allIds = payload.data.slice(1).map(function(row) {
      return row[0];
    });

    // 2. Randomize the entire list
    var shuffledIds = shuffle(allIds);
    print(shuffledIds, 'shuffledIds')

    // 3. Slice the top 50 for this specific user session
    plotidList = shuffledIds.slice(0, 50);
    
    print(plotidList, 'User-specific randomized plotidList (n=50)');
    
    startButton.setDisabled(false);
    
  } else {
    introPanel.add(ui.Label('Failed to collect data. Contact: ' + CONTACT_EMAIL));
  }
}

// Update your fetch range to grab a larger pool (A1:A301)
if (MODE != 'dev'){
  fetchData(GOOGLESHEET, "leaderboard!A1:E100", null, handleData_leaderboard);
  fetchData(GOOGLESHEET, "to_fetch!A1:A500", null, handleData_todo); // Increased range
} else {
  handleData_leaderboard({success: true, data: dummyData2});
  handleData_todo({success: true, data: dummyData});
}


var selected;
function startApp(){
  
  
  selectedName = nameBox.getValue();
  
  ui.root.widgets().reset([appPanel]);
  
  handleNext()
}


