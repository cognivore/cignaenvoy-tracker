/**
 * PDF Generator Service
 *
 * Generates PDF documents from text content.
 */

import PDFDocument from "pdfkit";
import * as fs from "node:fs";
import * as path from "node:path";

const GENERATED_DIR = "./data/generated";

/** Ensure the generated directory exists */
function ensureGeneratedDir(): void {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Format a date as YYYYMMDD
 */
function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Format a date for display (e.g., "19 January 2026")
 */
function formatDateForDisplay(date: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export interface DoctorNotesPdfInput {
  doctorNotes: string;
  treatmentDate: Date;
  patientName?: string;
  illnessName?: string;
  amount?: number;
  currency?: string;
}

export interface GeneratedPdf {
  filePath: string;
  fileName: string;
}

/**
 * Generate a PDF document containing doctor notes / progress report.
 *
 * The PDF is formatted as a professional progress report suitable
 * for insurance claim submission.
 */
export async function generateDoctorNotesPdf(
  input: DoctorNotesPdfInput
): Promise<GeneratedPdf> {
  ensureGeneratedDir();

  const dateStr = formatDateForFilename(input.treatmentDate);
  const fileName = `${dateStr}_Doctor_Notes.pdf`;
  const filePath = path.join(GENERATED_DIR, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Progress Report / Doctor's Notes", { align: "center" });

    doc.moveDown(0.5);

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Treatment Date: ${formatDateForDisplay(input.treatmentDate)}`, {
        align: "center",
      });

    doc.moveDown(2);

    // Patient info section (if provided)
    if (input.patientName || input.illnessName) {
      doc.fontSize(11).font("Helvetica-Bold").text("Patient Information");
      doc.moveDown(0.3);

      doc.fontSize(10).font("Helvetica");
      if (input.patientName) {
        doc.text(`Patient: ${input.patientName}`);
      }
      if (input.illnessName) {
        doc.text(`Condition: ${input.illnessName}`);
      }
      doc.moveDown(1.5);
    }

    // Treatment cost (if provided)
    if (input.amount !== undefined && input.currency) {
      doc.fontSize(11).font("Helvetica-Bold").text("Treatment Cost");
      doc.moveDown(0.3);

      const currencySymbol =
        input.currency === "GBP"
          ? "£"
          : input.currency === "EUR"
            ? "€"
            : input.currency === "USD"
              ? "$"
              : input.currency;
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Amount: ${currencySymbol}${input.amount.toFixed(2)}`);
      doc.moveDown(1.5);
    }

    // Progress report / doctor notes
    doc.fontSize(11).font("Helvetica-Bold").text("Progress Report");
    doc.moveDown(0.5);

    // Word-wrap and render the notes content
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(input.doctorNotes, {
        align: "left",
        lineGap: 4,
      });

    doc.moveDown(2);

    // Footer / disclaimer
    doc
      .fontSize(9)
      .fillColor("#333333")
      .text(
        `Doctor notes are a verbatim excerpt from practitioner's correspondence with patient.`,
        { align: "center" }
      );
    doc
      .fontSize(8)
      .fillColor("#666666")
      .text(
        `Generated for insurance submission, ${formatDateForDisplay(new Date())}.`,
        { align: "center" }
      );

    doc.end();

    stream.on("finish", () => {
      resolve({ filePath, fileName });
    });

    stream.on("error", reject);
  });
}
