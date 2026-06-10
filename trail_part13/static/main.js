let map;
let wmsLayer;
let feederLayer;
let feederLayerAdded = false;
let vectorLayer;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize the map
  map = L.map('map').setView([15.1, 73.95], 10); // Goa center

  // 2. Base map
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);


// 3. Add WMS Layer (initially hidden)
wmsLayer = L.tileLayer.wms('http://localhost:8080/geoserver/Shape_files_Goa/wms', {
  layers: 'Shape_files_Goa:Transmission_Feeder_merge',
  format: 'image/png',
  transparent: true,
  version: '1.1.0',
  attribution: 'GeoServer WMS Layer',
  zIndex: 9
}).addTo(map);
wmsLayer.setOpacity(0); // Hidden initially

// ✅ Point Layer (also initially hidden)
const pointLayer = L.tileLayer.wms('http://localhost:8080/geoserver/Shape_files_Goa/wms', {
  layers: 'Shape_files_Goa:Goa_Substation',
  format: 'image/png',
  transparent: true,
  version: '1.1.0',
  attribution: 'Raster from GeoServer',
  zIndex: 10
}).addTo(map);
pointLayer.setOpacity(0); // Hidden initially

// 4. ✅ Toggle both layers together
const toggleBtn = document.getElementById('toggleWMS');
toggleBtn.addEventListener('click', () => {
  const isVisible = wmsLayer.options.opacity !== 0;
  const newOpacity = isVisible ? 0 : 1;

  wmsLayer.setOpacity(newOpacity);
  pointLayer.setOpacity(newOpacity);

  toggleBtn.textContent = isVisible ? 'Show WMS Layer' : 'Hide WMS Layer';
});








  // 5. Show Vector Layer (Feeder Line)
  const showFeederBtn = document.getElementById('show-feeder-btn');
  showFeederBtn.addEventListener('click', () => {
    if (!vectorLayer) {
      vectorLayer = L.tileLayer.wms('http://localhost:8080/geoserver/GOA_Work/wms', {
        layers: 'GOA_Work:goa_feeder_line',
        format: 'image/png',
        transparent: true,
        version: '1.1.0',
        attribution: 'Feeder Line Layer',
        zIndex: 10 // 🧠 Ensure vector layer is on top
      }).addTo(map);
      showFeederBtn.textContent = '✅ Feeder Line Shown';
    }
  });
});


// Upload GeoTIFF and add as raster layer with lower zIndex
function uploadSingleLayer(layerName) {
  const fileInput = document.getElementById(`${layerName}_file`);
  if (!fileInput || !fileInput.files.length) {
    alert(`Please select a file for ${layerName}`);
    return;
  }

  const formData = new FormData();
  formData.append(layerName, fileInput.files[0]);

  fetch('/upload_single', {
    method: 'POST',
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    alert(data.message);
    if (data.layerName) {
      L.tileLayer.wms("http://localhost:8080/geoserver/GOA_Work/wms", {
        layers: `GOA_Work:${data.layerName}`,
        format: 'image/png',
        transparent: true,
        zIndex: 5 // 🧠 Raster GeoTIFF layers below vector
      }).addTo(map);
    }
  })
  .catch(err => {
    console.error("Upload error:", err);
    alert("❌ Upload failed.");
  });
}

// AHP Calculation Layer Display (Weighted Overlay)
function calculateAHP() {
  fetch('/calculate_ahp', {
    method: 'POST'
  })
  .then(response => response.json())
  .then(data => {
    alert(data.message || data.error);
    if (data.message) {
      L.tileLayer.wms("http://localhost:8080/geoserver/GOA_Work/wms", {
        layers: 'GOA_Work:weighted_overlay_output',
        format: 'image/png',
        transparent: true,
        zIndex: 6 // 🧠 Slightly higher than uploaded rasters
      }).addTo(map);
    }
  })
  .catch(error => {
    console.error('❌ AHP Calculation Error:', error);
    alert("Something went wrong while calculating AHP.");
  });
}
