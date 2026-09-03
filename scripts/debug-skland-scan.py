#!/usr/bin/env python3
"""Run the production Skland scan flow and capture redacted HTTP diagnostics."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
import webbrowser


REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_SCRIPT = r"""
import { createHash } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outputDir = process.argv[1]
const secretPath = join(outputDir, 'skland-secrets.json')
const secrets = { created_at: new Date().toISOString() }

function emit(event) {
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n')
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function hidden(value) {
  const text = String(value)
  return { redacted: true, length: text.length, sha256: digest(text) }
}

function isSecretKey(key, url, direction, path) {
  const normalized = key.toLowerCase()
  if (['authorization', 'cookie', 'set-cookie', 'cred', 'token', 'scancode', 'scanid', 'sign'].includes(normalized)) {
    return true
  }
  if (normalized !== 'code') return false
  if (url.includes('/user/oauth2/v2/grant')) {
    return direction === 'request' || [...path, key].join('.') === 'data.code'
  }
  return direction === 'request' && url.includes('/user/auth/generate_cred_by_code')
}

function redact(value, url, direction, path = []) {
  if (Array.isArray(value)) return value.map((item, index) => redact(item, url, direction, [...path, String(index)]))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSecretKey(key, url, direction, path) && item !== null && item !== undefined
      ? hidden(item)
      : redact(item, url, direction, [...path, key]),
  ]))
}

function parseBody(text) {
  if (typeof text !== 'string' || !text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function describeUrl(rawUrl) {
  const parsed = new URL(rawUrl)
  return {
    origin: parsed.origin,
    path: parsed.pathname,
    query: redact(Object.fromEntries(parsed.searchParams), rawUrl, 'request'),
  }
}

function stageFor(url) {
  if (url.includes('/general/v1/gen_scan/login')) return 'create_scan'
  if (url.includes('/general/v1/scan_status')) return 'scan_status'
  if (url.includes('/user/auth/v1/token_by_scan_code')) return 'scan_token'
  if (url.includes('/user/oauth2/v2/grant')) return 'oauth_grant'
  if (url.includes('/user/auth/generate_cred_by_code')) return 'generate_cred'
  if (url.includes('/api/v1/auth/refresh')) return 'refresh_skland_token'
  if (url.includes('/api/v1/game/player/binding')) return 'list_bindings'
  return 'unknown'
}

async function persistSecrets() {
  await writeFile(secretPath, JSON.stringify(secrets, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await chmod(secretPath, 0o600)
}

async function captureSecrets(url, direction, body) {
  if (!body || typeof body !== 'object') return
  let changed = false
  const save = (key, value) => {
    if (typeof value !== 'string' || !value || secrets[key] === value) return
    secrets[key] = value
    changed = true
  }
  if (direction === 'response' && url.includes('/general/v1/gen_scan/login')) save('scan_id', body.data?.scanId)
  if (direction === 'response' && url.includes('/general/v1/scan_status')) save('scan_code', body.data?.scanCode)
  if (direction === 'response' && url.includes('/user/auth/v1/token_by_scan_code')) save('hypergryph_token', body.data?.token)
  if (direction === 'response' && url.includes('/user/oauth2/v2/grant')) save('oauth_code', body.data?.code)
  if (direction === 'response' && url.includes('/user/auth/generate_cred_by_code')) save('skland_cred', body.data?.cred)
  if (direction === 'response' && url.includes('/api/v1/auth/refresh')) save('skland_token', body.data?.token)
  if (changed) await persistSecrets()
}

await mkdir(outputDir, { recursive: true, mode: 0o700 })
await persistSecrets()

const selfTest = process.env.SKLAND_SCAN_DEBUG_SELF_TEST === '1'
const nativeFetch = selfTest ? async (input) => {
  const url = String(input instanceof Request ? input.url : input)
  const jsonResponse = (body) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Debug-Self-Test': '1' },
  })
  if (url.endsWith('/general/v1/gen_scan/login')) {
    return jsonResponse({ status: 0, msg: 'OK', data: { scanId: 'self-test-scan' } })
  }
  if (url.includes('/general/v1/scan_status')) {
    return jsonResponse({ status: 0, data: { scanCode: 'self-test-scan-code' } })
  }
  if (url.endsWith('/user/auth/v1/token_by_scan_code')) {
    return jsonResponse({ status: 0, msg: 'OK', data: { token: 'self-test-account-token' } })
  }
  if (url.endsWith('/user/oauth2/v2/grant')) {
    return jsonResponse({ msg: 'OK', data: { code: 'self-test-oauth-code' } })
  }
  if (url.endsWith('/api/v1/user/auth/generate_cred_by_code')) {
    return jsonResponse({ message: 'OK', data: { cred: 'self-test-skland-cred' } })
  }
  if (url.endsWith('/api/v1/auth/refresh')) {
    return jsonResponse({ code: 0, message: 'OK', data: { token: 'self-test-skland-token' }, timestamp: 1700000000 })
  }
  if (url.endsWith('/api/v1/game/player/binding')) {
    return jsonResponse({
      code: 0,
      message: 'OK',
      data: {
        list: [{
          appCode: 'arknights',
          defaultUid: '12345678',
          bindingList: [{ uid: '12345678', nickName: '自检账号', channelName: '官服' }],
        }],
      },
    })
  }
  throw new Error(`Unexpected self-test request: ${url}`)
} : globalThis.fetch
let requestId = 0
globalThis.fetch = async (input, init = {}) => {
  const id = ++requestId
  const rawUrl = String(input instanceof Request ? input.url : input)
  const stage = stageFor(rawUrl)
  const method = init.method || (input instanceof Request ? input.method : 'GET')
  const headers = Object.fromEntries(new Headers(init.headers || (input instanceof Request ? input.headers : undefined)))
  const requestText = typeof init.body === 'string' ? init.body : ''
  const requestBody = parseBody(requestText)
  const started = performance.now()
  emit({
    type: 'request',
    id,
    stage,
    method,
    url: describeUrl(rawUrl),
    application_headers: redact(headers, rawUrl, 'request'),
    body: redact(requestBody, rawUrl, 'request'),
    body_bytes: Buffer.byteLength(requestText),
    body_sha256: requestText ? digest(requestText) : null,
  })
  await captureSecrets(rawUrl, 'request', requestBody)
  try {
    const response = await nativeFetch(input, init)
    const responseText = await response.clone().text()
    const responseBody = parseBody(responseText)
    await captureSecrets(rawUrl, 'response', responseBody)
    emit({
      type: 'response',
      id,
      stage,
      status: response.status,
      status_text: response.statusText,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      headers: redact(Object.fromEntries(response.headers), rawUrl, 'response'),
      body: redact(responseBody, rawUrl, 'response'),
      body_bytes: Buffer.byteLength(responseText),
      body_sha256: responseText ? digest(responseText) : null,
    })
    return response
  } catch (error) {
    emit({
      type: 'network_error',
      id,
      stage,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      error: { name: error?.name, message: error?.message, cause: error?.cause?.message },
    })
    throw error
  }
}

const qrcodeModule = await import('qrcode')
const skland = await import('./server/handlers/skland-client.ts')
const QRCode = qrcodeModule.default

emit({
  type: 'session',
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    openssl: process.versions.openssl,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  output_dir: outputDir,
  secret_file: secretPath,
})

try {
  const scan = await skland.createHypergryphScan()
  secrets.scan_id = scan.scanId
  secrets.scan_url = scan.scanUrl
  await persistSecrets()

  const qrPath = join(outputDir, 'skland-scan.png')
  await QRCode.toFile(qrPath, scan.scanUrl, { width: 300, margin: 2, errorCorrectionLevel: 'M' })
  const terminalQr = await QRCode.toString(scan.scanUrl, { type: 'utf8', small: true, errorCorrectionLevel: 'M' })
  emit({ type: 'scan_ready', qr_path: qrPath, expires_at: scan.expiresAt, terminal_qr: terminalQr })

  const deadline = Math.min(Date.parse(scan.expiresAt), Date.now() + 120_000)
  let scanCode = null
  let attempt = 0
  while (!scanCode && Date.now() < deadline) {
    attempt += 1
    scanCode = await skland.getScanCode(scan.scanId)
    if (!scanCode) {
      emit({ type: 'pending', attempt, remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) })
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  if (!scanCode) throw new Error('二维码已过期，未取得 scanCode。')

  const accountToken = await skland.getHypergryphTokenByScanCode(scanCode)
  const cred = await skland.getCredByHypergryphToken(accountToken)
  secrets.skland_cred = cred
  await persistSecrets()
  const accounts = await skland.listSklandArknightsBindingsByCred(cred)
  emit({ type: 'complete', accounts, secret_file: secretPath })
} catch (error) {
  emit({
    type: 'fatal',
    error: { name: error?.name, message: error?.message, code: error?.code, http_status: error?.httpStatus, stack: error?.stack },
    secret_file: secretPath,
  })
  process.exitCode = 1
}
"""

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行真实森空岛扫码链路并保存脱敏诊断信息。")
    parser.add_argument("--no-open", action="store_true", help="不自动打开二维码 PNG。")
    parser.add_argument("--self-test", action="store_true", help="仅检查运行环境，不访问外部接口。")
    return parser.parse_args()


def node_command(script: str, *args: str) -> list[str]:
    return [
        "node",
        "--experimental-transform-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        script,
        *args,
    ]


def check_files() -> None:
    required = [
        REPO_ROOT / "server/handlers/skland-client.ts",
        REPO_ROOT / "node_modules/qrcode/package.json",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError("缺少运行文件，请先在仓库根目录执行 npm ci：" + ", ".join(missing))


def run_self_test() -> int:
    check_files()
    cache_dir = REPO_ROOT / ".cache"
    cache_dir.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="skland-scan-self-test-", dir=cache_dir) as temporary_dir:
        environment = os.environ.copy()
        environment["SKLAND_SCAN_DEBUG_SELF_TEST"] = "1"
        result = subprocess.run(
            node_command(NODE_SCRIPT, temporary_dir),
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            print(result.stderr.strip() or result.stdout.strip(), file=sys.stderr)
            return result.returncode

        events = [json.loads(line) for line in result.stdout.splitlines()]
        if not any(event.get("type") == "complete" for event in events):
            print("自检失败：模拟扫码链路未完成。", file=sys.stderr)
            return 1
        secret_path = Path(temporary_dir) / "skland-secrets.json"
        expected_secrets = {
            "scan_id": "self-test-scan",
            "scan_code": "self-test-scan-code",
            "hypergryph_token": "self-test-account-token",
            "oauth_code": "self-test-oauth-code",
            "skland_cred": "self-test-skland-cred",
            "skland_token": "self-test-skland-token",
        }
        saved_secrets = json.loads(secret_path.read_text(encoding="utf-8"))
        if any(saved_secrets.get(key) != value for key, value in expected_secrets.items()):
            print("自检失败：完整凭据文件缺少阶段数据。", file=sys.stderr)
            return 1
        if any(value in result.stdout for value in expected_secrets.values()):
            print("自检失败：脱敏日志包含明文凭据。", file=sys.stderr)
            return 1
        secret_mode = secret_path.stat().st_mode & 0o777
        if secret_mode != 0o600:
            print(f"自检失败：完整凭据文件权限为 {secret_mode:04o}，预期 0600。", file=sys.stderr)
            return 1
        if not (Path(temporary_dir) / "skland-scan.png").is_file():
            print("自检失败：未生成二维码文件。", file=sys.stderr)
            return 1
    print("自检通过：生产扫码链路、二维码、完整凭据保存和日志脱敏均正常。")
    return 0


def drain_stderr(stream: object, target: Path) -> None:
    with target.open("w", encoding="utf-8") as output:
        os.chmod(target, 0o600)
        for line in stream:  # type: ignore[union-attr]
            output.write(line)
            output.flush()
            print(f"[Node] {line.rstrip()}", file=sys.stderr)


def event_message(event: dict[str, object], no_open: bool) -> None:
    event_type = event.get("type")
    if event_type == "session":
        print(f"诊断目录：{event.get('output_dir')}")
        print("二维码过期后可分享 debug.jsonl；skland-secrets.json 含完整凭据，请勿发送或提交。")
    elif event_type == "request":
        print(f"→ {event.get('stage')} 请求")
    elif event_type == "response":
        body = event.get("body")
        message = body.get("message") or body.get("msg") if isinstance(body, dict) else None
        suffix = f"，消息：{message}" if message else ""
        print(f"← {event.get('stage')} HTTP {event.get('status')}，耗时 {event.get('duration_ms')} ms{suffix}")
    elif event_type == "scan_ready":
        qr_path = Path(str(event["qr_path"])).resolve()
        print(f"\n二维码已生成：{qr_path}")
        if not no_open and not webbrowser.open(qr_path.as_uri()):
            print("未找到可用的图片查看器，请打开上述 PNG，或扫描下方终端二维码。")
        print(str(event.get("terminal_qr", "")))
        print(f"请在 {event.get('expires_at')} 前使用森空岛扫码并确认授权。\n")
    elif event_type == "pending":
        print(f"等待扫码确认……第 {event.get('attempt')} 次，剩余约 {event.get('remaining_seconds')} 秒")
    elif event_type == "complete":
        accounts = event.get("accounts")
        count = len(accounts) if isinstance(accounts, list) else 0
        print(f"扫码授权及凭据校验成功，读取到 {count} 个明日方舟账号。")
    elif event_type in {"network_error", "fatal"}:
        error = event.get("error")
        message = error.get("message") if isinstance(error, dict) else error
        print(f"失败：{message}", file=sys.stderr)


def run_scan(no_open: bool) -> int:
    check_files()
    timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    output_dir = REPO_ROOT / ".cache" / f"skland-scan-debug-{timestamp}"
    output_dir.mkdir(parents=True, mode=0o700)
    os.chmod(output_dir, 0o700)
    debug_path = output_dir / "debug.jsonl"
    stderr_path = output_dir / "node-stderr.log"

    environment = os.environ.copy()
    environment.pop("SKLAND_SCAN_DEBUG_SELF_TEST", None)
    process = subprocess.Popen(
        node_command(NODE_SCRIPT, str(output_dir)),
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=1,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    stderr_thread = threading.Thread(target=drain_stderr, args=(process.stderr, stderr_path), daemon=True)
    stderr_thread.start()

    try:
        with debug_path.open("x", encoding="utf-8") as debug_file:
            os.chmod(debug_path, 0o600)
            for line in process.stdout:
                debug_file.write(line)
                debug_file.flush()
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    print(f"无法解析 Node 输出，原文已保存：{line.rstrip()}", file=sys.stderr)
                    continue
                event_message(event, no_open)
    except KeyboardInterrupt:
        print("\n已停止诊断。", file=sys.stderr)
        process.terminate()
    finally:
        return_code = process.wait()
        stderr_thread.join(timeout=2)

    print(f"脱敏诊断日志：{debug_path}")
    return return_code


def main() -> int:
    args = parse_args()
    try:
        return run_self_test() if args.self_test else run_scan(args.no_open)
    except (OSError, RuntimeError) as error:
        print(f"无法启动诊断：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
