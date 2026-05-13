export const FACE_MATCH_THRESHOLD = 78

const SCALES = [1.0, 0.7, 0.5]

export function computeVisualSimilarity(src1: string, src2: string): Promise<number> {
  const SIZE = 48

  function toGrayVectors(src: string): Promise<number[][]> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const base = Math.min(img.width, img.height)
        const cx = img.width / 2
        const cy = img.height / 2
        const vecs: number[][] = []
        for (const scale of SCALES) {
          const crop = Math.max(Math.round(base * scale), 1)
          const sx = Math.max(cx - crop / 2, 0)
          const sy = Math.max(cy - crop / 2, 0)
          const canvas = document.createElement('canvas')
          canvas.width = SIZE
          canvas.height = SIZE
          const ctx = canvas.getContext('2d')
          if (!ctx) { vecs.push(Array(SIZE * SIZE).fill(0)); continue }
          ctx.drawImage(img, sx, sy, crop, crop, 0, 0, SIZE, SIZE)
          const data = ctx.getImageData(0, 0, SIZE, SIZE).data
          const gray: number[] = []
          for (let i = 0; i < data.length; i += 4) {
            gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
          }
          // Histogram equalization
          const hist = new Array(256).fill(0) as number[]
          for (const v of gray) hist[Math.round(v)]++
          const cdf: number[] = []
          let cum = 0
          for (let i = 0; i < 256; i++) { cum += hist[i]; cdf.push(cum) }
          const minCdf = cdf.find((v) => v > 0) ?? 0
          const total = gray.length
          vecs.push(gray.map((v) => ((cdf[Math.round(v)] - minCdf) / (total - minCdf)) * 255))
        }
        resolve(vecs)
      }
      img.src = src
    })
  }

  function pearson(a: number[], b: number[]): number {
    const n = a.length
    const ma = a.reduce((s, v) => s + v, 0) / n
    const mb = b.reduce((s, v) => s + v, 0) / n
    const na = a.map((v) => v - ma)
    const nb = b.map((v) => v - mb)
    const num = na.reduce((s, v, i) => s + v * nb[i], 0)
    const da = Math.sqrt(na.reduce((s, v) => s + v * v, 0))
    const db = Math.sqrt(nb.reduce((s, v) => s + v * v, 0))
    if (da === 0 || db === 0) return 50
    return (num / (da * db) + 1) / 2 * 100
  }

  return Promise.all([toGrayVectors(src1), toGrayVectors(src2)]).then(([vecs1, vecs2]) => {
    let best = 0
    for (const v1 of vecs1) {
      for (const v2 of vecs2) {
        best = Math.max(best, pearson(v1, v2))
      }
    }
    return Math.round(best * 10) / 10
  })
}
