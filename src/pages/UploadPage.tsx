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
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-gray-800 rounded-xl p-8 w-full max-w-md shadow-2xl">
        <h1 className="text-2xl font-bold text-center mb-2">🏭 MAA 基建排班优化器</h1>
        <p className="text-gray-400 text-center text-sm mb-6">VIP 基建售后服务</p>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
            ❌ {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">授权文件 / 工作文件</label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={() => setDragActive(false)}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition cursor-pointer ${
                dragActive ? 'border-blue-400 bg-blue-900/20' : 'border-gray-600 hover:border-gray-500'
              }`}
              onClick={() => fileRef.current?.click()}
            >
              <p className="text-gray-400 text-sm">拖拽 .maa 文件到此处，或点击选择</p>
              <input
                ref={fileRef}
                type="file"
                accept=".maa"
                onChange={handleUpload}
                className="hidden"
              />
            </div>
          </div>

          <button
            onClick={handleUpload}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded transition"
          >
            {loading ? '验证中...' : '验证并进入'}
          </button>
        </div>
      </div>
    </div>
  )
}
