"use client";
import type { ReactNode } from "react";
import { BulkInvoiceWizard } from "./bulk-invoice-wizard";
import { ImportStudentsWizard } from "./import-students-wizard";
import { ReportWizard } from "./report-wizard";
import { SchoolRegistrationWizard } from "./school-registration-wizard";
import type { CustomActionProps } from "./wizard-kit";

/**
 * Operasi halaman yang dibuka sebagai wizard berpanduan, bukan formulir generik. Formulir generik (semua kolom
 * API) tetap bisa dibuka dari tautan "formulir lengkap" di wizard (onFallback).
 */
export const WIZARD_ACTIONS: Readonly<Record<string, (props: CustomActionProps) => ReactNode>> = {
  importSchoolStudents: (props) => <ImportStudentsWizard {...props} />,
  bulkCreateSchoolInvoices: (props) => <BulkInvoiceWizard {...props} />,
  upsertReportCardGrades: (props) => <ReportWizard {...props} />,
  publishReportCards: (props) => <ReportWizard {...props} />,
  createPlatformSchool: (props) => <SchoolRegistrationWizard {...props} />,
};
