import os
import numpy as np
import rasterio
from rasterio.enums import Resampling
import json  # Added to read weights.json

def read_raster(raster_path):
    with rasterio.open(raster_path) as src:
        data = src.read(1)
        transform = src.transform
        crs = src.crs
        meta = src.meta
    return data, transform, crs, meta

def reclassify(data, reclass_map, restricted_value=-1):
    output = np.full_like(data, np.nan, dtype=np.float32)
    for src_val, new_val in reclass_map:
        if new_val == "Restricted":
            output[data == src_val] = restricted_value
        elif new_val == "NoData":
            output[data == src_val] = np.nan
        else:
            output[data == src_val] = new_val
    return output

def save_raster(output_path, data, transform, crs, meta):
    meta.update(dtype=rasterio.float32, count=1, compress='lzw')
    with rasterio.open(output_path, 'w', **meta) as dst:
        dst.write(data, 1)

def resample_to_match(source_path, reference_meta):
    with rasterio.open(source_path) as src:
        data = src.read(
            1,
            out_shape=(reference_meta['height'], reference_meta['width']),
            resampling=Resampling.nearest
        )
    return data

def weighted_overlay(layers_info, weights, output_path, restricted_value=-1):
    assert sum(weights.values()) == 100, "Weights must sum to 100"

    first_key = next(iter(layers_info))
    base_data, transform, crs, meta = read_raster(layers_info[first_key][0])
    shape = base_data.shape
    final_data = np.zeros(shape, dtype=np.float32)

    for layer_name, (raster_path, reclass_map) in layers_info.items():
        print(f"Processing layer: {layer_name}")
        weight = weights.get(layer_name, 0)
        data = resample_to_match(raster_path, meta)
        reclassed = reclassify(data, reclass_map, restricted_value=restricted_value)
        weighted = np.where(np.isnan(reclassed), 0, reclassed * (weight / 100))
        final_data += weighted

    final_data[final_data == 0] = np.nan
    save_raster(output_path, final_data, transform, crs, meta)
    print(f"\n✅ Weighted overlay saved to: {output_path}")

# -----------------------------------
# Main Execution Block
# -----------------------------------
if __name__ == "__main__":
    input_folder = "uploads"

    layers_info = {
        "road": (
            os.path.join(input_folder, "road.tif"),
            [[1, 9], [2, 7], [3, 5], [4, 3], [5, "Restricted"]]
        ),
        "transmission": (
            os.path.join(input_folder, "transmission.tif"),
            [[1, 9], [2, 7], [3, 5], [4, 3], [5, "Restricted"]]
        ),
        "ghi": (
            os.path.join(input_folder, "GHI.tif"),
            [[1, "Restricted"], [2, 3], [3, 5], [4, 7], [5, 9]]
        ),
        "slope": (
            os.path.join(input_folder, "slope.tif"),
            [[1, 9], [2, 7], [3, 5], [4, 3], [5, "Restricted"]]
        ),
        "lulc": (
            os.path.join(input_folder, "lulc.tif"),
            [[1, 9], [2, 3], [3, 7], [4, 5], [5, "Restricted"]]
        ),
        "elevation": (
            os.path.join(input_folder, "elevation.tif"),
            [[1, 9], [2, 7], [3, 5], [4, 3], [5, "Restricted"]]
        ),
        "feeder": (
            os.path.join(input_folder, "feeder.tif"),
            [[1, 9], [2, 7], [3, 5], [4, 3], [5, "Restricted"]]
        )
    }

    # 🔁 Load weights from weights.json
    with open("weights.json", "r") as f:
        weights = json.load(f)

    total = sum(weights.values())
    if total != 100:
        print(f"⚠️ Weight sum is {total}, normalizing...")
        weights = {k: round(v * 100 / total, 2) for k, v in weights.items()}
        print("✅ Weights normalized to 100:", weights)
    else:
        print("✅ Weights loaded from weights.json:", weights)

    output_path = "output/weighted_overlay_output.tif"
    weighted_overlay(layers_info, weights, output_path)
