// WhatsApp-style client-side image compression.
// Resizes the long edge down to `maxEdge` and re-encodes as JPEG at `quality`.
// This runs in the browser BEFORE upload, so we never send full-res photos.
export async function compressImage(file, { maxEdge = 1280, quality = 0.7 } = {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.')

  const dataUrl = await readAsDataURL(file)
  const img = await loadImage(dataUrl)

  let { width, height } = img
  const longEdge = Math.max(width, height)
  if (longEdge > maxEdge) {
    const scale = maxEdge / longEdge
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // white matte so transparent PNGs don't turn black when saved as JPEG
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not process that image. Try another.')
  return blob // ~50-200KB typical, down from several MB
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = () => rej(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('That image could not be loaded.'))
    img.src = src
  })
}

// Uploads a compressed image to the `post-photos` storage bucket and
// returns its public URL. `userId` namespaces the path for RLS.
export async function uploadPhoto(supabase, userId, file) {
  const blob = await compressImage(file)
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from('post-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('post-photos').getPublicUrl(path)
  return data.publicUrl
}
