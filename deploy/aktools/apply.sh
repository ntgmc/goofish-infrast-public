#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bash /path/to/aktools-clock/apply.sh' >&2
  exit 1
fi
clock_bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
clock_site=/etc/nginx/sites-available/aktools.cn
clock_root=/var/www/aktools.cn
clock_snippet=/etc/nginx/snippets/aktools-value-clock.conf
for clock_file in "$clock_bundle/index.html" "$clock_bundle/value-clock.conf" "$clock_site" "$clock_root/index.html"; do
  test -f "$clock_file"
done

# A disabled upstream must not replace the working homepage with an empty clock.
python3 - <<'PY'
import json
from datetime import datetime, timezone
from urllib.request import urlopen
with urlopen('https://maatool.com/api/site/value-clock?view=production', timeout=20) as response:
    data = json.load(response)
assert data['schema_version'] == 1 and data['view'] == 'production', 'Unexpected MaaTool clock contract'
assert data['status'] in ('ready', 'empty') and data['totals'] is not None, 'MaaTool has no usable clock history'
assert datetime.fromisoformat(data['valid_until'].replace('Z', '+00:00')) > datetime.now(timezone.utc), 'MaaTool clock snapshot expired'
print('MaaTool clock preflight passed')
PY

clock_backup=$(mktemp -d /var/backups/aktools-clock.XXXXXX)
cp -a "$clock_site" "$clock_backup/site.conf"
cp -a "$clock_root/index.html" "$clock_backup/index.html"
clock_snippet_existed=false
if [[ -f $clock_snippet ]]; then cp -a "$clock_snippet" "$clock_backup/value-clock.conf"; clock_snippet_existed=true; fi
clock_rollback() {
  cp -a "$clock_backup/site.conf" "$clock_site"
  cp -a "$clock_backup/index.html" "$clock_root/index.html"
  if [[ $clock_snippet_existed == true ]]; then cp -a "$clock_backup/value-clock.conf" "$clock_snippet"; else rm -f "$clock_snippet"; fi
  nginx -t && systemctl reload nginx
  echo "Deployment failed; restored homepage and site configuration from $clock_backup" >&2
}
trap clock_rollback ERR
install -m 0644 "$clock_bundle/value-clock.conf" "$clock_snippet"
python3 - "$clock_site" <<'PY'
from pathlib import Path
import sys
site = Path(sys.argv[1])
source = site.read_text()
include = '    include /etc/nginx/snippets/aktools-value-clock.conf;\n'
if include not in source:
    marker = '    location / {'
    assert source.count(marker) == 1 and 'root /var/www/aktools.cn;' in source, 'Review the current aktools.cn site layout before applying'
    site.write_text(source.replace(marker, include + '\n' + marker, 1))
PY
nginx -t
clock_config_dump=$(mktemp)
nginx -T >"$clock_config_dump" 2>&1
if ! grep -q 'location = /api/value-clock' "$clock_config_dump"; then
  echo 'Effective Nginx configuration does not contain the AkTools value clock location.' >&2
  grep -n -C 4 'aktools.cn\|aktools-value-clock' "$clock_config_dump" >&2 || true
  false
fi
install -m 0644 "$clock_bundle/index.html" "$clock_root/index.html"
systemctl reload nginx
sleep 2
clock_api_headers=$(mktemp)
clock_api_body=$(mktemp)
clock_api_status=$(curl --noproxy '*' --silent --show-error --resolve aktools.cn:443:127.0.0.1 --dump-header "$clock_api_headers" --output "$clock_api_body" --write-out '%{http_code}' https://aktools.cn/api/value-clock || true)
if [[ $clock_api_status != 200 ]]; then
  echo "Local proxy returned HTTP $clock_api_status" >&2
  sed -n '1,20p' "$clock_api_headers" >&2
  head -c 1024 "$clock_api_body" >&2
  echo >&2
  false
fi
python3 - "$clock_api_body" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
assert data['view'] == 'production' and data['totals'] is not None
print('Local proxy passed')
PY
clock_home_headers=$(mktemp)
clock_home_body=$(mktemp)
clock_home_status=$(curl --noproxy '*' --silent --show-error --resolve aktools.cn:443:127.0.0.1 --dump-header "$clock_home_headers" --output "$clock_home_body" --write-out '%{http_code}' https://aktools.cn/ || true)
if [[ $clock_home_status != 200 ]]; then
  echo "Local homepage returned HTTP $clock_home_status" >&2
  sed -n '1,20p' "$clock_home_headers" >&2
  head -c 1024 "$clock_home_body" >&2
  echo >&2
  false
fi
python3 - "$clock_home_body" <<'PY'
import sys
with open(sys.argv[1], encoding='utf-8') as handle:
    page = handle.read()
assert '__CLOCK_SCRIPT__' not in page and '粤ICP备2026089247号' in page and '粤公网安备44010402003782号' in page
print('Local homepage passed')
PY
trap - ERR
echo "AkTools deployed. Backup: $clock_backup"
