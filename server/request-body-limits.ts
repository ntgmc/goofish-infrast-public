export class RequestBodyTooLargeError extends Error {
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`Request body exceeds the ${limitBytes}-byte limit`)
    this.name = 'RequestBodyTooLargeError'
    this.limitBytes = limitBytes
  }
}
