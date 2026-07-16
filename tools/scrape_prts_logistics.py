import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser


DEFAULT_URL = "https://prts.wiki/w/%E5%90%8E%E5%8B%A4%E6%8A%80%E8%83%BD%E4%B8%80%E8%A7%88"
DEFAULT_OUTPUT = "prts_logistics_skills.json"
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
ELITE_RE = re.compile(r"(?:%E7%B2%BE%E8%8B%B1|精英)_([0-2])_", re.IGNORECASE)
RULE_ID_RE = re.compile(r"^PRTS-([A-Z]+)-(\d{4,})$")
CONTENT_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
FACILITY_PREFIXES = {
    "控制中枢": "CC",
    "贸易站": "TRD",
    "制造站": "MFG",
    "发电站": "PWR",
    "宿舍": "DORM",
    "会客室": "MEET",
    "办公室": "HR",
    "加工站": "PROC",
    "训练室": "TRAIN",
}


class Node:
    def __init__(self, tag, attrs=None, text=""):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.text = text
        self.children = []

    def append(self, child):
        self.children.append(child)

    def iter(self, tag=None):
        if tag is None or self.tag == tag:
            yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.iter(tag)

    def text_content(self):
        parts = []
        for child in self.children:
            if isinstance(child, Node):
                parts.append(child.text_content())
            else:
                parts.append(child)
        if self.text:
            parts.append(self.text)
        return "".join(parts)


class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.root = Node("document")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag.lower(), attrs)
        self.stack[-1].append(node)
        if tag.lower() not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].append(Node(tag.lower(), attrs))

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if data:
            self.stack[-1].append(data)

    def handle_entityref(self, name):
        self.stack[-1].append(html.unescape(f"&{name};"))

    def handle_charref(self, name):
        self.stack[-1].append(html.unescape(f"&#{name};"))


def fetch_html(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def normalize_text(value):
    return re.sub(r"\s+", " ", value).strip()


def visible_text_content(node):
    style = node.attrs.get("style", "").lower()
    if re.search(r"display\s*:\s*none", style):
        return ""
    parts = []
    for child in node.children:
        if isinstance(child, Node):
            parts.append(visible_text_content(child))
        else:
            parts.append(child)
    return "".join(parts)


def child_elements(node, tag=None):
    return [
        child for child in node.children
        if isinstance(child, Node) and (tag is None or child.tag == tag)
    ]


def contains_char_icon(anchor):
    return any(img.attrs.get("id") == "charicon" for img in anchor.iter("img"))


def parse_elite(anchor):
    for img in anchor.iter("img"):
        if img.attrs.get("id") != "eliteicon":
            continue
        src = urllib.parse.unquote(img.attrs.get("src", ""))
        match = ELITE_RE.search(src)
        if match:
            return int(match.group(1))
    return None


def parse_holders(cell):
    holders = []
    seen = set()
    for anchor in cell.iter("a"):
        if not contains_char_icon(anchor):
            continue
        name = normalize_text(anchor.attrs.get("title") or anchor.text_content())
        if not name:
            href = urllib.parse.unquote(anchor.attrs.get("href", ""))
            name = href.rsplit("/", 1)[-1].replace("_", " ")
        if not name:
            continue
        holder = {
            "name": name,
            "elite": parse_elite(anchor),
        }
        key = (holder["name"], holder["elite"])
        if key in seen:
            continue
        seen.add(key)
        holders.append(holder)
    return holders


def absolutize_prts_url(src):
    if not src:
        return ""
    src = html.unescape(src)
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return "https://prts.wiki" + src
    return src


def parse_skill_rows(page_html):
    parser = TreeParser()
    parser.feed(page_html)

    rows = []
    for table in parser.root.iter("table"):
        table_class = table.attrs.get("class", "")
        if "wikitable" not in table_class:
            continue

        trs = list(table.iter("tr"))
        if len(trs) < 3:
            continue

        first_header = ""
        for th in trs[0].iter("th"):
            first_header = normalize_text(th.text_content())
            break
        facility = first_header
        if not facility:
            continue

        for tr in trs[2:]:
            cells = child_elements(tr, "td")
            if len(cells) < 4:
                continue

            icon = ""
            for img in cells[0].iter("img"):
                icon = absolutize_prts_url(img.attrs.get("src", ""))
                break

            row = {
                "facility": facility,
                "skill": normalize_text(visible_text_content(cells[1])),
                "description": normalize_text(visible_text_content(cells[2])),
                "icon": icon,
                "holders": parse_holders(cells[3]),
            }
            if row["skill"]:
                rows.append(row)

    return rows


def merge_duplicate_rows(rows):
    """Merge semantically identical source rows while preserving source order."""
    merged = []
    by_content = {}
    holder_keys = {}
    for row in rows:
        content_key = (
            row["facility"],
            row["skill"],
            row["description"],
            row["icon"],
        )
        if content_key not in by_content:
            copied = {
                "facility": row["facility"],
                "skill": row["skill"],
                "description": row["description"],
                "icon": row["icon"],
                "holders": [],
            }
            by_content[content_key] = copied
            holder_keys[content_key] = set()
            merged.append(copied)

        target = by_content[content_key]
        seen = holder_keys[content_key]
        for holder in row["holders"]:
            holder_key = (holder["name"], holder["elite"])
            if holder_key in seen:
                continue
            seen.add(holder_key)
            target["holders"].append({
                "name": holder["name"],
                "elite": holder["elite"],
            })
    return merged


def icon_filename(icon_url):
    path = urllib.parse.urlsplit(icon_url).path
    return urllib.parse.unquote(path.rsplit("/", 1)[-1])


def rule_identity(row):
    elites = [holder["elite"] for holder in row.get("holders", []) if holder["elite"] is not None]
    minimum_elite = min(elites) if elites else None
    return (row["facility"], row["skill"], icon_filename(row["icon"]), minimum_elite)


def base_rule_identity(row):
    return rule_identity(row)[:3]


def canonical_rule_content(row):
    return {
        "facility": row["facility"],
        "skill": row["skill"],
        "description": row["description"],
        "icon": row["icon"],
        "holders": [
            {"name": holder["name"], "elite": holder["elite"]}
            for holder in row["holders"]
        ],
    }


def calculate_content_hash(row):
    canonical = json.dumps(
        canonical_rule_content(row),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_existing_payload(payload):
    if payload is None:
        return {}, 0
    if not isinstance(payload, dict):
        raise ValueError("Existing output must be a JSON object.")

    last_rule_number = payload.get("last_rule_number", 0)
    if isinstance(last_rule_number, bool) or not isinstance(last_rule_number, int):
        raise ValueError("Existing last_rule_number must be a non-negative integer.")
    if last_rule_number < 0:
        raise ValueError("Existing last_rule_number must be a non-negative integer.")

    skills = payload.get("skills", [])
    with_ids = ["rule_id" in row or "content_hash" in row for row in skills]
    if any(with_ids) and not all(with_ids):
        raise ValueError("Existing skills must either all have audit fields or all be legacy rows.")
    if not any(with_ids):
        return {}, last_rule_number

    by_identity = {}
    used_ids = set()
    maximum = 0
    for row in skills:
        facility = row.get("facility")
        expected_prefix = FACILITY_PREFIXES.get(facility)
        if expected_prefix is None:
            raise ValueError(f"Unknown facility in existing output: {facility!r}")

        rule_id = row.get("rule_id")
        match = RULE_ID_RE.fullmatch(rule_id or "")
        if not match or match.group(1) != expected_prefix:
            raise ValueError(f"Invalid rule_id for {facility}/{row.get('skill')}: {rule_id!r}")
        number = int(match.group(2))
        maximum = max(maximum, number)
        if rule_id in used_ids:
            raise ValueError(f"Duplicate rule_id in existing output: {rule_id}")
        used_ids.add(rule_id)

        content_hash = row.get("content_hash")
        if not CONTENT_HASH_RE.fullmatch(content_hash or ""):
            raise ValueError(f"Invalid content_hash for {rule_id}")
        if content_hash != calculate_content_hash(row):
            raise ValueError(f"Stale content_hash in existing output: {rule_id}")

        identity = rule_identity(row)
        if identity in by_identity:
            raise ValueError(
                "Duplicate skill identity in existing output: "
                f"{identity[0]}/{identity[1]}/{identity[2]}"
            )
        by_identity[identity] = rule_id

    if last_rule_number < maximum:
        raise ValueError(
            f"last_rule_number {last_rule_number} is below assigned maximum {maximum}."
        )
    return by_identity, last_rule_number


def assign_rule_audit_fields(rows, existing_payload=None):
    existing_ids, last_rule_number = validate_existing_payload(existing_payload)
    existing_by_base = {}
    for identity, rule_id in existing_ids.items():
        existing_by_base.setdefault(identity[:3], []).append(rule_id)
    assigned = []
    seen_identities = set()
    for row in merge_duplicate_rows(rows):
        facility = row["facility"]
        prefix = FACILITY_PREFIXES.get(facility)
        if prefix is None:
            raise ValueError(f"Unknown facility in scraped data: {facility!r}")

        identity = rule_identity(row)
        if identity in seen_identities:
            raise ValueError(
                "Duplicate skill identity after exact-row merging: "
                f"{identity[0]}/{identity[1]}/{identity[2]}"
            )
        seen_identities.add(identity)

        rule_id = existing_ids.get(identity)
        if rule_id is None:
            base_candidates = existing_by_base.get(base_rule_identity(row), [])
            if len(base_candidates) == 1:
                rule_id = base_candidates[0]
        if rule_id is None:
            last_rule_number += 1
            rule_id = f"PRTS-{prefix}-{last_rule_number:04d}"

        audited = {"rule_id": rule_id, **canonical_rule_content(row)}
        audited["content_hash"] = calculate_content_hash(audited)
        # Keep audit fields together at the start of each rule in the JSON output.
        audited = {
            "rule_id": audited["rule_id"],
            "content_hash": audited["content_hash"],
            **canonical_rule_content(audited),
        }
        assigned.append(audited)
    return assigned, last_rule_number


def build_payload(source_url, rows, existing_payload=None):
    rows, last_rule_number = assign_rule_audit_fields(rows, existing_payload)
    holder_count = sum(len(row["holders"]) for row in rows)
    unresolved_elites = [
        {"facility": row["facility"], "skill": row["skill"], "name": holder["name"]}
        for row in rows
        for holder in row["holders"]
        if holder["elite"] is None
    ]
    return {
        "source": source_url,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "last_rule_number": last_rule_number,
        "skill_count": len(rows),
        "holder_count": holder_count,
        "unresolved_elite_count": len(unresolved_elites),
        "unresolved_elites": unresolved_elites,
        "skills": rows,
    }


def main(argv=None):
    arg_parser = argparse.ArgumentParser(
        description="Scrape PRTS logistics skill holder avatars into operator/elite data."
    )
    arg_parser.add_argument("--url", default=DEFAULT_URL)
    arg_parser.add_argument("--output", default=DEFAULT_OUTPUT)
    arg_parser.add_argument(
        "--migrate-existing",
        action="store_true",
        help="Add or validate audit fields in the existing output without fetching PRTS.",
    )
    args = arg_parser.parse_args(argv)

    existing_payload = None
    if os.path.exists(args.output):
        with open(args.output, "r", encoding="utf-8-sig") as file:
            existing_payload = json.load(file)

    if args.migrate_existing:
        if existing_payload is None:
            arg_parser.error("--migrate-existing requires an existing --output file")
        source_url = existing_payload.get("source") or args.url
        rows = existing_payload.get("skills", [])
        payload = build_payload(source_url, rows, existing_payload)
        if existing_payload.get("fetched_at"):
            payload["fetched_at"] = existing_payload["fetched_at"]
    else:
        page_html = fetch_html(args.url)
        rows = parse_skill_rows(page_html)
        payload = build_payload(args.url, rows, existing_payload)

    with open(args.output, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(
        f"Wrote {args.output}: {payload['skill_count']} skills, "
        f"{payload['holder_count']} holders, "
        f"{payload['unresolved_elite_count']} unresolved elite values."
    )
    if payload["unresolved_elite_count"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
