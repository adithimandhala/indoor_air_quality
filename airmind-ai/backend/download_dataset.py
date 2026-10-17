import os
import requests

FILE_ID = "1v5_ek-55Cg9UZmEWzFOaGbDY8H2MD61E"
OUTPUT_DIR = "data"
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "IoT_Indoor_Air_Quality_Dataset.csv")

def download_from_gdrive(file_id: str, dest: str):
    print(f"Downloading dataset from Google Drive (id={file_id})...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    session = requests.Session()

    # Step 1: Initial request — may redirect to virus-scan warning page
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    response = session.get(url, stream=True)

    # Step 2: If Google shows a confirmation page, extract token and re-request
    token = None
    for key, value in response.cookies.items():
        if key.startswith("download_warning"):
            token = value
            break

    if token:
        params = {"id": file_id, "confirm": token, "export": "download"}
        response = session.get("https://drive.google.com/uc", params=params, stream=True)

    # Step 3: Save file in chunks
    total = 0
    with open(dest, "wb") as f:
        for chunk in response.iter_content(chunk_size=32768):
            if chunk:
                f.write(chunk)
                total += len(chunk)

    size_mb = total / (1024 * 1024)
    print(f"✅ Downloaded: {dest}  ({size_mb:.1f} MB)")

if __name__ == "__main__":
    if os.path.exists(OUTPUT_PATH):
        print(f"Dataset already exists at {OUTPUT_PATH}, skipping download.")
    else:
        download_from_gdrive(FILE_ID, OUTPUT_PATH)
