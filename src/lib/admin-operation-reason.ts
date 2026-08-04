import { copy } from '../copy/index'

export interface AdminOperationReasonRequest {
  title: string
  description: string
  confirmLabel?: string
}

let cancelActiveRequest: (() => void) | null = null

export function requestAdminOperationReason(
  request: AdminOperationReasonRequest,
): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  cancelActiveRequest?.()

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    const titleId = `admin-operation-title-${crypto.randomUUID()}`
    const descriptionId = `admin-operation-description-${crypto.randomUUID()}`
    const errorId = `admin-operation-error-${crypto.randomUUID()}`
    dialog.className = 'w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-surface-3 bg-surface-1 p-0 text-ink-primary shadow-2xl backdrop:bg-black/55'
    dialog.setAttribute('aria-labelledby', titleId)
    dialog.setAttribute('aria-describedby', descriptionId)

    const form = document.createElement('form')
    form.className = 'space-y-4 p-5'
    form.noValidate = true

    const title = document.createElement('h2')
    title.id = titleId
    title.className = 'text-lg font-semibold text-ink-primary'
    title.textContent = request.title

    const description = document.createElement('p')
    description.id = descriptionId
    description.className = 'text-sm leading-6 text-ink-secondary'
    description.textContent = request.description

    const label = document.createElement('label')
    label.className = 'block'
    const labelText = document.createElement('span')
    labelText.className = 'mb-2 block text-sm font-medium text-ink-secondary'
    labelText.textContent = copy.common.lib_admin_operation_reason_001
    const textarea = document.createElement('textarea')
    textarea.className = 'tool-field min-h-28 resize-y'
    textarea.required = true
    textarea.minLength = 2
    textarea.maxLength = 500
    textarea.placeholder = copy.common.lib_admin_operation_reason_002
    textarea.setAttribute('aria-describedby', errorId)
    label.append(labelText, textarea)

    const error = document.createElement('p')
    error.id = errorId
    error.className = 'hidden text-sm text-danger'
    error.setAttribute('role', 'alert')

    const actions = document.createElement('div')
    actions.className = 'flex flex-wrap justify-end gap-2'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'tool-secondary-action'
    cancel.textContent = copy.common.lib_admin_operation_reason_003
    const confirm = document.createElement('button')
    confirm.type = 'submit'
    confirm.className = 'tool-primary-action'
    confirm.textContent = request.confirmLabel ?? copy.common.lib_admin_operation_reason_004
    actions.append(cancel, confirm)
    form.append(title, description, label, error, actions)
    dialog.append(form)
    document.body.append(dialog)

    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      if (cancelActiveRequest === cancelRequest) cancelActiveRequest = null
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      dialog.remove()
      resolve(value)
    }
    const cancelRequest = () => finish(null)
    cancelActiveRequest = cancelRequest
    cancel.addEventListener('click', cancelRequest)
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      cancelRequest()
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const reason = textarea.value.trim()
      if (reason.length < 2 || reason.length > 500) {
        error.textContent = copy.common.lib_admin_operation_reason_005
        error.classList.remove('hidden')
        textarea.setAttribute('aria-invalid', 'true')
        textarea.focus()
        return
      }
      finish(reason)
    })

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    textarea.focus()
  })
}
