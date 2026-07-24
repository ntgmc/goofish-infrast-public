import copy
import unittest
from unittest.mock import Mock, patch

from tools.scrape_prts_logistics import (
    assign_rule_audit_fields,
    build_payload,
    calculate_content_hash,
    fetch_html,
    merge_duplicate_rows,
    validate_existing_payload,
)


def make_row(
    facility="控制中枢",
    skill="技能A",
    description="效果A",
    icon="https://example.test/icons/a.png",
    holders=None,
):
    return {
        "facility": facility,
        "skill": skill,
        "description": description,
        "icon": icon,
        "holders": holders or [{"name": "干员A", "elite": 0}],
    }


def payload_from_rows(rows, existing=None):
    return build_payload("https://example.test/source", rows, existing)


class FetchHtmlTests(unittest.TestCase):
    @patch("tools.scrape_prts_logistics.requests.get")
    def test_fetch_html_uses_requests_and_declared_charset(self, mock_get):
        response = Mock()
        response.headers = {"Content-Type": "text/html; charset=gb18030"}
        response.content = "后勤技能".encode("gb18030")
        mock_get.return_value = response

        result = fetch_html("https://example.test/logistics")

        self.assertEqual(result, "后勤技能")
        mock_get.assert_called_once_with(
            "https://example.test/logistics",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0 Safari/537.36"
                )
            },
            timeout=30,
        )
        response.raise_for_status.assert_called_once_with()

    @patch("tools.scrape_prts_logistics.requests.get")
    def test_fetch_html_defaults_to_utf8_without_declared_charset(self, mock_get):
        response = Mock()
        response.headers = {"Content-Type": "text/html"}
        response.content = "后勤技能".encode("utf-8")
        mock_get.return_value = response

        self.assertEqual(
            fetch_html("https://example.test/logistics"),
            "后勤技能",
        )


class RuleAuditFieldTests(unittest.TestCase):
    def test_bootstrap_is_deterministic_and_unique(self):
        rows = [
            make_row(),
            make_row(
                facility="贸易站",
                skill="技能B",
                description="效果B",
                icon="https://example.test/icons/b.png",
            ),
        ]
        first = payload_from_rows(rows)
        second = payload_from_rows(rows)

        self.assertEqual(
            [row["rule_id"] for row in first["skills"]],
            ["PRTS-CC-0001", "PRTS-TRD-0002"],
        )
        self.assertEqual(first["skills"], second["skills"])
        self.assertEqual(first["last_rule_number"], 2)

    def test_reordering_preserves_ids_and_middle_insertion_appends(self):
        row_a = make_row()
        row_b = make_row(
            facility="贸易站",
            skill="技能B",
            icon="https://example.test/icons/b.png",
        )
        existing = payload_from_rows([row_a, row_b])
        row_c = make_row(
            facility="制造站",
            skill="技能C",
            icon="https://example.test/icons/c.png",
        )

        migrated = payload_from_rows([row_b, row_c, row_a], existing)
        ids = {row["skill"]: row["rule_id"] for row in migrated["skills"]}

        self.assertEqual(ids["技能A"], "PRTS-CC-0001")
        self.assertEqual(ids["技能B"], "PRTS-TRD-0002")
        self.assertEqual(ids["技能C"], "PRTS-MFG-0003")

    def test_description_and_holder_changes_preserve_id_but_change_hash(self):
        existing = payload_from_rows([make_row()])
        changed = make_row(
            description="修订后效果",
            holders=[
                {"name": "干员A", "elite": 0},
                {"name": "干员B", "elite": 2},
            ],
        )

        migrated = payload_from_rows([changed], existing)

        self.assertEqual(migrated["skills"][0]["rule_id"], "PRTS-CC-0001")
        self.assertNotEqual(
            migrated["skills"][0]["content_hash"],
            existing["skills"][0]["content_hash"],
        )

    def test_deleted_highest_number_is_not_reused(self):
        row_a = make_row()
        row_b = make_row(skill="技能B", icon="https://example.test/icons/b.png")
        existing = payload_from_rows([row_a, row_b])
        after_delete = payload_from_rows([row_a], existing)
        row_c = make_row(skill="技能C", icon="https://example.test/icons/c.png")

        after_add = payload_from_rows([row_a, row_c], after_delete)

        self.assertEqual(after_delete["last_rule_number"], 2)
        self.assertEqual(after_add["skills"][1]["rule_id"], "PRTS-CC-0003")

    def test_exact_duplicate_rows_merge_and_deduplicate_holders(self):
        first = make_row(holders=[{"name": "干员A", "elite": 0}])
        second = make_row(
            holders=[
                {"name": "干员A", "elite": 0},
                {"name": "干员B", "elite": 2},
            ]
        )

        merged = merge_duplicate_rows([first, second])

        self.assertEqual(len(merged), 1)
        self.assertEqual(
            merged[0]["holders"],
            [{"name": "干员A", "elite": 0}, {"name": "干员B", "elite": 2}],
        )

    def test_ambiguous_identity_is_rejected(self):
        rows = [make_row(description="效果A"), make_row(description="效果B")]

        with self.assertRaisesRegex(ValueError, "Duplicate skill identity"):
            assign_rule_audit_fields(rows)

    def test_same_name_and_icon_can_have_distinct_elite_variants(self):
        rows = [
            make_row(description="基础效果", holders=[{"name": "干员A", "elite": 0}]),
            make_row(description="升级效果", holders=[{"name": "干员A", "elite": 2}]),
        ]

        audited, high_water = assign_rule_audit_fields(rows)

        self.assertEqual(high_water, 2)
        self.assertEqual(
            [row["rule_id"] for row in audited],
            ["PRTS-CC-0001", "PRTS-CC-0002"],
        )

    def test_corrupt_existing_state_is_rejected(self):
        payload = payload_from_rows([make_row()])

        duplicate = copy.deepcopy(payload["skills"][0])
        duplicate["skill"] = "技能B"
        duplicate["icon"] = "https://example.test/icons/b.png"
        duplicate["content_hash"] = calculate_content_hash(duplicate)
        payload["skills"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate rule_id"):
            validate_existing_payload(payload)

        bad_high_water = payload_from_rows([make_row()])
        bad_high_water["last_rule_number"] = 0
        with self.assertRaisesRegex(ValueError, "below assigned maximum"):
            validate_existing_payload(bad_high_water)

        unknown = payload_from_rows([make_row()])
        unknown["skills"][0]["facility"] = "未知设施"
        unknown["skills"][0]["content_hash"] = calculate_content_hash(unknown["skills"][0])
        with self.assertRaisesRegex(ValueError, "Unknown facility"):
            validate_existing_payload(unknown)


if __name__ == "__main__":
    unittest.main()
