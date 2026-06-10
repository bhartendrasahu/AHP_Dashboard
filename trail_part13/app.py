from flask import Flask, request, render_template, jsonify
import os
import xlwings as xw
import requests
import subprocess

app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
STYLE_FOLDER = 'styles'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STYLE_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'tif', 'tiff'}
criteria = ['SIR', 'TL', 'FL', 'LULC', 'ELE', 'Slope', 'Road_Net']

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/form')
def form():
    return render_template('form.html', criteria=criteria, cp=[''] * len(criteria), cr='', matrix=[["" for _ in criteria] for _ in criteria])

@app.route('/submit', methods=['POST'])
def submit():
    wb = xw.Book(r'final_ahp.xlsx')
    sheet = wb.sheets['Final_Sheet']
    base_row = 3
    base_col = 2
    matrix = [["" for _ in criteria] for _ in criteria]

    for key, val_str in request.form.items():
        try:
            row_key, col_key = key.split('_', 1)
            i = criteria.index(row_key)
            j = criteria.index(col_key)
            v = float(eval(val_str))
            sheet.cells(base_row + i, base_col + j).value = v
            sheet.cells(base_row + j, base_col + i).value = round(1 / v, 5)
        except Exception as e:
            print(f"⚠️ Error processing {key}: {e}")

    wb.save()
    cp_col = base_col + len(criteria) + 2
    cp_values = [round(sheet.cells(base_row + i, cp_col).value * 100) for i in range(len(criteria))]
    cr_value = sheet.range('N13').value

    for i in range(len(criteria)):
        for j in range(len(criteria)):
            matrix[i][j] = str(sheet.cells(base_row + i, base_col + j).value)

    wb.close()
    return render_template('form.html', criteria=criteria, cp=cp_values, cr=cr_value, matrix=matrix)

@app.route('/upload_single', methods=['POST'])
def upload_single():
    workspace = "GOA_Work"
    geoserver_url = "http://localhost:8080/geoserver"
    geoserver_user = "admin"
    geoserver_pass = "geoserver"

    for name in request.files:
        file = request.files[name]
        if file and allowed_file(file.filename):
            filename = f"{name}.tif"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)

            with open(filepath, 'rb') as f:
                headers = {'Content-type': 'image/tiff'}
                upload_url = f"{geoserver_url}/rest/workspaces/{workspace}/coveragestores/{name}/file.geotiff"
                r = requests.put(upload_url, auth=(geoserver_user, geoserver_pass), headers=headers, data=f)
                if r.status_code not in [200, 201]:
                    return jsonify({'message': f'GeoServer error: {r.text}'}), 500

            sld_path = os.path.join(STYLE_FOLDER, f"{name}.sld")
            if os.path.exists(sld_path):
                with open(sld_path, 'rb') as sld_file:
                    sld_headers = {'Content-Type': 'application/vnd.ogc.sld+xml'}
                    sld_upload_url = f"{geoserver_url}/rest/styles"
                    requests.post(sld_upload_url, auth=(geoserver_user, geoserver_pass), headers=sld_headers, params={'name': name}, data=sld_file)

                    layer_url = f"{geoserver_url}/rest/layers/{workspace}:{name}"
                    requests.put(layer_url, auth=(geoserver_user, geoserver_pass), headers={'Content-Type': 'application/json'}, json={"layer": {"defaultStyle": {"name": name}}})

            return jsonify({'message': f'{name} uploaded and styled!', 'layerName': name})

    return jsonify({'message': 'No valid file found.'}), 400

@app.route('/calculate_ahp', methods=['POST'])
def calculate_ahp():
    try:
        subprocess.run(['python', 'ahp1.py'], check=True)
        workspace = "GOA_Work"
        geoserver_url = "http://localhost:8080/geoserver"
        geoserver_user = "admin"
        geoserver_pass = "geoserver"

        layer_name = "weighted_overlay_output"
        store_name = layer_name
        geotiff_path = os.path.abspath("output/weighted_overlay_output.tif")
        sld_path = os.path.abspath("styles/ahp_style.sld")
        style_name = "ahp_style"

        store_url = f"{geoserver_url}/rest/workspaces/{workspace}/coveragestores/{store_name}"
        store_check = requests.get(store_url, auth=(geoserver_user, geoserver_pass))

        if store_check.status_code == 200:
            delete_resp = requests.delete(store_url + "?recurse=true", auth=(geoserver_user, geoserver_pass))
            if delete_resp.status_code not in [200, 202]:
                return jsonify({"error": "Failed to delete existing store: " + delete_resp.text}), 500

        with open(geotiff_path, 'rb') as f:
            headers = {"Content-type": "image/tiff"}
            upload_url = f"{geoserver_url}/rest/workspaces/{workspace}/coveragestores/{store_name}/file.geotiff"
            params = {"coverageName": layer_name}
            upload_resp = requests.put(upload_url, params=params, headers=headers, auth=(geoserver_user, geoserver_pass), data=f)

            if upload_resp.status_code not in [200, 201]:
                return jsonify({"error": "GeoTIFF upload failed: " + upload_resp.text}), 500

        style_check_url = f"{geoserver_url}/rest/styles/{style_name}.xml"
        style_check = requests.get(style_check_url, auth=(geoserver_user, geoserver_pass))

        if style_check.status_code != 200:
            with open(sld_path, 'r') as sld_file:
                headers = {"Content-Type": "application/vnd.ogc.sld+xml"}
                style_upload_url = f"{geoserver_url}/rest/styles"
                params = {"name": style_name}
                style_upload_resp = requests.post(style_upload_url, params=params, headers=headers, auth=(geoserver_user, geoserver_pass), data=sld_file.read())

                if style_upload_resp.status_code not in [200, 201]:
                    return jsonify({"error": "SLD upload failed: " + style_upload_resp.text}), 500

        layer_url = f"{geoserver_url}/rest/layers/{workspace}:{layer_name}"
        style_xml = f"""
        <layer>
            <defaultStyle>
                <name>{style_name}</name>
            </defaultStyle>
        </layer>
        """
        style_apply_resp = requests.put(layer_url, headers={"Content-Type": "application/xml"}, auth=(geoserver_user, geoserver_pass), data=style_xml)

        if style_apply_resp.status_code != 200:
            return jsonify({"error": "Failed to apply style: " + style_apply_resp.text}), 500

        return jsonify({"message": "✅ AHP calculated, uploaded, styled, and published!"})

    except subprocess.CalledProcessError as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
