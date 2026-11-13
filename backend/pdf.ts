import { extractText, getDocumentProxy } from 'unpdf';

export async function pdfArticle(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes, {
    useSystemFonts: false,
    useWorkerFetch: false,
    maxImageSize: 0,
  });
  try {
    if (pdf.numPages > 40) throw new Error('PDF exceeds the 40-page research limit');
    const { text } = await extractText(pdf, { mergePages: true });
    const escaped = text
      .slice(0, 70_000)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<article><pre>${escaped}</pre></article>`;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
