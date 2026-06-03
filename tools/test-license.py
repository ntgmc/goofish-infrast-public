#!/usr/bin/env python3
"""MAA License/Workfile Verification Tool - Seller Tool

Reads .maa files, decrypts, verifies signatures, and displays content.

Usage:
    python test-license.py <file.maa>

Requires: cryptography (pip install cryptography)
Environment: MAA_ADMIN_SECRET - signing key for license verification
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
LICENSE_PREFIX = "MAA-V1:"
WORKFILE_PREFIX = "MAA-W1:"


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


def hmac_sha256(key: str, data: str) -> str:
    return hmac.new(key.encode('utf-8'), data.encode('utf-8'), hashlib.sha256).hexdigest()


def format_sig(hex_digest: str) -> str:
    return f"skadi-{hex_digest[:8]}-{hex_digest[8:16]}"


def decrypt_payload(base64_data: str) -> str:
    """AES-GCM decrypt from Base64."""
    key = hashlib.sha256(OBFUSCATE_KEY_SEED).digest()
    raw = base64.b64decode(base64_data)
    iv = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return plaintext.decode('utf-8')


def verify_license_signature(license_data: dict, admin_secret: str) -> bool:
    """Verify HMAC signature of license data."""
    sig = license_data.get("sig", "")
    # Rebuild canonical payload without sig
    payload_data = {k: v for k, v in license_data.items() if k != "sig"}
    canonical = canonical_json(payload_data)
    expected_hex = hmac_sha256(admin_secret, canonical)
    expected_sig = format_sig(expected_hex)
    return sig == expected_sig


def verify_client_state(workfile_data: dict, admin_secret: str) -> bool:
    """Verify client state signature in workfile."""
    license_data = workfile_data.get("license", {})
    client_state = workfile_data.get("client_state", {})
    
    if not client_state:
        print("  Warning: no client_state found")
        return True  # Not a verification failure
    
    # Verify license first
    if not verify_license_signature(license_data, admin_secret):
        print("  License signature in workfile: INVALID")
        return False
    
    # Derive client key
    license_sig = license_data.get("sig", "")
    derived_key = hmac_sha256(license_sig, "client-state-v1")
    
    # Verify client signature
    overrides = client_state.get("operator_elite_overrides", {})
    client_sig = client_state.get("client_sig", "")
    payload = canonical_json({"operator_elite_overrides": overrides})
    expected_client_sig = hmac_sha256(derived_key, payload)
    
    if client_sig != expected_client_sig:
        print(f"  Client signature: INVALID")
        print(f"    Expected: {expected_client_sig}")
        print(f"    Got:      {client_sig}")
        return False
    
    return True


def main():
    if len(sys.argv) < 2:
        print("Usage: python test-license.py <file.maa>")
        sys.exit(1)
    
    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f"Error: file not found: {filepath}")
        sys.exit(1)
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read().strip()
    
    # Detect file type
    if content.startswith(LICENSE_PREFIX):
        file_type = "LICENSE"
        base64_data = content[len(LICENSE_PREFIX):]
    elif content.startswith(WORKFILE_PREFIX):
        file_type = "WORKFILE"
        base64_data = content[len(WORKFILE_PREFIX):]
    else:
        print(f"Error: unrecognized file prefix")
        print(f"  Expected '{LICENSE_PREFIX}' or '{WORKFILE_PREFIX}'")
        print(f"  Got: '{content[:20]}...'")
        sys.exit(1)
    
    print(f"File type: {file_type}")
    print(f"File size: {len(content)} bytes")
    print()
    
    # Decrypt
    try:
        json_str = decrypt_payload(base64_data)
        data = json.loads(json_str)
    except Exception as e:
        print(f"Decryption FAILED: {e}")
        sys.exit(1)
    
    print("Decryption: SUCCESS")
    
    # Get admin secret for verification
    admin_secret = os.environ.get("MAA_ADMIN_SECRET", "")
    if not admin_secret:
        admin_secret = input("Enter admin secret (for signature verification): ").strip()
    
    if file_type == "LICENSE":
        # Verify license
        if admin_secret:
            valid = verify_license_signature(data, admin_secret)
            print(f"Signature: {'VALID' if valid else 'INVALID'}")
        else:
            print("Signature: SKIPPED (no admin secret provided)")
        
        # Display license content
        print(f"\n--- License Content ---")
        print(f"Version:    {data.get('version')}")
        print(f"Order Hash: {data.get('order_hash')}")
        print(f"Issued At:  {data.get('issued_at')}")
        print(f"Signature:  {data.get('sig')}")
        
        operators = data.get('operators', [])
        owned = [op for op in operators if op.get('own')]
        print(f"\nOperators:  {len(operators)} total, {len(owned)} owned")
        print(f"\nOwned operators:")
        for op in sorted(owned, key=lambda x: x.get('name', '')):
            print(f"  {op['name']:20s} E{op.get('elite', 0)} R{op.get('rarity', 0)} ({op['id']})")
        
        config = data.get('config', {})
        print(f"\nConfig:")
        print(f"  Layout:      {config.get('layout')}")
        print(f"  Description: {config.get('desc')}")
        print(f"  Trading:     {config.get('trading_stations_count')} stations")
        print(f"  Manufacturing: {config.get('manufacturing_stations_count')} stations")
        reqs = config.get('product_requirements', {})
        print(f"  Products:")
        for stype, prods in reqs.items():
            for prod, count in prods.items():
                print(f"    {stype}: {prod} x{count}")
    
    elif file_type == "WORKFILE":
        license_data = data.get('license', {})
        client_state = data.get('client_state', {})
        
        # Verify
        if admin_secret:
            valid = verify_client_state(data, admin_secret)
            print(f"Verification: {'ALL VALID' if valid else 'FAILED'}")
        else:
            print("Verification: SKIPPED (no admin secret provided)")
        
        # Display
        print(f"\n--- Workfile Content ---")
        print(f"License Order Hash: {license_data.get('order_hash')}")
        print(f"License Operators:  {len(license_data.get('operators', []))}")
        
        overrides = client_state.get('operator_elite_overrides', {})
        print(f"\nElite Overrides ({len(overrides)} operators modified):")
        ops_by_id = {op['id']: op for op in license_data.get('operators', [])}
        for op_id, elite in sorted(overrides.items()):
            op_name = ops_by_id.get(op_id, {}).get('name', op_id)
            original_elite = ops_by_id.get(op_id, {}).get('elite', '?')
            print(f"  {op_name:20s} E{original_elite} -> E{elite}")
        
        print(f"\nUpdated At:  {client_state.get('updated_at')}")
        print(f"Client Sig:  {client_state.get('client_sig', '')[:32]}...")


if __name__ == "__main__":
    main()
