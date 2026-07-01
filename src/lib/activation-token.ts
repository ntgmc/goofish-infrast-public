import type { LicenseFile } from './types'

const TOKEN_PREFIX = 'maa-infrast-activation-token:'
const PENDING_TOKEN_KEY = `${TOKEN_PREFIX}pending`

export function getActivationTokenForLicense(license: LicenseFile): string {
  return getOrCreateToken(`${TOKEN_PREFIX}${license.order_hash}`)
}

export function getPendingActivationToken(): string {
  return getOrCreateToken(PENDING_TOKEN_KEY)
}

export function bindPendingActivationToken(license: LicenseFile): void {
  if (!canUseLocalStorage()) return
  const pending = window.localStorage.getItem(PENDING_TOKEN_KEY)
  if (!pending) return
  const key = `${TOKEN_PREFIX}${license.order_hash}`
  if (!window.localStorage.getItem(key)) {
    window.localStorage.setItem(key, pending)
  }
  window.localStorage.removeItem(PENDING_TOKEN_KEY)
}

function getOrCreateToken(key: string): string {
  if (!canUseLocalStorage()) return createToken()
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const next = createToken()
  window.localStorage.setItem(key, next)
  return next
}

function createToken(): string {
  const bytes = new Uint8Array(24)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}
