import ExcelJS from "exceljs";
import { HEADER_LABELS, IMPORT_FIELDS, type ImportField } from "./headers";

/**
 * Templat XLSX impor siswa: sheet "Siswa" berisi header (kolom NISN/NIS/No HP berformat teks agar
 * nol depan tidak hilang) dan sheet "Kelas" berisi daftar nama kelas aktif sekolah.
 */
const TEXT_COLUMNS: readonly ImportField[] = ["nisn", "nis", "guardianPhone", "birthDate"];
const COLUMN_WIDTH: Readonly<Partial<Record<ImportField, number>>> = { name: 30, address: 40, guardianName: 25, birthPlace: 18, className: 14 };
const DEFAULT_WIDTH = 16;

function buildStudentSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Siswa");
  sheet.columns = IMPORT_FIELDS.map((field) => ({ header: HEADER_LABELS[field], key: field, width: COLUMN_WIDTH[field] ?? DEFAULT_WIDTH }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  TEXT_COLUMNS.forEach((field) => {
    sheet.getColumn(IMPORT_FIELDS.indexOf(field) + 1).numFmt = "@";
  });
  const gender = sheet.getCell(1, IMPORT_FIELDS.indexOf("gender") + 1);
  gender.note = "Isi L (laki-laki) atau P (perempuan).";
  const birthDate = sheet.getCell(1, IMPORT_FIELDS.indexOf("birthDate") + 1);
  birthDate.note = "Format DD/MM/YYYY, contoh 17/05/2012.";
  const className = sheet.getCell(1, IMPORT_FIELDS.indexOf("className") + 1);
  className.note = "Tulis persis seperti di sheet Kelas.";
}

function buildClassSheet(workbook: ExcelJS.Workbook, classNames: readonly string[]): void {
  const sheet = workbook.addWorksheet("Kelas");
  sheet.columns = [{ header: "Nama Kelas", key: "name", width: 20 }];
  sheet.getRow(1).font = { bold: true };
  classNames.forEach((name) => sheet.addRow({ name }));
}

export async function buildImportTemplate(classNames: readonly string[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Student Hub";
  buildStudentSheet(workbook);
  buildClassSheet(workbook, classNames);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
