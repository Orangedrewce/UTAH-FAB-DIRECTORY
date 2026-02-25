import re
import time
import urllib.request
import urllib.parse
import json

try:
    from bs4 import BeautifulSoup
except ImportError:
    import subprocess
    subprocess.check_call(['pip', 'install', 'beautifulsoup4'])
    from bs4 import BeautifulSoup

def is_valid_domain(url, company_name):
    domain = urllib.parse.urlparse(url).netloc.lower()
    if domain.startswith('www.'):
        domain = domain[4:]
    directories = [
        'yelp.', 'facebook.', 'mapquest.', 'mfg.', 'yellowpages.', 'linkedin.', 
        'reddit.', 'instagram.', 'youtube.', 'manta.', 'dnb.', 'bbb.', 'zoominfo.', 
        'superpages.', 'bizapedia.', 'map-', 'porch.', 'chamberofcommerce.', 
        'alignable.', 'local.yahoo.', 'cylex', 'yellowbook.', 'foursquare', 
        'kompass', 'thomasnet.', 'buildzoom.', 'opencorporates.', 'datanyze.', 
        'usa.', 'bloomberg.', 'nypost.', 'buzzfile.', 'infofree.', 'macray.',
        'yellowbot.', 'justia.', 'glassdoor.', 'indeed.', 'chamberofcommerce',
        'thebluebook.', 'localdatabase.', 'chamber.', 'citysearch.', 'dexknows.', 
        'local.com', 'merchantcircle.', 'hotfrog.', 'businessyab.', 'us-business.',
        'local', 'directions', 'chamber', 'pages', 'yellowpagesgoesgreen.', 'macraesbluebook.',
        'americantowns.', 'allbiz.', 'cylex-usa.', 'bbb.org'
    ]
    if any(d in domain for d in directories):
        return False
    return True

with open(r'c:\Users\Admin\Downloads\Website prototype\src\db\master-utah-fab-backend-setup.sql', 'r', encoding='utf-8') as f:
    text = f.read()

matches = re.finditer(r"'Search:\s([^']+)'", text)
queries = []
for m in matches:
    queries.append((m.group(0), m.group(1)))

print(f"Found {len(queries)} queries")

replacements = []
for orig, q in queries:
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(q)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
        html = urllib.request.urlopen(req, timeout=10).read()
        soup = BeautifulSoup(html, 'html.parser')
        found = False
        for a in soup.find_all('a', class_='result__url'):
            href = a.get('href')
            if href and 'uddg=' in href:
                encoded_url = href.split('uddg=')[1].split('&')[0]
                decoded_url = urllib.parse.unquote(encoded_url)
                if is_valid_domain(decoded_url, q):
                    # extract just hostname
                    parsed = urllib.parse.urlparse(decoded_url)
                    clean_url = parsed.netloc
                    if clean_url.startswith('www.'):
                        clean_url = clean_url[4:]
                    print(f"{q} -> {clean_url}")
                    replacements.append((orig, f"'{clean_url}'"))
                    found = True
                    break
        if not found:
            print(f"{q} -> No valid domain found")
    except Exception as e:
        print(f"{q} -> Error: {e}")
    time.sleep(1.5)

for orig, new_val in replacements:
    text = text.replace(orig, new_val)

with open(r'c:\Users\Admin\Downloads\Website prototype\src\db\master-utah-fab-backend-setup.sql', 'w', encoding='utf-8') as f:
    f.write(text)

print(f"Done replacing {len(replacements)} items.")
