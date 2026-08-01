import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage, uploadPhoto } from '../image'

// jsdom has no real canvas or image decoder, so the pipeline is stubbed to
// record what the code *asks* it to do. What is under test here is the
// resize maths, the JPEG re-encode settings and the upload path — not the
// browser's rasteriser.
let drawn
let toBlobArgs

function stubImagePipeline({ width, height, blob = new Blob(['x'], { type: 'image/jpeg' }) }) {
  drawn = null
  toBlobArgs = null

  vi.stubGlobal('Image', class {
    set src(_v) { queueMicrotask(() => this.onload?.()) }
    get width() { return width }
    get height() { return height }
  })

  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn((_img, _x, _y, w, h) => { drawn = { w, h } }),
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return Object.create(HTMLElement.prototype)
    return {
      width: 0, height: 0,
      getContext: () => ctx,
      toBlob: (cb, type, quality) => { toBlobArgs = { type, quality }; cb(blob) },
    }
  })
  return ctx
}

const imageFile = () => new File(['binary'], 'meal.png', { type: 'image/png' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compressImage', () => {
  it('rejects anything that is not an image', async () => {
    const pdf = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })
    await expect(compressImage(pdf)).rejects.toThrow(/choose an image file/i)
  })

  it('rejects a missing file', async () => {
    await expect(compressImage(null)).rejects.toThrow(/choose an image file/i)
  })

  it('scales the long edge down to 1280 and keeps the aspect ratio', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    await compressImage(imageFile())
    expect(drawn).toEqual({ w: 1280, h: 960 })
  })

  it('scales portrait photos by their height', async () => {
    stubImagePipeline({ width: 3000, height: 4000 })
    await compressImage(imageFile())
    expect(drawn).toEqual({ w: 960, h: 1280 })
  })

  it('leaves an already-small image at its original size', async () => {
    stubImagePipeline({ width: 800, height: 600 })
    await compressImage(imageFile())
    expect(drawn).toEqual({ w: 800, h: 600 })
  })

  it('re-encodes as JPEG at q0.7', async () => {
    stubImagePipeline({ width: 2000, height: 2000 })
    await compressImage(imageFile())
    expect(toBlobArgs).toEqual({ type: 'image/jpeg', quality: 0.7 })
  })

  it('honours an explicit maxEdge and quality', async () => {
    stubImagePipeline({ width: 2000, height: 1000 })
    await compressImage(imageFile(), { maxEdge: 500, quality: 0.9 })
    expect(drawn).toEqual({ w: 500, h: 250 })
    expect(toBlobArgs.quality).toBe(0.9)
  })

  // Transparent PNGs go black on a JPEG re-encode without a matte.
  it('paints a white matte before drawing so PNG transparency does not go black', async () => {
    const ctx = stubImagePipeline({ width: 100, height: 100 })
    await compressImage(imageFile())
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 100)
    expect(ctx.fillRect.mock.invocationCallOrder[0])
      .toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0])
  })

  it('reports a clear error when the encoder returns nothing', async () => {
    stubImagePipeline({ width: 100, height: 100, blob: null })
    await expect(compressImage(imageFile())).rejects.toThrow(/could not process that image/i)
  })
})

describe('uploadPhoto', () => {
  let storage, upload

  beforeEach(() => {
    stubImagePipeline({ width: 1000, height: 1000 })
    upload = vi.fn(async () => ({ error: null }))
    storage = {
      from: vi.fn(() => ({
        upload,
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      })),
    }
  })

  const supabase = () => ({ storage })

  // RLS on storage.objects only allows writes into <user_id>/, so the path
  // prefix is a security boundary, not a naming convention.
  it('namespaces the object under the user id, which is what storage RLS checks', async () => {
    await uploadPhoto(supabase(), 'user-123', imageFile())
    const [path] = upload.mock.calls[0]
    expect(path.startsWith('user-123/')).toBe(true)
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('uploads to the post-photos bucket as JPEG without overwriting', async () => {
    await uploadPhoto(supabase(), 'user-123', imageFile())
    expect(storage.from).toHaveBeenCalledWith('post-photos')
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false })
  })

  it('returns the public URL of the stored object', async () => {
    const url = await uploadPhoto(supabase(), 'user-123', imageFile())
    expect(url).toMatch(/^https:\/\/cdn\.test\/user-123\/.+\.jpg$/)
  })

  it('propagates an upload failure instead of returning a broken URL', async () => {
    upload.mockResolvedValue({ error: new Error('bucket not found') })
    await expect(uploadPhoto(supabase(), 'user-123', imageFile()))
      .rejects.toThrow('bucket not found')
  })

  it('never uploads a file that failed validation', async () => {
    const pdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })
    await expect(uploadPhoto(supabase(), 'user-123', pdf)).rejects.toThrow()
    expect(upload).not.toHaveBeenCalled()
  })
})
