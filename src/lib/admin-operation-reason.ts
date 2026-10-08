import { copy } from '../copy/index'

export interface AdminOperationReasonRequest {
  title: string
  description: string
  confirmLabel?: string
}

interface AdminEditField {
  name: string
  label: string
  value: string
  options?: Array<{ value: string; label: string }>
  required?: boolean
  maxLength?: number
}

let cancelActiveRequest: (() => void) | null = null

export function cancelAdminOperation() { cancelActiveRequest?.() }

export async function requestAdminOperationEdit(request: AdminOperationReasonRequest & {
  fields: AdminEditField[]
  onSubmit: (values: Record<string, string>, reason: string) => Promise<string | null>
  onRefresh?: () => Promise<void>
}): Promise<void> {
  await openAdminOperation(request)
}

export function requestAdminOperationReason(request: AdminOperationReasonRequest): Promise<string | null> {
  return openAdminOperation(request)
}

function openAdminOperation(request: AdminOperationReasonRequest & {
  fields?: AdminEditField[]
  onSubmit?: (values: Record<string, string>, reason: string) => Promise<string | null>
  onRefresh?: () => Promise<void>
}): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  cancelActiveRequest?.()

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    const titleId = `admin-operation-title-${crypto.randomUUID()}`
    const descriptionId = `admin-operation-description-${crypto.randomUUID()}`
    const errorId = `admin-operation-error-${crypto.randomUUID()}`
    dialog.className = 'w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-surface-3 bg-surface-1 p-0 text-ink-primary shadow-2xl backdrop:bg-black/55'
    if (document.querySelector('.admin-app')) dialog.classList.add('admin-dialog')
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
    const refresh = document.createElement('button')
    refresh.type = 'button'
    refresh.className = 'tool-secondary-action'
    refresh.textContent = copy.common.lib_admin_operation_refresh
    if (request.onRefresh) actions.append(refresh)
    actions.append(cancel, confirm)
    const fields = (request.fields ?? []).map((field) => {
      const wrapper = document.createElement('label')
      wrapper.className = 'block'
      const caption = document.createElement('span')
      caption.className = 'mb-2 block text-sm font-medium'
      caption.textContent = field.label
      const control = field.options ? document.createElement('select') : document.createElement('input')
      control.className = 'tool-field'
      control.name = field.name
      control.required = field.required ?? false
      if (control instanceof HTMLInputElement) control.maxLength = field.maxLength ?? 500
      if (control instanceof HTMLSelectElement) field.options?.forEach((option) => control.add(new Option(option.label, option.value)))
      control.value = field.value
      wrapper.append(caption, control)
      return { wrapper, control }
    })
    form.append(title, description, ...fields.map((field) => field.wrapper), label, error, actions)
    dialog.append(form)
    document.body.append(dialog)

    let settled = false
    let submitting = false
    let cancelRequested = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      if (cancelActiveRequest === cancelRequest) cancelActiveRequest = null
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      dialog.remove()
      resolve(value)
    }
    const cancelRequest = () => { if (submitting) cancelRequested = true; else finish(null) }
    cancelActiveRequest = cancelRequest
    cancel.addEventListener('click', cancelRequest)
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      cancelRequest()
    })
    refresh.addEventListener('click', async () => {
      if (submitting || settled || !request.onRefresh) return
      submitting = true
      const controls = [refresh, confirm, cancel]
      controls.forEach((control) => { control.disabled = true })
      dialog.setAttribute('aria-busy', 'true')
      try {
        await request.onRefresh()
        error.textContent = ''
        error.classList.add('hidden')
      } catch (caught) {
        error.textContent = caught instanceof Error ? caught.message : copy.common.lib_admin_operation_refresh_failed
        error.classList.remove('hidden')
      } finally {
        submitting = false
        controls.forEach((control) => { control.disabled = false })
        dialog.removeAttribute('aria-busy')
        if (cancelRequested) finish(null)
      }
    })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (submitting || settled) return
      if (fields.some(({ control }) => !control.reportValidity())) return
      const reason = textarea.value.trim()
      if (reason.length < 2 || reason.length > 500) {
        error.textContent = copy.common.lib_admin_operation_reason_005
        error.classList.remove('hidden')
        textarea.setAttribute('aria-invalid', 'true')
        textarea.focus()
        return
      }
      if (request.onSubmit) {
        submitting = true
        const controls = [...fields.map((field) => field.control), textarea, refresh, confirm, cancel]
        controls.forEach((control) => { control.disabled = true })
        dialog.setAttribute('aria-busy', 'true')
        try {
          const message = await request.onSubmit(Object.fromEntries(fields.map(({ control }) => [control.name, control.value.trim()])), reason)
          if (message) {
            error.textContent = message
            error.classList.remove('hidden')
            return
          }
        } catch (caught) {
          error.textContent = caught instanceof Error ? caught.message : copy.common.lib_admin_operation_reason_005
          error.classList.remove('hidden')
          return
        } finally {
          submitting = false
          controls.forEach((control) => { control.disabled = false })
          dialog.removeAttribute('aria-busy')
          if (cancelRequested) finish(null)
        }
      }
      finish(reason)
    })

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    ;(fields[0]?.control ?? textarea).focus()
  })
}
