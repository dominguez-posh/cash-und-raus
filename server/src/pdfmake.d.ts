// pdfmake 0.3 bringt keine Typen mit; hier nur der genutzte Teil.
declare module 'pdfmake' {
  interface Dokument {
    getBuffer(): Promise<Buffer>;
  }
  const pdfmake: {
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(f: (url: string) => boolean): void;
    setLocalAccessPolicy(f: (pfad: string) => boolean): void;
    createPdf(definition: Record<string, unknown>): Dokument;
  };
  export default pdfmake;
}
