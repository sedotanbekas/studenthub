# Student Hub: academic data and SPP billing design

The design is complete, but seven points need the client's input before implementation; they are listed in section 7. Nothing was written, installed or migrated. I read only lims-sotoy's finance and numbering modules to match their conventions.

Endpoint paths below are relative to `/api/v1`. Role abbreviations used throughout:
- **SA** = SCHOOL_ADMIN. The school comes from the session.
- **SU** = SUPER_ADMIN. It must pass `?schoolId=` on every `/school/*` call.
- **ST** = STUDENT.

All responses use the envelope `{success, data, error, meta}`.

---

## 1. Decisions

| # | Decision | Justification |
|---|---|---|
| D1 | Report-card scores are integers 0–100 (`UnsignedTinyInt`), not Decimal(5,2). | e-Rapor K13 and Merdeka final grades are whole numbers. Integers avoid Prisma Decimal serialisation and float comparisons at thresholds. (SCR-1) |
| D2 | The predicate uses the K13 interval method relative to KKM, computed with integer arithmetic only. It is computed live while the report card is DRAFT. On publish it is frozen together with the subject name and KKM snapshot. | Matches the official K13 tables (KKM 75 gives A ≥ 92, B ≥ 84, C ≥ 75). Freezing at publish means a later KKM change never alters a published report card. |
| D3 | A class's curriculum is an explicit `ClassSubject` mapping. Grades can only be entered for mapped subjects. Publishing requires every mapped subject to be graded. | This gives "validation before submit" a concrete meaning. It also handles IPA and IPS classes having different subjects. (SCR-3) |
| D4 | A `ReportCard` row is created lazily on the first grade write (or explicitly). Its class is copied from the student's current class. It can only be edited while DRAFT. Publish and unpublish work in batches per class; unpublishing needs a reason. | Admins enter grades by class and subject, and a snapshot keeps the report card correct after promotion. |
| D5 | Report-card extras: a homeroom note (≤ 1000 characters), a snapshot of the homeroom teacher's name, and sick / permitted / absent day counts taken from Attendance at publish. Extracurricular and attitude sections are out of scope until the client asks. | Standard report-card sections, and the attendance data already exists. (SCR-2, SCR-4) |
| D6 | The stored `Invoice.status` records money only: UNPAID / PARTIAL / PAID / VOID. "Menunggu verifikasi" and "Jatuh tempo" are derived display statuses. | A stored PENDING_VERIFICATION would be a second writer of status and would drift from `paidAmount`. |
| D7 | Partial payments are allowed (PARTIAL), switchable with the constant `ALLOW_PARTIAL_PAYMENT`. The "Belum Lunas" card counts UNPAID plus PARTIAL. | A transfer that arrives short because of bank fees must be approvable for the amount actually received. (Q2) |
| D8 | At most one PENDING submission per invoice. This is enforced by the invoice row lock and by a unique column, `PaymentSubmission.pendingInvoiceId`. Recording a cash payment is blocked while a submission is pending. | Same pattern as `activeNisn` and `billableDate`. Blocking cash prevents one transfer being counted twice. (SCR-8) |
| D9 | Overpayment is impossible. Every payment is ≤ the remaining amount, checked under `Invoice FOR UPDATE`, and a CHECK constraint makes the stored status match `paidAmount`. | The database is the last line of defence for money. |
| D10 | Invoice and receipt numbers come from one `DocumentCounter` row per (school, kind, local year), incremented in the same transaction as the document. Format: `INV-2026-000123` and `KWT-2026-000123`, unique per school. A voided payment keeps its number. | No races and no gaps, because a rollback also reverts the increment. It avoids lims' "MAX + 1 then retry on P2002" loop. (SCR-6, SCR-7, SCR-9) |
| D11 | Each student has an SPP rate, `Student.sppAmount`: NULL means use the bulk default, 0 means exempt (full scholarship). Each request can also override per student. | The monthly bulk run becomes a single call even with scholarships. (SCR-5, Q1) |
| D12 | Bulk invoice generation only bills ACTIVE students. It is idempotent by filtering out existing (student, SPP, period) rows while holding the counter lock, not by `createMany({skipDuplicates})`. It supports `dryRun`. | On MariaDB, `skipDuplicates` becomes INSERT IGNORE, which also silently drops rows that fail CHECK or FK constraints. **This is a flaw in the schema note "bulk generation uses skipDuplicates".** |
| D13 | A VOID invoice keeps its period slot (as the schema says). To correct it: restore (VOID → UNPAID), then edit. An invoice can only be voided when `paidAmount = 0` and nothing is pending. | Keeps the history of the slot intact. |
| D14 | A payment's date is `paidDate @db.Date` (the local date the money arrived, or the transfer date), not an instant. | Follows the schema's convention for local dates and is what bank reconciliation needs. (SCR-7) |
| D15 | Proof of payment is uploaded as one multipart request carrying both the fields and the file.<br>• Images (JPEG/PNG/WebP, detected with sharp, not from the header) are re-encoded to JPEG with a 2000 px long edge.<br>• PDFs up to 5 MB are accepted after a `%PDF-` magic-byte check. They are never re-encoded and are served only as a download, with `Content-Security-Policy: sandbox` and `nosniff`.<br>• If the same sha256 is already on a PENDING or APPROVED submission, the request fails with 409. | One request means no orphaned rows. Re-encoding neutralises polyglot images, and a repeated hash signals a reused proof. |
| D16 | The student lifecycle lives in `Student.status`. `User.isActive` mirrors it and is written in the same transaction, so the generic per-request check keeps working. Leaving ACTIVE (except to GRADUATED) increments `tokenVersion` and revokes sessions. | One source of truth for status, and access tokens die immediately. |
| D17 | NISN can only be changed while the student is DRAFT, because it is the login key. NIS can always be edited. If the NISN is held by a live enrolment at another school, the request fails with 409 without naming that school. | Protects the login key and does not leak data across tenants. |
| D18 | The initial password is either supplied by the admin or generated by the server (10 characters, no ambiguous characters). A generated password is returned exactly once and `mustChangePassword` is set to true. | Meets the client's first-login rule, and no plaintext is ever stored. |
| D19 | Year-end promotion is an explicit mapping from each old class to a new class, or to GRADUATE. Per-student overrides allow RETAIN (stay back a grade) or SKIP. A preview endpoint comes first. Execution is idempotent through `WHERE currentClassId = fromClassId` and is serialised by locking the School row. | Safe to re-run, and predictable. |
| D20 | SU can call every `/school/*` endpoint, but must pass `schoolId`. If SA passes a different `schoolId`, the request fails with 403. An id belonging to another tenant returns 404. | Tenant isolation happens in the service layer, as the lead chose. |
| D21 | Every money or state mutation runs inside `withTx`: `FOR UPDATE` first, then retry on P2034 up to 3 times, with `{timeout:20000, maxWait:10000}`; bulk transactions use a 60 s timeout. Lock order is fixed:<br>• School → SchoolClass → ReportCard (by id ascending)<br>• Student → Invoice (by id ascending) → PaymentSubmission → Payment → DocumentCounter | Same pattern as lims `transaksiPesanan`. |
| D22 | Every "today" comparison uses the school's local date: WIB = +7, WITA = +8, WIT = +9, no DST. The shared `src/lib/time/local-date.ts` handles this, and `@db.Date` values are stored as UTC midnight. | Due dates, overdue checks and transfer dates are all local dates. |
| D23 | Bulk grade entry is all-or-nothing and returns errors per row. Bulk student import takes JSON (≤ 500 rows; the frontend parses the spreadsheet), supports `dryRun`, and returns a result per row. | Matches the admin workflow. |
| D24 | Errors have the shape `error: {code, message, details?}`. Status codes:<br>• 400: zod validation, with field errors<br>• 403: role or scope not allowed<br>• 404: not found or another tenant's data<br>• 409: the current state forbids it, or a concurrency conflict<br>• 422: the request is valid but breaks a business rule | Stable codes the frontend can switch on; messages are in Indonesian. |

---

## 2. Endpoints

### Academic structure (SA, SU)

| METHOD | PATH | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|
| GET | /school/academic-years | List academic years with their terms | – | `[{id,name,startDate,endDate,terms[{id,semester,label,startDate,endDate,isActive}]}]` |
| POST | /school/academic-years | Create | `name` ("2026/2027"), `startDate`, `endDate` | academicYear |
| PATCH | /school/academic-years/:id | Edit (the range must still contain its terms) | `name?`, `startDate?`, `endDate?` | academicYear |
| DELETE | /school/academic-years/:id | Delete, only if it has no terms or classes | – | `{id}` |
| POST | /school/academic-years/:id/terms | Add a semester | `semester` (GANJIL\|GENAP), `startDate`, `endDate` | term |
| PATCH | /school/terms/:id | Edit dates | `startDate?`, `endDate?` | term |
| DELETE | /school/terms/:id | Delete, only if not active and it has no report cards | – | `{id}` |
| GET | /school/active-term | Get the active semester | – | `{term, label, academicYear}` or null |
| PUT | /school/active-term | Set the active semester | `termId` | `{term, label}` |

### Classes and subjects (SA, SU)

| METHOD | PATH | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|
| GET | /school/classes | List classes | `academicYearId?` (defaults to the active term's year), `isActive?`, `gradeLevel?` | `[{id,name,gradeLevel,isActive,homeroomTeacherName,activeStudentCount,subjectCount}]` |
| POST | /school/classes | Create | `academicYearId`, `name`, `gradeLevel`, `homeroomTeacherName?` | class |
| PATCH | /school/classes/:id | Edit or deactivate | `name?`, `gradeLevel?`, `homeroomTeacherName?`, `isActive?` | class |
| DELETE | /school/classes/:id | Delete, only if unreferenced | – | `{id}` |
| GET | /school/classes/:id/subjects | The class's subjects | – | `[{subjectId,code,name,kkm,sortOrder}]` |
| PUT | /school/classes/:id/subjects | Replace the mapping | `subjectIds[]` (array order = sortOrder) | the same list, plus `orphanGradeCount` |
| POST | /school/classes/:id/subjects/copy | Copy another class's mapping | `sourceClassId` | the same list |
| GET | /school/subjects | List subjects | `isActive?` | `[{id,code,name,kkm,sortOrder,isActive}]` |
| POST | /school/subjects | Create | `code`, `name`, `kkm`, `sortOrder?` | subject |
| PATCH | /school/subjects/:id | Edit | `code?` (only if never graded), `name?`, `kkm?`, `sortOrder?`, `isActive?` | subject |
| DELETE | /school/subjects/:id | Delete, only if unreferenced | – | `{id}` |
| POST | /school/promotions/preview | Plan a promotion | `fromAcademicYearId`, `toAcademicYearId`, `moves[{fromClassId, action: PROMOTE\|GRADUATE, toClassId?}]`, `overrides[{studentId, action: PROMOTE\|RETAIN\|GRADUATE\|SKIP, toClassId?}]` | `{items[{fromClass,action,toClass,studentCount}], overrides[], warnings[{code,…}], errors[]}` |
| POST | /school/promotions | Run the promotion | the same fields plus `acknowledgeWarnings: true` | `{promoted, retained, graduated, skipped, alreadyMoved}` |

### Students

| METHOD | PATH | ROLE | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|---|
| GET | /school/students | SA, SU | Search | `q?`, `classId?`, `status?` (comma list; default `ACTIVE,INACTIVE,DRAFT`), `gender?`, `page`, `limit`, `sort` = name\|nis\|createdAt, `order` | `items[{id,name,nisn,nis,gender,status,class{id,name},mustChangePassword,lastLoginAt}]`, `meta{total,page,limit}` |
| GET | /school/students/:id | SA, SU | Detail | – | biodata, class, `sppAmount`, `user{isActive,mustChangePassword,lastLoginAt}`, `missingForActivation[]` |
| POST | /school/students | SA, SU | Create | `name`, `nisn`, `nis`, `gender`, `birthPlace?`, `birthDate?`, `address?`, `guardianName?`, `guardianPhone?`, `currentClassId?`, `sppAmount?`, `initialPassword?`, `activate?` | `{student, temporaryPassword?` (shown once)`, missingForActivation[]}` |
| POST | /school/students/bulk | SA, SU | Import | `rows[≤500]` (same shape as create), `dryRun`, `activate?` | `{created, results[{row, status: CREATED\|INVALID\|CONFLICT, studentId?, temporaryPassword?, errors[]}]}` |
| PATCH | /school/students/:id | SA, SU | Edit biodata or class | any create field except status; `nisn` only while DRAFT | student |
| POST | /school/students/:id/activate | SA, SU | DRAFT or INACTIVE → ACTIVE | – | student; 422 `STUDENT_INCOMPLETE{missing[]}` |
| POST | /school/students/:id/status | SA, SU | Deactivate, graduate, move or reactivate | `to` (INACTIVE\|GRADUATED\|MOVED\|ACTIVE), `reason` (5–255 characters), `voidFutureInvoices?` (default true for MOVED) | `{student, voidedInvoiceIds[]}` |
| POST | /school/students/:id/reset-password | SA, SU | Reset password | `newPassword?` | `{temporaryPassword?}` |
| DELETE | /school/students/:id | SA, SU | Delete, only DRAFT with no references | – | `{id}` |
| GET | /me/student-profile | ST | Own read-only biodata | – | `{name,nisn,nis,gender,class{name},school{name},status}` |

### Report cards

| METHOD | PATH | ROLE | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|---|
| GET | /school/report-cards/sheet | SA, SU | Grade grid for one class and subject | `termId`, `classId`, `subjectId` | `{term, class, subject{id,name,kkm}, rows[{studentId,name,nis,reportCardId?,reportCardStatus?,score?,predicate?,description?}]}` |
| PUT | /school/report-cards/grades | SA, SU | Bulk upsert per class and subject | `termId`, `classId`, `subjectId`, `entries[≤100 {studentId, score: int\|null, description?}]` | `{updated, deleted, createdReportCards}`; 400 `{rowErrors[{index,studentId,code,message}]}`; 409 `REPORT_CARD_PUBLISHED{studentIds}` |
| GET | /school/report-cards | SA, SU | List | `termId` (defaults to active), `classId?`, `status?`, `q?`, `page`, `limit` | `items[{id,student{id,name,nis},className,status,gradedCount,expectedCount,average,publishedAt}]` |
| POST | /school/report-cards | SA, SU | Create an empty DRAFT for one student | `studentId`, `termId` | reportCard |
| GET | /school/report-cards/:id | SA, SU | Detail | – | report card plus `grades[{subjectId,subjectName,kkm,score,predicate,description}]`, `missingSubjectIds`, `attendanceSummary`, `average` |
| PATCH | /school/report-cards/:id | SA, SU | Homeroom teacher's note | `homeroomNote` (≤ 1000; null clears it) | reportCard |
| PUT | /school/report-cards/:id/grades | SA, SU | Edit one student's grades | `grades[≤40 {subjectId, score\|null, description?}]` | reportCard |
| DELETE | /school/report-cards/:id | SA, SU | Delete, only DRAFT (grades cascade) | – | `{id}` |
| GET | /school/report-cards/readiness | SA, SU | Check before publishing | `termId`, `classId` | `{ready[], incomplete[{reportCardId,studentId,missingSubjectIds}], noReportCard[studentId], published[]}` |
| POST | /school/report-cards/publish | SA, SU | Publish per class | `termId`, `classId`, `studentIds?` (≤ 100) | `{publishedIds[], notified}`; 422 `REPORT_CARD_INCOMPLETE{incomplete[]}` |
| POST | /school/report-cards/unpublish | SA, SU | Return to DRAFT | `reportCardIds[≤100]`, `reason` | `{unpublishedIds[]}` |
| GET | /me/report-cards | ST | Own report cards, PUBLISHED only | – | `[{id,termLabel,className,publishedAt,average}]` |
| GET | /me/report-cards/:id | ST | Own report card, PUBLISHED only (otherwise 404) | – | `{termLabel,className,homeroomTeacherName,homeroomNote,grades[],attendance{sick,permit,absent},average}` |

### Stats (SA, SU)

| METHOD | PATH | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|
| GET | /school/stats/academic | Student and report-card cards | `termId?` | `{students{active,inactive,draft,graduated,moved}, term{id,label}\|null, reportCards{activeStudents,studentsWithGrades,studentsComplete,published}\|null}` |
| GET | /school/stats/billing | SPP cards | `periodYear?`, `periodMonth?` | `{studentsNotFullyPaid, studentsOverdue, outstandingAmount, pendingVerification, period?{invoiced,paid,partial,unpaid,void,billedAmount,collectedAmount}}` |

### SPP billing, admin (SA, SU)

| METHOD | PATH | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|
| GET | /school/invoices | List | `periodYear?`, `periodMonth?`, `status?` (comma list; may include the derived OVERDUE and PENDING_VERIFICATION), `classId?`, `studentId?`, `q?`, `page`, `limit` | `items[{id,invoiceNo,student{id,name,nis,className},title,periodYear,periodMonth,amount,paidAmount,remaining,dueDate,status,displayStatus,isOverdue,pendingSubmissionId}]` |
| GET | /school/invoices/:id | Detail | – | invoice plus `payments[{id,receiptNo,amount,method,paidDate,voidedAt,voidReason}]` and `submissions[{id,status,amount,transferDate,reviewNote}]` |
| POST | /school/invoices | Create one | `studentId`, `periodYear`, `periodMonth`, `amount`, `dueDate?`, `title?`, `note?`, `notify?` (default true) | invoice |
| POST | /school/invoices/bulk | Generate a month | `periodYear`, `periodMonth`, `amount` (default rate), `dueDate?`, `title?`, `scope` (`{type:SCHOOL}` \| `{type:CLASSES,classIds[]}` \| `{type:STUDENTS,studentIds[]}`), `overrides[{studentId,amount}]`, `dryRun`, `notify` | `{created, totalAmount, invoiceNoFrom, invoiceNoTo, skippedCount, skipped[≤500 {studentId, reason: ALREADY_BILLED\|EXEMPT}]}` |
| PATCH | /school/invoices/:id | Edit | `amount?`, `dueDate?`, `title?`, `note?` | invoice |
| POST | /school/invoices/:id/void | Cancel | `reason` | invoice |
| POST | /school/invoices/:id/restore | Undo a cancel (VOID → UNPAID) | – | invoice |
| POST | /school/invoices/:id/payments | Record a cash payment | `amount`, `paidDate`, `note?` | `{payment{id,receiptNo}, invoice}` |
| POST | /school/payments/:id/void | Correct a payment | `reason` | `{payment, invoice}` |
| GET | /school/payments/:id/receipt | Receipt data | – | `{receiptNo,school{name,npsn,address},student{name,nis,className},invoice{invoiceNo,title},amount,method,paidDate,recordedBy,voided}` |
| GET | /school/payment-submissions | Verification queue | `status` (default PENDING), `classId?`, `q?`, `page`, `limit` | `items[{id,invoice{id,invoiceNo,title,remaining},student{name,nis,className},amount,transferDate,senderName,senderBank,createdAt,proofFileId,duplicateProof}]` |
| GET | /school/payment-submissions/:id | Detail | – | submission plus invoice, proof link (`/files/:id`), student's submission history |
| POST | /school/payment-submissions/:id/approve | Approve | `approvedAmount?`, `note?` | `{submission, payment{receiptNo}, invoice}` |
| POST | /school/payment-submissions/:id/reject | Reject | `reason` (5–255 characters) | submission |
| PUT | /school/billing-settings | Bank account shown to students | `bankName`, `bankAccountNumber`, `bankAccountHolder` | settings. **Drop this if the school-settings domain already owns these fields.** |

### SPP billing, student (ST)

| METHOD | PATH | Purpose | Key request fields | Key response fields |
|---|---|---|---|---|
| GET | /me/invoices | Own invoices | `filter` = OUTSTANDING\|PAID\|ALL (default OUTSTANDING; VOID hidden), `page`, `limit` | `items[{id,invoiceNo,title,periodYear,periodMonth,amount,paidAmount,remaining,dueDate,displayStatus,isOverdue,pendingSubmission?{id,amount,createdAt}}]`, `meta`, `summary{outstandingAmount}` |
| GET | /me/invoices/:id | Invoice detail | – | invoice plus `payments[{id,receiptNo,amount,method,paidDate,voided}]`, `submissions[{id,status,amount,transferDate,reviewNote,createdAt}]`, `bankAccount` |
| GET | /me/payment-info | School's bank account for SPP transfers | – | `{bankName,bankAccountNumber,bankAccountHolder}` |
| POST | /me/invoices/:id/submissions | Upload proof of transfer (`multipart/form-data`) | `amount`, `transferDate`, `senderName`, `senderBank`, `note?`, `file` | submission |
| POST | /me/payment-submissions/:id/cancel | Cancel own PENDING submission | – | submission |
| GET | /me/payments/:id/receipt | Receipt for own payment | – | receipt |

**Code-level permission map:**
- `academic.read`, `academic.write`, `students.write`, `reportCards.publish`, `billing.read`, `billing.write` and `billing.verify` map to SCHOOL_ADMIN and SUPER_ADMIN.
- `me.academic` and `me.billing` map to STUDENT.

**Proof files** are served by the platform route `GET /files/:id`. PAYMENT_PROOF may be read by the student who uploaded it, SA of `file.schoolId`, and SU.

---

## 3. Business rules and algorithms

### A. Common constants and rules
1. Pagination: `DEFAULT_PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`. A page past the end returns `items: []` with the correct `total`.
2. Scope: `resolveSchoolScope(actor, requestedSchoolId)`.
   - SU with no `schoolId`: 400 `SCHOOL_ID_REQUIRED`.
   - SA whose requested id differs from the session's: 403 `FORBIDDEN_SCOPE`.
   - Every lookup uses `findFirst({where:{id, schoolId}})`. A miss returns 404 whether the row is absent or belongs to another tenant.
3. Parent and child must belong to the same school: `class.schoolId`, `term.schoolId`, `subject.schoolId`, the student's school and the invoice's school must all equal `scope.schoolId` before any write.
4. Local dates: `today = todayLocal(school.timezone, now)` as `"YYYY-MM-DD"`. `periodKey(y, m) = y*12 + (m-1)`.
5. Text inputs: trimmed, runs of spaces collapsed, and an empty string becomes null for optional fields.
6. Notification text is in Indonesian. Pushes are delivered by the notification domain's worker; this domain only inserts `Notification` rows inside its own transaction.

### B. Academic years, terms, classes, subjects
1. Academic year `name` must match `^(\d{4})\/(\d{4})$` with the second year equal to the first plus 1. Also:
   - `startDate < endDate` and the span is ≤ `MAX_ACADEMIC_YEAR_DAYS = 400`.
   - It must not overlap another academic year of the same school.
   - Editing it must still contain all its terms.
2. Terms must lie inside their academic year, with a span ≤ `MAX_TERM_DAYS = 200`. There is one term per semester (unique). GANJIL must end before GENAP starts.
   - Label (derived): `Semester Ganjil 2025/2026`.
   - A term can be deleted only if it is not active and has no report cards.
3. Setting the active term writes `School.activeTermId` after checking the term's school, and writes an audit entry. It does not change any other data; it only sets the default for grade entry and stats.
4. Class names: 1–50 characters, unique per academic year (P2002 gives 409 `CLASS_NAME_TAKEN`). `gradeLevel` is 1–12.
   - Deactivation needs `activeStudentCount = 0`, otherwise 409 `CLASS_HAS_STUDENTS`.
   - Hard delete needs no references (students, attendance, report cards, announcement targets), otherwise 409 `CLASS_IN_USE`.
5. Subject `code` is upper-cased and must match `^[A-Z0-9][A-Z0-9_-]{0,19}$`, unique per school. Also:
   - `name` is 2–100 characters, `kkm` is an integer 0–100, `sortOrder` is 0–999.
   - The code is immutable once any grade uses the subject.
   - Deactivation fails with 409 `SUBJECT_MAPPED` while the subject is mapped to an active class in the active academic year.
6. ClassSubject:
   - Only active subjects of the same school can be mapped. PUT replaces the whole set, with the array order giving `sortOrder`.
   - Removing a mapped subject that already has DRAFT grades is allowed. Those grades stay as extras and the response returns `orphanGradeCount`.
   - `copy` needs the source class to belong to the same school.

### C. Students
1. Validation, as the pure module `student-identity` (a schema sketch follows this list):

   | Field | Rule |
   |---|---|
   | `nisn` | `^\d{10}$`, kept as a string so leading zeros survive |
   | `nis` | `^[0-9A-Za-z.\-/]{1,20}$` |
   | `name` | `^\p{L}[\p{L} .'\-]{1,99}$`u |
   | `birthPlace` | 2–100 characters |
   | `birthDate` | age between `MIN_STUDENT_AGE = 4` and `MAX_STUDENT_AGE = 25` years on `today` |
   | `address` | 5–500 characters |
   | `guardianName` | 2–100 characters |
   | `guardianPhone` | strip spaces, `-` and `.`, then match `^(?:\+62\|62\|0)8\d{7,11}$`; stored as E.164 `+628…` |
   | `sppAmount` | null, or an integer 0 to `MAX_INVOICE_AMOUNT` |
   | `initialPassword` | 8–72 bytes |

   A generated password is `GENERATED_PASSWORD_LENGTH = 10` characters from an alphabet without `0 O 1 l I`.
2. Required for activation (pure `activationMissingFields`): name, nisn, nis, gender, birthPlace, birthDate, address, guardianName, guardianPhone, and currentClassId pointing to an active class. If an active term exists, the class must be in that term's academic year.
3. Create (one transaction):
   - `claimNisn`, then create the User (role STUDENT, the school, bcrypt hash, `mustChangePassword = true`, `isActive = false` while DRAFT), then create the Student with status DRAFT.
   - If `activate` is true, run the activation check. A failure returns the response with `missingForActivation` and the student stays DRAFT; creation does not fail.
   - Write an audit entry `student.create` without the hash.
4. `claimNisn(tx, nisn, schoolId)`:
   - If the same school already has this NISN (`[schoolId, nisn]`), 409 `NISN_TAKEN_IN_SCHOOL`.
   - Otherwise lock the holder with `SELECT … WHERE activeNisn = ? FOR UPDATE`. If the holder is GRADUATED, set its `activeNisn` to NULL and audit `student.nisn_released`. If the holder has any other status, 409 `NISN_ACTIVE_ELSEWHERE` with the message "NISN sudah terdaftar di sekolah lain", without naming the school.
   - A concurrent claim that hits P2002 on `activeNisn` also returns 409.
5. Update:
   - `nisn` can change only while DRAFT, by re-claiming; otherwise 409 `NISN_LOCKED`.
   - `name` is written to `User.name` in the same transaction.
   - If the student is ACTIVE, the result must still pass the activation check, otherwise 422 `STUDENT_INCOMPLETE`.
   - A class change needs an active target class. For an ACTIVE student the target must be in the active academic year, otherwise 422 `CLASS_NOT_CURRENT_YEAR`.
6. Status transitions (pure `studentTransition`). A reason is required for INACTIVE, GRADUATED and MOVED. Anything not listed gives 409 `INVALID_STATUS_TRANSITION`.

   | From → to | Effects |
   |---|---|
   | DRAFT → ACTIVE | activation check; `userActive = true`; set `activatedAt` if empty |
   | ACTIVE → INACTIVE | `userActive = false`; `tokenVersion + 1`; revoke sessions (ACCOUNT_DISABLED) |
   | ACTIVE → GRADUATED | `userActive = true` (read-only login, per the schema default) |
   | ACTIVE → MOVED | `userActive = false`; `tokenVersion + 1`; revoke sessions; `activeNisn = NULL`; void future invoices (rule F9) |
   | INACTIVE → ACTIVE | activation check |
   | INACTIVE → GRADUATED, INACTIVE → MOVED | same effects as from ACTIVE |
   | GRADUATED → ACTIVE, MOVED → ACTIVE | undo; re-claim `activeNisn`; 409 if a live enrolment elsewhere now holds it |

   Rules for auth and other domains:
   - Login is allowed only when `user.isActive` is true and the status is ACTIVE or GRADUATED.
   - GRADUATED students can view data and submit payment proof for arrears, but cannot check in.
7. Reset password: new hash, `mustChangePassword = true`, `tokenVersion + 1`, all sessions revoked (ADMIN_REVOKED), audit entry.
8. Delete: only a DRAFT student with no attendance, report cards, invoices or submissions, otherwise 409 `STUDENT_IN_USE`. Student and User are deleted in one transaction.
9. Search (pure `parseStudentQuery`): `q` is 1–100 characters, and LIKE wildcards `%`, `_` and `\` are escaped.
   - All digits: NIS starts with q, OR NISN starts with q, OR name contains q.
   - Otherwise: name contains q, OR NIS starts with q.

   Queries are always filtered by `schoolId`. Default sort is name ascending with `id` as tiebreak.
10. Bulk import: at most `MAX_BULK_STUDENT_ROWS = 500` rows.
    - Every row is validated first (row errors, duplicates within the file, NIS or NISN conflicts).
    - `dryRun` writes nothing.
    - Otherwise each valid row runs in its own small transaction (so a NISN race affects only that row), and the result is reported per row.

### D. Promotion
1. Validation (pure `planPromotion`):
   - Every `fromClassId` belongs to the source year and appears only once.
   - Every `toClassId` belongs to the target year and is active.
   - The target year starts after the source year starts.
   - At most `MAX_PROMOTION_MOVES = 200`, `MAX_PROMOTION_STUDENTS = 5000`.
2. Warnings. These block execution unless `acknowledgeWarnings` is set:
   - `GRADE_LEVEL_MISMATCH`: a PROMOTE target is not `gradeLevel + 1`, or a RETAIN target is not the same level.
   - `GRADUATE_UNUSUAL_LEVEL`: a GRADUATE class is not at level 6, 9 or 12.
   - `TARGET_CLASS_NO_SUBJECTS`.
   - `DRAFT_REPORT_CARDS_IN_SOURCE_YEAR` (with a count).
   - `GRADUATES_WITH_OUTSTANDING_INVOICES` (with a count).
3. Scope: only ACTIVE students whose `currentClassId` is a mapped source class. INACTIVE students are reported as skipped. An override must name a student in one of the source classes; RETAIN requires `toClassId`.
4. Execution (one transaction, 60 s):
   - Lock the School row `FOR UPDATE`.
   - Apply overrides first, per student, each guarded by `currentClassId = fromClassId`.
   - Then one `updateMany` per move with `WHERE currentClassId = from AND status = 'ACTIVE' AND id NOT IN (overridden)`. PROMOTE sets `currentClassId = to`. GRADUATE sets status GRADUATED.
   - Write an audit entry `promotion.execute` with the counts.
   - Re-running moves nothing more; those students are counted as `alreadyMoved`.

### E. Report cards and grades
1. Scores: integer 0–100. `score: null` in an entry deletes that grade. `description` is ≤ 500 characters, and whitespace alone becomes null.
2. Predicate (pure; K13 interval method using integers only):
   - `A` if `3*score ≥ kkm + 200`
   - `B` if `3*score ≥ 2*kkm + 100`
   - `C` if `score ≥ kkm`
   - otherwise `D`

   This gives KKM 75 → A ≥ 92, B ≥ 84, C ≥ 75. KKM 70 → A ≥ 90, B ≥ 80. KKM 100 → only 100 is A. A non-integer or out-of-range input throws `RangeError`.
3. Who is eligible for a (term, class) grade grid: ACTIVE students with `currentClassId = classId`, plus every student who already has a ReportCard with that `classId` and `termId`. The second group covers past terms after promotion.
   - The class's academic year must equal the term's.
   - The subject must be mapped to the class, otherwise 422 `SUBJECT_NOT_IN_CLASS`.
4. Bulk grade write:
   - Validate the whole payload (≤ `MAX_BULK_GRADE_ROWS = 100`, no duplicate studentIds, every student eligible). Any failure returns 400 with `rowErrors` and writes nothing.
   - In a transaction: lock SchoolClass `FOR UPDATE`, then the ReportCard rows for (termId, eligible students) ordered by id `FOR UPDATE`. If any target report card is PUBLISHED, 409 `REPORT_CARD_PUBLISHED{studentIds}` and nothing is written.
   - Create any missing report cards with `createMany`, without skipDuplicates. The class lock makes this safe. Each gets `classNameSnapshot` and `homeroomTeacherNameSnapshot` from the current class.
   - Upsert each grade by `[reportCardId, subjectId]`, writing the current subject name, KKM snapshot and computed predicate. Delete the rows with null scores.
   - Write one audit entry `report_card.grades_upsert {termId, classId, subjectId, count}`.
5. Editing one student's grades follows the same rules. It locks `SchoolClass(rc.classId)` then the report card. A subject must be mapped or already graded on that card.
6. Snapshots are rewritten on every write while DRAFT and refreshed again at publish. After publish they never change.
7. Completeness (pure `missingSubjectIds`): the mapped subjects for `rc.classId` minus the graded ones, in sortOrder. A class with no mapped subjects gives `CLASS_HAS_NO_SUBJECTS`, so it cannot be published. `REQUIRE_HOMEROOM_NOTE = false`; a missing note is only a warning in the readiness check.
8. Publish, in one transaction with ≤ `MAX_PUBLISH_BATCH = 100` cards:
   - Lock the class, then the DRAFT report cards (term, class, filtered by `studentIds`) ordered by id `FOR UPDATE`.
   - Check completeness. If any card is incomplete, 422 `REPORT_CARD_INCOMPLETE{incomplete[]}` and nothing is published (no partial publish; the admin sends the ready `studentIds`).
   - Refresh snapshots: one join UPDATE for the subject name and KKM, then recompute predicates in the app and write them with at most 4 `updateMany` calls (one per predicate).
   - Attendance snapshot: `groupBy(studentId, status)` over Attendance from `term.startDate` to `min(term.endDate, today)`. SAKIT goes to sickDays, IZIN to permitDays, ALPHA to absentDays. HADIR and TERLAMBAT are not counted.
   - Set status with the compare-and-set `updateMany({id in ids, status: DRAFT} → PUBLISHED, publishedAt, publishedById)`. If the count differs from expected, 409.
   - Create REPORT_CARD_PUBLISHED notifications (category ACADEMIC, `data {screen:"report-card", id}`). On a re-publish the title is "Rapor diperbarui".
   - Write an audit entry `report_card.publish {ids}`.
9. Unpublish: `reason` is required (5–255). Compare-and-set PUBLISHED → DRAFT and clear `publishedAt`. Audit entry, no notification. Students then get 404 for that card.
10. Students only ever read `status = PUBLISHED` rows where the card's `studentId` matches the session. `average` is the mean score rounded to 2 decimals, or null when there are no grades.

### F. Invoices
1. Amount bounds: `MIN_INVOICE_AMOUNT = 1_000`, `MAX_INVOICE_AMOUNT = 50_000_000`, safe integer, zod `z.int()` (numeric strings are rejected).
2. Billing period: month 1–12, and `periodKey` must lie within `[todayKey − MAX_PAST_PERIOD_MONTHS (24), todayKey + MAX_FUTURE_PERIOD_MONTHS (12)]`.
3. Due date:
   - Default: day `DEFAULT_DUE_DAY = 10` of the period month, clamped to the month's length.
   - It must fall between the first day of (period + `DUE_DATE_MIN_OFFSET_MONTHS = −1`) and the last day of (period + `DUE_DATE_MAX_OFFSET_MONTHS = 3`).
4. The default title is `SPP {September} {2026}`, from a table of Indonesian month names.
5. Stored status (pure `deriveInvoiceStatus(amount, paid)`): `paid = 0` → UNPAID, `0 < paid < amount` → PARTIAL, `paid = amount` → PAID. `paid < 0`, `paid > amount` or `amount ≤ 0` throws `InvariantError`. VOID is only set by the void action.
6. Display status (pure), checked in this order:

   | Condition | Display status |
   |---|---|
   | VOID | `DIBATALKAN` |
   | PAID | `LUNAS` |
   | a submission is pending | `MENUNGGU_VERIFIKASI` |
   | `today > dueDate` | `JATUH_TEMPO` (the due date itself is not overdue) |
   | PARTIAL | `SEBAGIAN` |
   | otherwise | `BELUM_BAYAR` |

   Separately, `isOverdue = status ∈ {UNPAID, PARTIAL} && today > dueDate`, and `isSettled = status === PAID`.
7. Creating one invoice:
   - The student must belong to the school and be ACTIVE. INACTIVE or GRADUATED students can be billed only for arrears (`periodKey ≤ todayKey`); otherwise 422 `STUDENT_NOT_BILLABLE`. DRAFT and MOVED students cannot be billed.
   - In the transaction, lock the INVOICE counter, check the slot (`[studentId, SPP, y, m]`; existing gives 409 `INVOICE_EXISTS`, including a VOID one, with the hint "pulihkan"), allocate the number, create the invoice, notify (INVOICE_ISSUED, category FINANCE), and audit.
8. Bulk generation:
   - Validate. Overrides must have unique studentIds that are in scope and within amount bounds (0 is allowed and means exempt). The scope's classes and students must belong to the school. At most `MAX_BULK_INVOICE_STUDENTS = 3000`.
   - Load the ACTIVE students in scope (`id, userId, sppAmount, currentClassId`).
   - Transaction (60 s):
     - `lockDocumentCounter(INVOICE, localYear)`, then read existing invoices for (students, SPP, period), VOID included.
     - Pure `planBulkInvoices`: amount is the override if given, else `sppAmount` if not null, else the request amount. 0 is skipped as EXEMPT; an existing invoice is skipped as ALREADY_BILLED. Result order: class name, then student name.
     - With `dryRun`, return the plan here and roll back.
     - Otherwise allocate `rows.length` numbers, `createMany` in chunks of 500 **without skipDuplicates**, read the ids back by (schoolId, period, studentIds), create INVOICE_ISSUED notifications with `createMany`, and write an audit entry `invoice.bulk_create {period, count, totalAmount, scope}`.
   - All invoice creation holds the same counter row, so the existence check is exact. A P2002 (year-boundary race) returns 409, and re-running is idempotent.
9. Voiding future invoices when a student moves or is deactivated: void rows with `periodKey > todayKey`, status UNPAID and no pending submission, with reason "Siswa pindah/nonaktif". Everything else stays as arrears.
10. Editing (pure `invoiceEditViolation`):
    - VOID: nothing can be edited (409 `INVOICE_VOID`).
    - PAID: only `note`.
    - `amount`: only when status is UNPAID and there is no pending submission; otherwise 409 `INVOICE_HAS_PAYMENTS` or `SUBMISSION_PENDING`. Bounds from F1 apply.
    - `dueDate`: while UNPAID or PARTIAL, using the F3 window.
    - `title`: ≤ 100 characters. `note`: ≤ 255.
    - The period cannot be edited.
11. Void: only UNPAID with `paidAmount = 0` and no pending submission. Requires a reason (5–255), notifies INVOICE_VOIDED, and is audited.
12. Restore: VOID → UNPAID, clearing the void fields. Requires a student who is not MOVED. Audited.

### G. Submissions and payments
1. Rules for submitting (pure `submissionViolation`):
   - The invoice must be UNPAID or PARTIAL, otherwise 409 `INVOICE_NOT_PAYABLE`. No pending submission, otherwise 409 `SUBMISSION_PENDING`.
   - Fewer than `MAX_SUBMISSIONS_PER_INVOICE_PER_DAY = 5` today, otherwise 429 `TOO_MANY_SUBMISSIONS`.
   - `amount` must be ≤ remaining (422 `AMOUNT_EXCEEDS_REMAINING`) and ≥ `min(remaining, MIN_PAYMENT_AMOUNT = 10_000)` (422 `AMOUNT_TOO_SMALL`). When `ALLOW_PARTIAL_PAYMENT = false`, it must equal remaining.
   - `transferDate` must be in `[today − MAX_TRANSFER_AGE_DAYS (90), today]`.
   - `senderName` 2–100 characters, `senderBank` 2–50, `note` ≤ 255.
2. Submit flow:
   - Check Content-Length ≤ `MAX_UPLOAD_BYTES = 5 MB` before parsing (nginx `client_max_body_size 6m`).
   - Validate the fields with zod, then sanitise the file (re-encode, or PDF check) and compute sha256.
   - If the same hash is on a PENDING or APPROVED submission, 409 `PROOF_ALREADY_USED`.
   - `storage.put` the file.
   - Transaction:
     - Lock the Invoice `WHERE id = ? AND schoolId = ? AND studentId = <session student>` `FOR UPDATE`; a miss is 404.
     - Apply the G1 rules.
     - Create the StoredFile (PAYMENT_PROOF, schoolId, uploadedById).
     - Create the PaymentSubmission with `pendingInvoiceId = invoiceId`.
     - Notify PAYMENT_SUBMITTED to active SCHOOL_ADMIN users of the school (at most `MAX_ADMIN_NOTIFY = 50`).
   - On any failure, `storage.delete(key)` and rethrow.
   - A retried double tap is harmless: the second request gets 409 `SUBMISSION_PENDING`.
3. A student cancels a submission with a compare-and-set PENDING → CANCELLED and `pendingInvoiceId = NULL`, only on their own submission.
4. Approve:
   - Transaction: lock the Invoice, then the Submission `FOR UPDATE`.
   - Status must be PENDING (409 `SUBMISSION_ALREADY_REVIEWED`). The invoice must not be VOID (409; the admin must reject). If remaining is 0, 409 `INVOICE_ALREADY_PAID`.
   - `resolveApprovedAmount(sub.amount, remaining, requested?)`:
     - The default is the submitted amount; it must satisfy `1 ≤ amt ≤ min(submitted, remaining)`.
     - If remaining < submitted and no amount was sent, 422 `AMOUNT_EXCEEDS_REMAINING` (the admin must choose an amount).
     - If `amt < submitted`, `note` is required (422 `NOTE_REQUIRED`).
   - Compare-and-set `updateMany({id, status: PENDING} → APPROVED, pendingInvoiceId: null, reviewedById, reviewedAt, reviewNote})`; a count other than 1 is 409.
   - `allocateDocumentNumbers(RECEIPT, localYear(now), 1)`.
   - Create the Payment (TRANSFER, amt, `paidDate = transferDate`, submissionId, receiptNo, recordedById).
   - `applyPaymentDelta(+amt)` and update the invoice.
   - Notify PAYMENT_APPROVED to the student (`data {screen:"invoice", id}`) and audit `submission.approve`.
5. Reject: lock the Invoice (to keep the lock order), then compare-and-set PENDING → REJECTED with `reviewNote = reason` (required, 5–255) and `pendingInvoiceId = NULL`. Notify PAYMENT_REJECTED with the reason in the body. Audit.
6. Cash payment:
   - Lock the Invoice. It must not be VOID or PAID (409). No pending submission, otherwise 409 `SUBMISSION_PENDING`.
   - Same amount rules as G1. `paidDate` must be in `[today − MAX_CASH_BACKDATE_DAYS (31), today]`.
   - Allocate a receipt number, create the Payment (CASH), apply the delta, notify PAYMENT_APPROVED ("Pembayaran tunai diterima"), and audit `payment.cash_record`.
7. Void a payment:
   - Lock the Invoice, then the Payment. Compare-and-set `updateMany({id, voidedAt: null})`. A reason is required.
   - `applyPaymentDelta(−amount)`. The linked submission stays APPROVED for history.
   - Notify PAYMENT_VOIDED and audit.
   - The receipt number is kept, and the receipt shows `voided: true` (stamped "DIBATALKAN").
8. `applyPaymentDelta(state, delta, now)` (pure, returns a new object):
   - `paid' = paid + delta`, which must stay in `[0, amount]`, otherwise it throws.
   - `status' = derive(amount, paid')`.
   - `paidAt'`: if `status'` is PAID, keep the old `paidAt` when it was already PAID, else `now`; otherwise null.

### H. Numbering
1. `allocateDocumentNumbers(tx, {schoolId, kind, year, count})`:
   - `count` is 1 to 3000.
   - Run `INSERT INTO DocumentCounter (schoolId,kind,year,lastValue,updatedAt) VALUES (?,?,?,?,NOW(3)) ON DUPLICATE KEY UPDATE lastValue = lastValue + VALUES(lastValue), updatedAt = NOW(3)`, then `SELECT lastValue … FOR UPDATE`.
   - Returns `{first: last − count + 1, last}`.
2. `lockDocumentCounter` is the same upsert with a delta of 0 followed by `SELECT … FOR UPDATE`. Bulk generation uses it before reading existing invoices.
3. Format: `${KIND_PREFIX[kind]}-${year}-${seq padded to 6}`, where `KIND_PREFIX = {INVOICE: "INV", RECEIPT: "KWT"}`. Numbers past 999999 simply grow longer. `year` is the school's local year at issue time.
4. There are no gaps: a rollback reverts the counter together with the document. Numbers are never reused, including for voided payments.

### I. Stats
1. `studentsNotFullyPaid` = `COUNT(DISTINCT i.studentId)` over invoices where:
   - `i.schoolId = ?`
   - `i.status IN ('UNPAID','PARTIAL')`
   - `periodKey ≤ todayKey`, which excludes months billed in advance
   - `s.status = 'ACTIVE'`

   `studentsOverdue` adds `dueDate < today`. `outstandingAmount = SUM(amount − paidAmount)` over the same rows; SQL SUM returns Decimal or BigInt, so convert with `Number()`. `pendingVerification` counts PENDING submissions of the school.
2. When a period is given: counts by status for that month, `billedAmount = Σ amount` of non-VOID invoices, and `collectedAmount = Σ paidAmount`.
3. Academic stats:
   - Students: `groupBy(status)`.
   - Term: `termId`, or the active term if none is given; null if neither exists.
   - `studentsWithGrades`: report cards of that term that have at least one grade.
   - `studentsComplete`: raw SQL where the number of graded mapped subjects equals the number of mapped subjects, and the class has at least one.
   - `published`: count of PUBLISHED.
   - `activeStudents`: the denominator.

### J. Audit actions
All audit entries go through `AuditLog`, without secrets:
- `student.create|update|activate|status_change|reset_password|delete|nisn_released`
- `class.*`, `subject.*`, `class_subject.set`, `term.*`, `term.set_active`
- `promotion.execute`
- `report_card.grades_upsert|publish|unpublish|delete|note_update`
- `invoice.create|bulk_create|update|void|restore`
- `payment.cash_record|void`
- `submission.approve|reject`
- `billing_settings.update`

---

## 4. Service modules and pure modules

### Shared helpers (assumed to be owned by the platform or auth designers)
```ts
// src/lib/common/scope.ts
type Actor = { userId: string; role: UserRole; schoolId: string | null; ip?: string; userAgent?: string };
type SchoolScope = { schoolId: string; actor: Actor };
resolveSchoolScope(actor: Actor, requestedSchoolId?: string | null): SchoolScope

// src/lib/common/tx.ts
withTx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T>   // retries P2034 up to 3 times

// src/lib/common/domain-error.ts
class DomainError extends Error { code: string; status: number; details?: unknown }

// src/lib/common/pagination.ts
parsePagination(sp: URLSearchParams): { page: number; limit: number; skip: number }

// src/lib/time/local-date.ts   (pure)
type LocalDate = string;   // "YYYY-MM-DD"
todayLocal(tz: SchoolTimezone, now: Date): LocalDate
localYear(tz, now): number
toDbDate(d: LocalDate): Date
fromDbDate(d: Date): LocalDate
addDays(d, n)
addMonths(d, n)
daysInMonth(y, m)
```

### Numbering
```ts
// src/lib/numbering/document-number.ts          (PURE)
formatDocumentNumber(kind: DocumentKind, year: number, seq: number): string
parseDocumentNumber(s: string): { kind; year; seq } | null

// src/lib/numbering/counter.ts
lockDocumentCounter(tx, key: { schoolId; kind; year }): Promise<number>   // returns lastValue
allocateDocumentNumbers(tx, key, count: number): Promise<{ first: number; last: number }>
```

### Academic: pure modules (`src/lib/academic/rules/*.ts`, each with a `.test.ts`)
```ts
// predicate.ts
computePredicate(score: number, kkm: number): GradePredicate

// score.ts
isValidScore(n: unknown): n is number

// report-card.ts
missingSubjectIds(mapped: readonly {subjectId; sortOrder}[], graded: readonly string[]): string[]
reportCardEditViolation(status: ReportCardStatus): DomainErrorCode | null
summarizeAttendance(rows: readonly {status: AttendanceStatus; count: number}[]): {sickDays; permitDays; absentDays}
averageScore(scores: readonly number[]): number | null
validateBulkGradeEntries(entries, eligibleStudentIds: ReadonlySet<string>): RowError[]

// student-identity.ts
normalizeNisn(raw: string): string | null
isValidNis(raw)
normalizePhone(raw: string): string | null
isValidStudentName(raw)

// student-activation.ts
activationMissingFields(s: ActivationInput, today: LocalDate): readonly StudentField[]

// student-status.ts
studentTransition(from: StudentStatus, to: StudentStatus):
  { ok: true; effects: { userActive: boolean; revokeSessions: boolean; releaseNisn: boolean;
                         claimNisn: boolean; requireActivation: boolean; requireReason: boolean } }
  | { ok: false; code: "INVALID_STATUS_TRANSITION" }

// student-search.ts
parseStudentQuery(q: string): { text: string; digits: string | null; likeEscaped: string }

// term.ts
parseAcademicYearName(name): { startYear: number } | null
validateAcademicYearRange(...)
validateTermWithinYear(term, year, sibling?)
rangesOverlap(a, b)
termLabel(semester, yearName): string

// promotion.ts
planPromotion(input: PromotionInput, ctx: {
  fromYear; toYear;
  classes: ClassLite[];
  students: {id; currentClassId; status}[]
}): { items; overrides; warnings: Warning[]; errors: PlanError[]; counts }
```

### Academic: services and queries (Prisma; each file under 400 lines)
```ts
// src/lib/academic/errors.ts: AcademicError extends DomainError; factories notFound(), conflict(code, msg), unprocessable(code, msg, details)
// src/lib/academic/schemas/{student,class,subject,term,report-card,promotion}.ts: zod v4 schemas with .meta() for OpenAPI

// students/student-service.ts
createStudent(scope, input, deps: {now: Date; hash: (p: string) => Promise<string>; genPassword: () => string}):
  Promise<{ student; temporaryPassword?: string; missingForActivation: StudentField[] }>
updateStudent(scope, id, patch, now)
deleteDraftStudent(scope, id)

// students/student-lifecycle-service.ts
activateStudent(scope, id, now)
changeStudentStatus(scope, id, input: {to; reason; voidFutureInvoices?}, now): Promise<{ student; voidedInvoiceIds: string[] }>
resetStudentPassword(scope, id, input, deps)

// students/nisn-claim.ts
claimNisn(tx, nisn, schoolId, actor): Promise<void>

// students/student-import-service.ts
importStudents(scope, rows, opts: {dryRun; activate}, deps)

// students/student-queries.ts
listStudents(scope, query): Promise<Paginated<StudentListItem>>
getStudent(scope, id)
getMyStudentProfile(actor)

// classes/class-service.ts
createClass
updateClass
deleteClass
// classes/class-subject-service.ts
setClassSubjects(scope, classId, subjectIds)
copyClassSubjects(scope, classId, sourceClassId)
// classes/class-queries.ts
listClasses
getClassSubjects

// subjects/subject-service.ts, subject-queries.ts: create/update/delete/list

// terms/term-service.ts
createAcademicYear
updateAcademicYear
deleteAcademicYear
createTerm
updateTerm
deleteTerm
setActiveTerm(scope, termId)
// terms/term-queries.ts
listAcademicYears(scope)
getActiveTerm(schoolId)

// promotion/promotion-service.ts
previewPromotion(scope, input)
executePromotion(scope, input)

// report-cards/report-card-lock.ts
lockClassAndReportCards(tx, classId, where): Promise<ReportCardLockRow[]>

// report-cards/grade-service.ts
upsertClassGrades(scope, input: BulkGradeInput)
upsertReportCardGrades(scope, reportCardId, grades)

// report-cards/report-card-service.ts
createReportCard(scope, {studentId, termId})
updateHomeroomNote(scope, id, note)
deleteDraftReportCard(scope, id)

// report-cards/publish-service.ts
getPublishReadiness(scope, {termId, classId})
publishReportCards(scope, input, now)
unpublishReportCards(scope, {reportCardIds, reason})

// report-cards/report-card-queries.ts
getGradeSheet(scope, q)
listReportCards(scope, q)
getReportCard(scope, id)

// report-cards/my-report-card-queries.ts
listMyReportCards(actor)
getMyReportCard(actor, id)

// stats/academic-stats.ts
academicStats(scope, {termId?})
```

### Billing: pure modules (`src/lib/billing/rules/*.ts`, each with a `.test.ts`)
```ts
// money.ts
MIN_INVOICE_AMOUNT
MAX_INVOICE_AMOUNT
MIN_PAYMENT_AMOUNT
isValidRupiah(n: unknown, min: number, max: number): n is number

// period.ts
periodKey(y, m)
validatePeriod(y, m, today: LocalDate): Violation | null
invoiceTitle(y, m): string

// due-date.ts
defaultDueDate(y, m): LocalDate
validateDueDate(due: LocalDate, y, m): Violation | null

// invoice-status.ts
deriveInvoiceStatus(amount, paid): "UNPAID" | "PARTIAL" | "PAID"
isOverdue(inv, today)
invoiceDisplayStatus(inv: {status; dueDate: LocalDate; hasPendingSubmission: boolean}, today): DisplayStatus

// invoice-edit.ts
invoiceEditViolation(inv, patch, hasPending): Violation | null
voidViolation(inv, hasPending)
restoreViolation(inv, studentStatus)

// payment.ts
applyPaymentDelta(state: Readonly<InvoiceMoneyState>, delta: number, now: Date): InvoiceMoneyState
resolveApprovedAmount(submitted: number, remaining: number, requested?: number, note?: string):
  { ok: true; amount: number } | { ok: false; code }
paymentAmountViolation(amount, remaining, allowPartial = ALLOW_PARTIAL_PAYMENT)

// submission.ts
submissionViolation(ctx: {status; amount; paidAmount; hasPending; submittedToday},
                    input: {amount; transferDate}, today): Violation | null
cashPaymentViolation(...)

// bulk-plan.ts
planBulkInvoices(input: {
  students: {id; userId; sppAmount: number | null; className; name}[];
  existing: ReadonlySet<string>;
  defaultAmount: number;
  overrides: ReadonlyMap<string, number>;
}): { rows: {studentId; userId; amount}[]; skipped: {studentId; reason}[]; totalAmount: number }
```

### Billing: services and queries
```ts
// src/lib/billing/errors.ts: BillingError extends DomainError

// src/lib/billing/invoice-tx.ts
withInvoiceLock<T>(invoiceId: string, where: {schoolId: string; studentId?: string},
                   fn: (tx, invoice: LockedInvoice) => Promise<T>): Promise<T>

// invoices/invoice-service.ts
createInvoice(scope, input, now)
updateInvoice(scope, id, patch, now)
voidInvoice(scope, id, reason, now)
restoreInvoice(scope, id)
voidFutureInvoicesForStudent(tx, schoolId, studentId, today, reason)   // called from the lifecycle service

// invoices/bulk-invoice-service.ts
bulkCreateInvoices(scope, input, now): Promise<BulkInvoiceResult>

// invoices/invoice-queries.ts
listInvoices(scope, q, now)
getInvoice(scope, id, now)

// payments/payment-service.ts
recordCashPayment(scope, invoiceId, input, now)
voidPayment(scope, paymentId, reason, now)

// payments/receipt-queries.ts
getReceipt(scope | studentActor, paymentId)

// submissions/proof-upload.ts
sanitizeProof(file: File): Promise<{bytes: Buffer; mime: string; sha256: string; ext: string}>   // sharp, or PDF magic-byte check

// submissions/submission-service.ts
submitPaymentProof(actor, invoiceId, input, file, now, deps: {storage})
cancelSubmission(actor, id)
approveSubmission(scope, id, input, now)
rejectSubmission(scope, id, reason, now)

// submissions/submission-queries.ts
listSubmissions(scope, q)
getSubmission(scope, id)

// student/my-invoice-queries.ts
listMyInvoices(actor, q, now)
getMyInvoice(actor, id, now)
getMyPaymentInfo(actor)

// settings/billing-settings-service.ts
updateBillingSettings(scope, input)

// stats/billing-stats.ts
billingStats(scope, {periodYear?, periodMonth?}, now)

// notify.ts
billingNotification(type, ctx): {title; body; data}   // PURE text builder
insertNotifications(tx, rows)
```

Route handlers live under `src/app/api/v1/school/**/route.ts` and `src/app/api/v1/me/**/route.ts`. Each one runs the same steps:
1. Gate on authentication and permission key.
2. `resolveSchoolScope`.
3. `safeParse` the input.
4. Call the service.
5. `mapError`: DomainError returns its status and code; P2002 and P2034 return 409; anything else returns 500 and is logged.

---

## 5. Test cases

**Unit tests (node:test, pure modules, injected clocks; target ≥ 95% line coverage)**

`predicate`:
- KKM 75: 100→A, 92→A, 91→B, 84→B, 83→C, 75→C, 74→D, 0→D
- KKM 70: 90→A, 89→B, 80→B, 79→C, 70→C, 69→D
- KKM 100: 100→A, 99→D
- KKM 0: 67→A, 66→B, 34→B, 33→C, 0→C
- throws on 91.5, 101, −1, NaN, KKM 101

`score` and `bulk grades`:
- accepts 0 and 100; rejects "90", 100.5 and null (except as a delete)
- duplicate studentId gives a row error
- ineligible student gives a row error
- more than 100 entries is rejected
- description of 501 characters is rejected
- a whitespace-only description becomes null

`report-card`:
- `missingSubjectIds` keeps sortOrder; extra grades are ignored; an empty mapping gives CLASS_HAS_NO_SUBJECTS
- editing a PUBLISHED card gives a violation
- `summarizeAttendance` ignores HADIR and TERLAMBAT
- `averageScore` rounds to 2 decimals (e.g. 83.333 → 83.33); empty gives null

`term`:
- "2025/2026" is valid; "2025/2027" and "25/26" are invalid
- label GANJIL gives "Semester Ganjil 2025/2026"
- a term outside its year gives an error; overlapping GANJIL and GENAP give an error; GENAP before GANJIL gives an error; spans over the limits give errors

`student-identity`:
- " 0012345678 " is kept with its leading zeros; 9 digits and letters are invalid
- phones "0812-3456-7890", "+62 812 3456 7890" and "6281234567890" all give "+6281234567890"
- "021-5551234" and "0812345" are invalid
- names "Ni Luh Putu Ayu", "Nur'aini" and "Ahmad Al-Farabi" are valid; "Budi2" is invalid

`student-activation`:
- each missing field is listed
- age 3 and age 26 are invalid; a future birth date is invalid
- an inactive class counts as missing

`student-status`: the full 5×5 matrix of allowed and forbidden transitions, plus the effect flags per transition (MOVED releases the NISN and revokes sessions; GRADUATED keeps `userActive`; a transition to the same status is invalid).

`student-search`: digits add NIS and NISN prefix matching; text matches name only; `%` and `_` are escaped; 101 characters is invalid.

`promotion`:
- level +1 PROMOTE has no warning; a level mismatch gives a warning
- a source class from the wrong year is an error; an inactive target is an error; a duplicate `fromClassId` is an error
- RETAIN without a target is an error
- an override for a student outside the source classes is an error
- GRADUATE from level 10 gives a warning; from level 12 it does not
- INACTIVE students are counted as skipped
- a target year that is not after the source year is an error

`money`: 1000 is valid; 999 is invalid; 50,000,000 is valid; 50,000,001 is invalid; 1500.5, −1 and 2^53 are invalid.

`period`:
- the current month, +12 and −24 are valid; +13 and −25 are invalid; month 0 and 13 are invalid
- the instant 2026-09-30T17:30Z is 2026-10-01 in WIB and WITA and 2026-10-01 in WIT, but still 2026-09-30 in UTC terms
- with today = 2026-12-15, period 2027-12 is valid

`due-date`:
- the default is the 10th
- February 2028 defaults to the 10th
- the window edges at −1 and +3 months, both inside and outside

`invoice-status`:
- `derive`: 0, 1, amount−1 and amount give the expected statuses; > amount, negative, and amount 0 throw
- display precedence: VOID beats everything; PAID after the due date is LUNAS; a pending submission beats overdue
- overdue boundary: 2026-09-10T16:59Z is not overdue; 17:00Z (09-11 WIB) is overdue
- PARTIAL that is not overdue is SEBAGIAN

`payment`:
- `applyPaymentDelta`: UNPAID plus the full amount gives PAID with `paidAt = now`; PAID minus x gives PARTIAL with `paidAt` null; PAID plus a delta is invalid
- negative and excess results throw
- the input is frozen (`Object.freeze`) and must not be mutated
- `resolveApprovedAmount`: default, requested above the submitted amount, requested above remaining, remaining below the submitted amount with no request, 0, and a smaller amount without a note

`invoice-edit` and void:
- editing the amount after a payment gives INVOICE_HAS_PAYMENTS; with a pending submission, SUBMISSION_PENDING
- PAID allows only the note; VOID allows nothing
- editing the due date on PARTIAL is allowed
- voiding PARTIAL, voiding with a pending submission, and voiding twice are rejected
- restore only works from VOID and not for a MOVED student

`submission`:
- amount above remaining is rejected; 9,999 against remaining 50,000 is rejected; 6,500 against remaining 6,500 is accepted
- with partial payments disabled, the amount must equal remaining
- a future transfer date is rejected; 91 days ago is rejected; 90 days ago is accepted
- a pending submission blocks; PAID and VOID invoices are rejected; the 6th submission of the day is rejected

`bulk-plan`:
- existing invoices, VOID included, are skipped as ALREADY_BILLED
- `sppAmount` 0 is skipped as EXEMPT; null uses the default; an override beats `sppAmount`
- an override for a student outside the scope is an error; duplicate overrides are an error
- the order is stable; the total is correct

`document-number`:
- (RECEIPT, 2026, 1) gives "KWT-2026-000001"; 1,000,000 gives "KWT-2026-1000000"; parse round-trips; garbage gives null

**Integration tests (`*.int.test.ts` against a MariaDB 10.11 service in CI, `TZ=UTC`)**

Tenant isolation:
- SA of school A gets 404 on B's student, invoice, report card and submission (GET, PATCH, void and approve)
- SU with no `schoolId` gets 400; SA passing another school's `schoolId` gets 403
- a student gets 404 on another student's invoice, submission and report card

NISN:
- held ACTIVE at B gives 409, and the message does not contain B's name
- held GRADUATED at B is released (B's `activeNisn` becomes null, audited) and claimed
- two concurrent claims: exactly one 409

Student lifecycle:
- activation of an incomplete student gives 422 with the missing list
- deactivation increments `tokenVersion`, revokes sessions with ACCOUNT_DISABLED, and sets `isActive = false`
- MOVED voids only future UNPAID invoices
- deleting a DRAFT student that has an invoice gives 409
- bulk import dryRun writes nothing; results are reported per row

Promotion:
- runs, and a re-run moves 0 (counted as `alreadyMoved`)
- overrides are applied; graduation sets GRADUATED
- two concurrent executions produce no double move

Grades:
- lazy report-card creation copies the class snapshot
- one invalid row means no writes
- a PUBLISHED card in the class gives 409 with no writes
- a null score deletes the grade
- a concurrent grade write and publish never leave a grade on a PUBLISHED card

Publish:
- predicates are recomputed after a KKM change
- attendance counts respect the term bounds
- one notification per student
- incomplete cards give 422 with the state unchanged
- the student sees only PUBLISHED cards; after unpublish, the student gets 404

Bulk invoices:
- two concurrent identical runs produce N invoices in total, with unique contiguous numbers; the second run creates 0
- dryRun leaves the invoice rows and the counter unchanged
- INACTIVE students are skipped, and exempt students are skipped

CHECK constraints (asserted in CI):
- PAID with `paidAmount < amount` is rejected
- `pendingInvoiceId ≠ invoiceId` is rejected
- a negative `sppAmount` is rejected

Submissions and payments:
- a second pending submission gives 409; two concurrent submissions: exactly one succeeds
- the stored file is deleted when the transaction fails; a reused proof gives 409
- approve creates the Payment and receipt, sets PAID and `paidAt`, and notifies
- two concurrent approvals give one 200, one 409 and one Payment
- approve racing reject: exactly one wins
- after a cash payment lowers the remaining amount, approve gives 422 unless `approvedAmount` is sent
- cash while a submission is pending gives 409
- 20 concurrent cash payments get receipts 1–20 with no gaps or duplicates
- a forced failure after allocating a number leaves no gap
- voiding a payment recomputes the invoice, marks the receipt as voided, and the invoice can then be voided

Other:
- `billingStats` excludes future months, VOID invoices and inactive students; overdue uses the school timezone (WIT versus WIB)
- `@db.Date` round-trips correctly
- an injected P2034 is retried up to 3 times

**E2E (Playwright API tests, seeded DB)**
- Academic flow: set up classes, subjects and mapping; create a student; activate; student login with forced password change; bulk grade entry; publish; the student reads the report card.
- Billing flow: bulk SPP generation; multipart proof submission; approve; the student sees LUNAS and the receipt. Also the reject path: the reason appears in the student's detail and a push notification row exists.

---

## 6. SCHEMA CHANGE REQUESTS

1. **ReportCardGrade.score**: change `Decimal @db.Decimal(5, 2)` to `Int @db.UnsignedTinyInt`. See D1.
2. **ReportCard**: add
   ```prisma
   homeroomNote                String? @db.VarChar(1000)
   /// Snapshot saat publikasi.
   homeroomTeacherNameSnapshot String? @db.VarChar(100)
   sickDays                    Int?    @db.SmallInt
   permitDays                  Int?    @db.SmallInt
   absentDays                  Int?    @db.SmallInt
   ```
   (D5)
3. **New model ClassSubject.** Also add `classSubjects ClassSubject[]` to both `SchoolClass` and `Subject`. The service checks that `subject.schoolId == class.schoolId`. (D3)
   ```prisma
   /// Mapel yang diajarkan di satu kelas; dasar kelengkapan rapor.
   model ClassSubject {
     classId     String
     subjectId   String
     sortOrder   Int         @default(0) @db.SmallInt
     schoolClass SchoolClass @relation(fields: [classId], references: [id], onDelete: Cascade)
     subject     Subject     @relation(fields: [subjectId], references: [id], onDelete: Restrict)
     createdAt   DateTime    @default(now())
     @@id([classId, subjectId])
     @@index([subjectId])
   }
   ```
4. **SchoolClass**: add `homeroomTeacherName String? @db.VarChar(100)`.
5. **Student**: add `sppAmount Int?`, where NULL means use the bulk default and 0 means exempt. (D11)
6. **Invoice**: add `invoiceNo String @db.VarChar(20)` with `@@unique([schoolId, invoiceNo])`, and the back-relation `pendingSubmission PaymentSubmission? @relation("InvoicePendingSubmission")`. Because there are now two relations between PaymentSubmission and Invoice, the existing pair must be named: `submissions PaymentSubmission[] @relation("InvoiceSubmissions")` and `invoice Invoice @relation("InvoiceSubmissions", …)`.
7. **Payment**: replace `paidAt DateTime` with `paidDate DateTime @db.Date`. Add `receiptNo String @db.VarChar(20)` with `@@unique([schoolId, receiptNo])`. Change the index `[schoolId, paidAt]` to `[schoolId, paidDate]`. (D10, D14)
8. **PaymentSubmission**: add
   ```prisma
   /// = invoiceId selama PENDING, selain itu NULL => maks. satu pengajuan menunggu per tagihan.
   pendingInvoiceId String?  @unique
   pendingInvoice   Invoice? @relation("InvoicePendingSubmission", fields: [pendingInvoiceId], references: [id], onDelete: Restrict)
   ```
   (D8)
9. **New enum and model**, plus `documentCounters DocumentCounter[]` on `School`:
   ```prisma
   enum DocumentKind {
     INVOICE
     RECEIPT
   }

   /// Penghitung nomor dokumen per sekolah per tahun lokal; dinaikkan di transaksi yang sama.
   model DocumentCounter {
     schoolId  String
     kind      DocumentKind
     year      Int          @db.SmallInt
     lastValue Int          @default(0)
     school    School       @relation(fields: [schoolId], references: [id], onDelete: Restrict)
     updatedAt DateTime     @default(now()) @updatedAt
     @@id([schoolId, kind, year])
   }
   ```
10. **NotificationType**: append `INVOICE_VOIDED` and `PAYMENT_VOIDED` at the end of the enum.
11. **Additional CHECK constraints** in the init migration:
    - Invoice: `status<>'UNPAID' OR paidAmount=0`
    - Invoice: `status<>'PARTIAL' OR (paidAmount>0 AND paidAmount<amount)`
    - Invoice: `status<>'PAID' OR paidAmount=amount`
    - Invoice: `status<>'VOID' OR paidAmount=0`
    - Payment: `amount>0`
    - PaymentSubmission: `amount>0`
    - PaymentSubmission: `(status='PENDING') = (pendingInvoiceId IS NOT NULL)`
    - PaymentSubmission: `pendingInvoiceId IS NULL OR pendingInvoiceId=invoiceId`
    - Student: `sppAmount IS NULL OR sppAmount BETWEEN 0 AND 50000000`
    - ReportCardGrade: `score<=100`
    - Subject: `kkm BETWEEN 0 AND 100`
    - SchoolClass: `gradeLevel BETWEEN 1 AND 12`
    - DocumentCounter: `lastValue>=0`
12. **Invoice status enum:** keep it as is. Do **not** add PENDING_VERIFICATION (D6).
13. **Correction to the schema doc:** replace "bulk generation uses skipDuplicates" with "pre-filter under the counter lock; plain createMany". This is the D12 flaw: INSERT IGNORE also swallows CHECK and FK violations. Other domains that rely on `skipDuplicates` (AUTO_ALPHA) should confirm those rows cannot violate a CHECK constraint.

---

## 7. Questions for the client

1. **How does the SPP amount vary?** Is it the same for everyone, different per grade or class, or different per student (scholarships, sibling discounts)?
   - The design stores a per-student rate, where 0 means exempt, and allows per-run overrides.
   - Are fees other than SPP needed now (uang gedung, seragam, study tour)? For now only the SPP type exists.
2. **Instalments.** Can one monthly SPP invoice be paid in parts (PARTIAL)? The default is yes, so that a transfer that arrives short can be approved for the amount received.
3. **Report-card format.**
   - Curriculum: K13 (A–D predicate relative to KKM, which is the default) or Kurikulum Merdeka (final grade plus a learning-outcome description, no predicate)?
   - Sections: the design has grade, predicate, description, homeroom note and sick/permitted/absent counts. Are attitude, extracurricular or achievement sections needed as well?
4. **Numbering format.** Is there an official format for invoice and receipt numbers, for example one that includes a school code? The default is `INV-2026-000123` and `KWT-2026-000123`, restarting each year per school.
5. **Late fees.** Is there a fine for late SPP payment? The design assumes there is none.
6. **PDF proofs.** PDFs cannot be sanitised the way images are. The design accepts them but only as a download for admins. Would the client rather accept images only, since mobile banking apps can always share a screenshot?
7. **Who can take sensitive actions.** Voiding a payment, unpublishing a report card and restoring an invoice are currently allowed for any school admin and recorded in the audit log. Do these need a second approver or a treasurer-only role? This is linked to the schema designer's question 10.
