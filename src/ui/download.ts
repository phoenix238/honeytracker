// Getting a file off the phone. In a home-screen app a plain download link is unreliable on an
// iPhone; the share sheet (Save to Files, Numbers, Mail…) always works, so it's tried first.

export async function shareOrDownload(url: string, fallbackName: string, mime: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(msg ?? `the server said ${res.status}`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
