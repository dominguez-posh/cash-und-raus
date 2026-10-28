// SheetJS (xlsx 0.18) bringt eigene Typen mit; hier nur die Namen, die das Bundle als Default-Import braucht.
declare module 'xlsx' {
  export interface CellObject {
    v?: string | number | boolean | Date;
    f?: string;
    t?: string;
  }
  export type WorkSheet = Record<string, CellObject | undefined> & { '!ref'?: string };
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet | undefined>;
  }
  const XLSX: {
    read(daten: Buffer | Uint8Array, opts?: { type?: 'buffer' | 'array'; cellDates?: boolean }): WorkBook;
    write(wb: WorkBook, opts: { type: 'buffer'; bookType: 'biff8' | 'xlsx' }): Buffer;
    utils: {
      book_new(): WorkBook;
      book_append_sheet(wb: WorkBook, ws: WorkSheet, name: string): void;
      aoa_to_sheet(daten: unknown[][]): WorkSheet;
      encode_cell(c: { r: number; c: number }): string;
    };
  };
  export default XLSX;
}
