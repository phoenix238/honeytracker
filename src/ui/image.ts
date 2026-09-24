// Receipt photos are shrunk on the phone before upload: a 12-megapixel photo is ~4MB, a
// readable receipt at 1600px is ~250KB. Smaller uploads work on patchy signal, and years of
// receipts stay well inside the database's free tier.

const MAX_EDGE = 1600;

export interface PreparedFile {
  filename: string;
  mime: string;
  dataBase64: string;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
}

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress photo'))), 'image/jpeg', 0.82),
  );
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === 'application/pdf') {
    if (file.size > 4 * 1024 * 1024) throw new Error('That PDF is over 4MB.');
    const url = await readAsDataUrl(file);
    return { filename: file.name, mime: 'application/pdf', dataBase64: url.slice(url.indexOf(',') + 1) };
  }
  // Every photo (HEIC included, where the browser can decode it) is re-encoded as JPEG.
  let blob: Blob = file;
  try {
    blob = await downscale(file);
  } catch {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('That photo format can’t be read here — try a screenshot or PDF.');
  }
  const url = await readAsDataUrl(blob);
  const mime = url.slice(5, url.indexOf(';'));
  return { filename: file.name.replace(/\.\w+$/, '') + '.jpg', mime, dataBase64: url.slice(url.indexOf(',') + 1) };
}
