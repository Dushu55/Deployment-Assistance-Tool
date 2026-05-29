import zlib
import base64
import urllib.request

def generate_mermaid_png(input_file, output_file):
    with open(input_file, 'r') as f:
        diagram = f.read()

    # Kroki expects the diagram to be zlib compressed and then base64url encoded
    compressed = zlib.compress(diagram.encode('utf-8'))
    # Use standard base64url encoding (replace + with -, / with _, and strip =)
    encoded = base64.urlsafe_b64encode(compressed).decode('utf-8')

    url = f"https://kroki.io/mermaid/png/{encoded}"
    
    print(f"Fetching diagram from {url} ...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    with urllib.request.urlopen(req) as response:
        with open(output_file, 'wb') as f:
            f.write(response.read())

    print(f"Successfully saved {output_file}")

if __name__ == "__main__":
    generate_mermaid_png('temp.mmd', 'DAT_Architecture.png')
