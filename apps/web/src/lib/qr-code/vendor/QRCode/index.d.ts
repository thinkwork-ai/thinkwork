declare class QRCode {
  modules: boolean[][];
  constructor(typeNumber: number, errorCorrectLevel: number);
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
}

export default QRCode;
