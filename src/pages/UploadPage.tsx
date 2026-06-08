import { useState, useRef, useCallback } from 'react'

interface Props {
  onFileLoaded: (content: string) => Promise<void>;
  error: string | null;
}

export default function UploadPage({ onFileLoaded, error }: Props) {
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    setLoading(true)
    try {
      const content = await file.text()
      await onFileLoaded(content)
    } finally {
      setLoading(false)
    }
  }, [onFileLoaded])

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-md">
        {/* Header with breathing room */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-2 mb-6">
            <svg className="w-8 h-8 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-ink-primary mb-3">
            MAA 基建排班优化器
          </h1>
          <p className="text-ink-secondary text-base">
            VIP 基建售后服务
          </p>
        </div>

        {/* Upload card */}
        <div className="bg-surface-1 rounded-xl p-8">
          {error && (
            <div 
              className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-lg mb-6"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label 
                htmlFor="file-upload"
                className="block text-sm font-medium text-ink-secondary mb-3"
              >
                .maa 文件
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={() => setDragActive(false)}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
                role="button"
                tabIndex={0}
                aria-label="上传 .maa 文件"
                className={`
                  border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
                  transition-colors duration-150
                  ${dragActive 
                    ? 'border-brand-400 bg-brand-500/10' 
                    : 'border-surface-4 hover:border-brand-500/50'
                  }
                `}
              >
                <div className="space-y-3">
                  <div className="text-ink-muted">
                    <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-ink-secondary text-sm">
                    拖拽 .maa 文件到此处，或点击选择
                  </p>
                  <p className="text-ink-muted text-xs">
                    支持卖家下发的授权文件，或本工具保存的工作文件
                  </p>
                </div>
                <input
                  ref={fileRef}
                  id="file-upload"
                  type="file"
                  accept=".maa"
                  onChange={handleUpload}
                  className="hidden"
                  aria-label="选择 .maa 文件"
                />
              </div>
              <div className="mt-4 grid gap-3 text-left sm:grid-cols-2">
                <div className="rounded-lg bg-surface-2/60 p-3">
                  <p className="text-sm font-medium text-ink-primary">第一次使用</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    上传卖家给你的授权文件，用于生成排班。
                  </p>
                </div>
                <div className="rounded-lg bg-surface-2/60 p-3">
                  <p className="text-sm font-medium text-ink-primary">继续调整</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    上传之前保存的工作文件，继续上次的练度调整。
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleUpload}
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-150"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  验证中...
                </span>
              ) : (
                '验证并进入'
              )}
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-center text-ink-muted text-xs mt-6">
          .maa 是本工具识别的上传格式，文件内容已加密，无需打开查看。
        </p>
      </div>
    </div>
  )
}
