#!/usr/bin/env python3
"""MAA License Generator - Seller Tool
Generates AES-GCM encrypted .maa license files for customers.

Usage:
    python generate-license.py

Requires: cryptography (pip install cryptography)
Environment: MAA_ADMIN_SECRET - signing key (optional, will prompt if not set)
"""

import hashlib
import hmac
import json
import os
import sys
import base64
from datetime import datetime, timezone

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("Error: cryptography package required. Install with: pip install cryptography")
    sys.exit(1)


OBFUSCATE_KEY_SEED = b"maa-obfuscate-v1"


def canonical_json(obj):
    """Generate deterministic JSON: sorted keys, compact, no spaces."""
    if isinstance(obj, dict):
        return '{' + ','.join(
            json.dumps(k, ensure_ascii=False) + ':' + canonical_json(v)
            for k, v in sorted(obj.items())
        ) + '}'
    elif isinstance(obj, list):
        return '[' + ','.join(canonical_json(item) for item in obj) + ']'
    else:
        return json.dumps(obj, ensure_ascii=False)


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.strip().encode('utf-8')).hexdigest()


def hmac_sha256(key: str, data: str) -> str:
    return hmac.new(key.encode('utf-8'), data.encode('utf-8'), hashlib.sha256).hexdigest()


def format_sig(hex_digest: str) -> str:
    """Format: skadi-{hex[:8]}-{hex[8:16]}"""
    return f"skadi-{hex_digest[:8]}-{hex_digest[8:16]}"


def encrypt_payload(signed_json: str) -> str:
    """AES-GCM encrypt + Base64 encode."""
    key = hashlib.sha256(OBFUSCATE_KEY_SEED).digest()
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, signed_json.encode('utf-8'), None)
    return "MAA-V1:" + base64.b64encode(iv + ciphertext).decode('ascii')


def generate_order_hash(order_id: str) -> str:
    return sha256_hex(order_id.strip())[:16]


CONFIG_TEMPLATES = {
    "243": {
        "layout": "2-4-3",
        "desc": "243 均衡流 (2赤金/2经验)",
        "trading_stations_count": 2,
        "manufacturing_stations_count": 4,
        "product_requirements": {
            "trading_stations": {"LMD": 2},
            "manufacturing_stations": {"Pure Gold": 2, "Battle Record": 2}
        },
        "Fiammetta": {"enable": True},
        "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
    },
    "243-1": {
        "layout": "2-4-3",
        "desc": "243 搓玉 (2赤金/2源石)",
        "trading_stations_count": 2,
        "manufacturing_stations_count": 4,
        "product_requirements": {
            "trading_stations": {"LMD": 1, "Orundum": 1},
            "manufacturing_stations": {"Pure Gold": 2, "Originium Shard": 2}
        },
        "Fiammetta": {"enable": True},
        "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
    },
    "333": {
        "layout": "3-3-3",
        "desc": "333 搓玉流",
        "trading_stations_count": 3,
        "manufacturing_stations_count": 3,
        "product_requirements": {
            "trading_stations": {"LMD": 2, "Orundum": 1},
            "manufacturing_stations": {"Pure Gold": 2, "Originium Shard": 1}
        },
        "Fiammetta": {"enable": True},
        "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
    }
}


def main():
    print("=== MAA License File Generator ===\n")

    # Get admin secret
    admin_secret = os.environ.get("MAA_ADMIN_SECRET", "")
    if not admin_secret:
        admin_secret = input("Enter admin secret (signing key): ").strip()
        if not admin_secret:
            print("Error: admin secret is required")
            sys.exit(1)

    # Get order ID
    order_id = input("Order ID (闲鱼订单号): ").strip()
    if not order_id:
        print("Error: order ID is required")
        sys.exit(1)

    # Get operators file
    ops_path = input("operators.json path (drag & drop): ").strip().strip('"')
    if not os.path.exists(ops_path):
        print(f"Error: file not found: {ops_path}")
        sys.exit(1)

    with open(ops_path, 'r', encoding='utf-8-sig') as f:
        operators = json.load(f)

    # Validate operator format
    required_keys = {'id', 'name', 'own', 'elite', 'rarity'}
    for op in operators:
        missing = required_keys - set(op.keys())
        if missing:
            print(f"Error: operator '{op.get('name', '?')}' missing keys: {missing}")
            sys.exit(1)

    # Get config type
    print("\nAvailable configs: 243, 243-1, 333")
    config_type = input("Config type [243]: ").strip() or "243"
    if config_type not in CONFIG_TEMPLATES:
        print(f"Warning: unknown config '{config_type}', using 243")
        config_type = "243"

    config = CONFIG_TEMPLATES[config_type].copy()

    print("\nAvailable permissions: basic, premium, admin")
    permission = input("Permission [basic]: ").strip().lower() or "basic"
    if permission not in {"basic", "premium", "admin"}:
        print(f"Warning: unknown permission '{permission}', using basic")
        permission = "basic"

    order_hash = generate_order_hash(order_id)

    # Build license (without sig)
    license_data = {
        "version": 1,
        "order_hash": order_hash,
        "operators": operators,
        "config": config,
        "permission": permission,
        "issued_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    }

    # Sign
    canonical_payload = canonical_json({k: v for k, v in license_data.items()})
    sig_hex = hmac_sha256(admin_secret, canonical_payload)
    license_data["sig"] = format_sig(sig_hex)

    # Encrypt
    signed_json = canonical_json(license_data)
    encrypted = encrypt_payload(signed_json)

    # Save
    output_path = os.path.join(os.path.dirname(ops_path) or '.', f"maa-license-{order_hash[:8]}.maa")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(encrypted)

    print(f"\nLicense generated successfully!")
    print(f"  Order ID:   {order_id}")
    print(f"  Order Hash: {order_hash}")
    print(f"  Config:     {config['desc']}")
    print(f"  Permission: {permission}")
    print(f"  Operators:  {len(operators)}")
    print(f"  Output:     {output_path}")


if __name__ == "__main__":
    main()
