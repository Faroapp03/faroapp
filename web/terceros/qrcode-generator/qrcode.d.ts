// Tipos del adaptador de qrcode.js, basados en las firmas de dist/qrcode.d.ts del paquete.
export interface QRCode {
  addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
declare function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QRCode;
export default qrcode;
export declare const stringToBytes: (s: string) => number[];
