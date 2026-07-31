export class SettingsConflictError extends Error {
  constructor() {
    super('Settings were updated by another administrator.')
    this.name = 'SettingsConflictError'
  }
}
