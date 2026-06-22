import argparse
import datetime as dt
import html
import json
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


def build_payload(source_url, rows):
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
    args = arg_parser.parse_args(argv)

    page_html = fetch_html(args.url)
    rows = parse_skill_rows(page_html)
    payload = build_payload(args.url, rows)

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
