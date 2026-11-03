import { sha256 } from './evidence.ts'

type SaveHandle = {
  name: string
  createWritable(): Promise<{
    write(data: string): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
  getFile(): Promise<File>
}

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<SaveHandle>
  }
}

export async function saveEvidenceFile(prepare: () => Promise<string>, suggestedName: string) {
  if (!window.showSaveFilePicker)
    throw new Error('浏览器不支持保存对话框，请使用“下载副本与文件校验”。')
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'JSON研究证据包', accept: { 'application/json': ['.json'] } }],
  })
  const text = await prepare()
  const writer = await handle.createWritable()
  try {
    await writer.write(text)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  }
  const saved = await handle.getFile()
  if ((await sha256(await saved.text())) !== (await sha256(text)))
    throw new Error('文件写入后的内容校验失败，请重新导出。')
  return handle.name
}
