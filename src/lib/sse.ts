import { readAuthStorage } from './authStorage'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:9000'

export type SsePostOptions = {
  signal?: AbortSignal
  onData: (data: string) => void
  onEvent?: (event: string, data: string) => void
  onError?: (err: unknown) => void
}

export async function sseJsonPost(path: string, body: unknown, opts: SsePostOptions) {
  const token = readAuthStorage()?.accessToken
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Streaming body not supported')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const idx = buffer.indexOf('\n\n')
      if (idx < 0) break
      const eventBlock = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      const lines = eventBlock.split('\n')
      let eventName = 'message'
      const dataLines: string[] = []

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trimStart() || 'message'
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }

      for (const data of dataLines) {
        if (data === '[DONE]') return
      }

      const dataStr = dataLines.join('\n')
      if (dataStr === '[DONE]') return

      if (opts.onEvent) {
        try {
          opts.onEvent(eventName, dataStr)
        } catch (e) {
          opts.onError?.(e)
        }
      }

      if (eventName === 'message') {
        try {
          opts.onData(dataStr)
        } catch (e) {
          opts.onError?.(e)
        }
      }
    }
  }
}
