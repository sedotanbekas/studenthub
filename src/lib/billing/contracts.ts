import type { AnyContract } from "@/lib/http/contract";
import { billingInvoiceContracts } from "./contracts-invoices";
import { billingReviewContracts } from "./contracts-review";
import { billingStudentContracts } from "./contracts-student";

/** Gabungan kontrak domain SPP; tiap bagian dimiliki satu berkas contracts-*.ts. */
export const billingContracts: readonly AnyContract[] = [
  ...billingInvoiceContracts,
  ...billingReviewContracts,
  ...billingStudentContracts,
];
