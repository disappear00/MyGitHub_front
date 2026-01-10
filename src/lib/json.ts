export function safeParseJson<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'JSON 解析失败' }
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}
