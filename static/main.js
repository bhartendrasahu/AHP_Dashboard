let map;
let wmsLayer;
let feederLayer;
let feederLayerAdded = false;
let vectorLayer;
let ahpLayer;        // Store reference to AHP layer
let ahpLegend;       // Store reference to legend control

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
        zIndex: 10
      }).addTo(map);
      showFeederBtn.textContent = '✅ Feeder Line Shown';
    }
  });
});

// Upload GeoTIFF and add as raster layer
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
        zIndex: 5
      }).addTo(map);
    }
  })
  .catch(err => {
    console.error("Upload error:", err);
    alert("❌ Upload failed.");
  });
}

// ✅ AHP Calculation Layer with Legend + Popup
// AHP Calculation Layer with Legend + Interactive Click Info
function calculateAHP() {
  fetch('/calculate_ahp', {
    method: 'POST'
  })
  .then(response => response.json())
  .then(data => {
    alert(data.message || data.error);

    // Remove previous layer/legend
    if (ahpLayer) {
      map.removeLayer(ahpLayer);
      ahpLayer = null;
    }
    if (ahpLegend) {
      map.removeControl(ahpLegend);
      ahpLegend = null;
    }

    if (data.message) {
      // Add AHP Layer
      ahpLayer = L.tileLayer.wms("http://localhost:8080/geoserver/GOA_Work/wms", {
        layers: 'GOA_Work:weighted_overlay_output',
        format: 'image/png',
        transparent: true,
        zIndex: 6
      }).addTo(map);

      // Add legend
      ahpLegend = L.control({ position: 'bottomright' });
      ahpLegend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
          <strong>AHP Suitability</strong><br>
          <i style="background:#10d71a; width:18px; height:18px; float:left; margin-right:8px;"></i> Not Suitable<br>
          <i style="background:#fffa5a; width:18px; height:18px; float:left; margin-right:8px;"></i> Suitable<br>
          <i style="background:#ba4a24; width:18px; height:18px; float:left; margin-right:8px;"></i> Highly Suitable
        `;
        return div;
      };
      ahpLegend.addTo(map);

      // ✅ Add click event listener for raster popup
      map.on('click', onMapClickForAHP);
    }
  })
  .catch(error => {
    console.error('❌ AHP Calculation Error:', error);
    alert("Something went wrong while calculating AHP.");
  });
}

// ✅ This function handles clicks and shows value + class
function onMapClickForAHP(e) {
  if (!ahpLayer) return;

  const bbox = map.getBounds().toBBoxString();
  const size = map.getSize();
  const point = map.latLngToContainerPoint(e.latlng, map.getZoom());

  const url = `http://localhost:8080/geoserver/GOA_Work/wms` +
    `?service=WMS&version=1.1.1&request=GetFeatureInfo` +
    `&layers=GOA_Work:weighted_overlay_output` +
    `&query_layers=GOA_Work:weighted_overlay_output` +
    `&bbox=${bbox}` +
    `&width=${size.x}&height=${size.y}` +
    `&srs=EPSG:4326` +
    `&format=image/png&transparent=true` +
    `&info_format=application/json` +
    `&x=${Math.floor(point.x)}&y=${Math.floor(point.y)}`;

  fetch(url)
    .then(res => res.json())
    .then(json => {
      if (json.features && json.features.length > 0) {
        const rawVal = parseFloat(Object.values(json.features[0].properties)[0]);
        let label = "Unknown";

        if (rawVal <= 4.06) label = "Not Suitable";
        else if (rawVal >= 4.07 && rawVal <=7) label = "Suitable";
        else label = "Highly Suitable";

        L.popup()
          .setLatLng(e.latlng)
          .setContent(`<strong>AHP Value:</strong> ${rawVal.toFixed(2)}<br><strong>Suitability:</strong> ${label}`)
          .openOn(map);
      } else {
        L.popup()
          .setLatLng(e.latlng)
          .setContent(`No data at this location.`)
          .openOn(map);
      }
    })
    .catch(err => {
      console.error("GetFeatureInfo error:", err);
      alert("❌ Could not fetch raster value.");
    });
}
