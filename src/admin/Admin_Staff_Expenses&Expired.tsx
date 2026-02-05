// src/pages/Admin_Staff_Expenses&Expired.tsx
// ✅ Admin view: staff expenses/expired logs + cash outs logs
// ✅ Date filter calendar (same style as Customer_Lists: date-pill)
// ✅ Same classnames as Customer_Lists for consistent CSS
// ✅ Expenses: Admin can DELETE (no revert) + VOID (reverts via trigger)
// ✅ Cash outs: Admin can DELETE (no revert)
// ✅ Export EXCEL (.xlsx) nicely formatted (NO images)
// ✅ Export is ONE SHEET — Expenses on TOP, CashOuts BELOW
// ✅ FIX: CashOuts "Date & Time" layout now looks like Expenses (wide + clean)
//    - Date&Time placed on wide merged columns (F-G), not narrow column D
//    - uses real Date value + Excel numFmt (no ugly wrapping)
// ✅ STRICT TS, NO any, NO unknown

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonAlert,
} from "@ionic/react";
import {
  trashOutline,
  closeCircleOutline,
  refreshOutline,
  downloadOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

// ✅ Excel export
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type ExpenseType = "expired" | "staff_consumed";

type ExpenseRow = {
  id: string;
  created_at: string; // timestamptz
  add_on_id: string;
  full_name: string;
  category: string;
  product_name: string;
  quantity: number;
  expense_type: ExpenseType;
  description: string;
  voided: boolean;
  voided_at: string | null;
};

type ExpenseRowDB = {
  id: string;
  created_at: string;
  add_on_id: string;
  full_name: string | null;
  category: string | null;
  product_name: string | null;
  quantity: number | string | null;
  expense_type: string | null;
  description: string | null;
  voided: boolean | null;
  voided_at: string | null;
};

/* =========================
   CASH OUTS TYPES
========================= */

type CashOutRow = {
  id: string;
  created_at: string; // timestamptz
  created_by: string;
  cashout_date: string; // YYYY-MM-DD
  cashout_time: string; // HH:mm:ss(.fff)
  type: string;
  description: string;
  amount: number;
};

type CashOutRowDB = {
  id: string;
  created_at: string;
  created_by: string;
  cashout_date: string | null;
  cashout_time: string | null;
  type: string | null;
  description: string | null;
  amount: number | string | null;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
};

const typeLabel = (t: ExpenseType): string =>
  t === "expired" ? "Expired" : "Staff Consumed";

const toQty = (v: number | string | null): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toMoney = (v: number | string | null): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toExpenseType = (v: string | null): ExpenseType | null => {
  if (v === "expired") return "expired";
  if (v === "staff_consumed") return "staff_consumed";
  return null;
};

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/* ✅ Cashout DateTime as REAL Date (for Excel nice format) */
const cashOutDateTimeDate = (r: CashOutRow): Date => {
  const date = String(r.cashout_date ?? "").trim(); // YYYY-MM-DD
  const time = String(r.cashout_time ?? "").trim(); // HH:mm:ss(.fff)
  if (date && time) {
    const isoLike = `${date}T${time}`;
    const d = new Date(isoLike);
    if (Number.isFinite(d.getTime())) return d;
  }
  const fallback = new Date(r.created_at);
  return Number.isFinite(fallback.getTime()) ? fallback : new Date();
};

const Admin_Staff_Expenses_Expired: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [cashOuts, setCashOuts] = useState<CashOutRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>("");

  const [confirmVoid, setConfirmVoid] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);

  const [confirmDeleteCashOut, setConfirmDeleteCashOut] =
    useState<CashOutRow | null>(null);

  const [busyId, setBusyId] = useState<string>("");

  // ✅ Date filter (same pattern as Customer_Lists)
  const [selectedDate, setSelectedDate] = useState<string>(
    yyyyMmDdLocal(new Date())
  );

  const fetchExpenses = async (): Promise<ExpenseRow[]> => {
    const { data, error } = await supabase
      .from("add_on_expenses")
      .select(
        "id, created_at, add_on_id, full_name, category, product_name, quantity, expense_type, description, voided, voided_at"
      )
      .order("created_at", { ascending: false })
      .returns<ExpenseRowDB[]>();

    if (error) throw error;

    const normalized: ExpenseRow[] = (data ?? [])
      .map((r): ExpenseRow | null => {
        const et = toExpenseType(r.expense_type);
        if (!et) return null;

        return {
          id: r.id,
          created_at: r.created_at,
          add_on_id: r.add_on_id,
          full_name: String(r.full_name ?? "").trim(),
          category: String(r.category ?? "").trim(),
          product_name: String(r.product_name ?? "").trim(),
          quantity: toQty(r.quantity),
          expense_type: et,
          description: String(r.description ?? "").trim(),
          voided: Boolean(r.voided ?? false),
          voided_at: r.voided_at ?? null,
        };
      })
      .filter((x): x is ExpenseRow => x !== null);

    return normalized;
  };

  const fetchCashOuts = async (): Promise<CashOutRow[]> => {
    const { data, error } = await supabase
      .from("cash_outs")
      .select(
        "id, created_at, created_by, cashout_date, cashout_time, type, description, amount"
      )
      .order("created_at", { ascending: false })
      .returns<CashOutRowDB[]>();

    if (error) throw error;

    const normalized: CashOutRow[] = (data ?? []).map((r) => {
      return {
        id: r.id,
        created_at: r.created_at,
        created_by: r.created_by,
        cashout_date: String(r.cashout_date ?? "").trim(),
        cashout_time: String(r.cashout_time ?? "").trim(),
        type: String(r.type ?? "").trim(),
        description: String(r.description ?? "").trim(),
        amount: toMoney(r.amount),
      };
    });

    return normalized;
  };

  const fetchAll = async (): Promise<void> => {
    setLoading(true);
    try {
      const [exp, co] = await Promise.all([fetchExpenses(), fetchCashOuts()]);
      setRows(exp);
      setCashOuts(co);
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to load logs.");
      setToastOpen(true);
      setRows([]);
      setCashOuts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchAll().finally(() => event.detail.complete());
  };

  // ✅ Filter expenses by selectedDate using created_at local date
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const d = new Date(r.created_at);
      if (!Number.isFinite(d.getTime())) return false;
      return yyyyMmDdLocal(d) === selectedDate;
    });
  }, [rows, selectedDate]);

  // ✅ Filter cash outs by selectedDate using cashout_date (best)
  const filteredCashOuts = useMemo(() => {
    return cashOuts.filter((r) => r.cashout_date === selectedDate);
  }, [cashOuts, selectedDate]);

  const cashOutsTotal = useMemo(() => {
    return filteredCashOuts.reduce((sum, r) => sum + r.amount, 0);
  }, [filteredCashOuts]);

  const totalExpensesQty = useMemo(() => {
    return filteredRows.reduce(
      (sum, r) => sum + (Number.isFinite(r.quantity) ? r.quantity : 0),
      0
    );
  }, [filteredRows]);

  const totalVoided = useMemo(
    () => filteredRows.filter((r) => r.voided).length,
    [filteredRows]
  );

  // ✅ helpers for styling sheets
  const applyHeaderStyle = (row: ExcelJS.Row): void => {
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = 20;

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });
  };

  const applyHeaderStyleRange = (
    row: ExcelJS.Row,
    startCol: number,
    endCol: number
  ): void => {
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = 20;

    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    }
  };

  const applyCellBorders = (row: ExcelJS.Row, startCol: number, endCol: number): void => {
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  };

  const styleTitleCell = (cell: ExcelJS.Cell, size = 16, bold = true): void => {
    cell.font = { size, bold };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  };

  const styleMetaCell = (cell: ExcelJS.Cell, bold = false): void => {
    cell.font = { size: 11, bold };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  };

  const blankRow = (ws: ExcelJS.Worksheet, rowNumber: number): void => {
    const r = ws.getRow(rowNumber);
    r.height = 10;
    r.commit();
  };

  /* =========================================================
     ✅ EXPORT: ONE SHEET
     - Expenses on TOP (same as before)
     - Cash Outs BELOW (fixed Date&Time layout like Expenses)
       Layout:
         A: Type
         B-D (merged): Description
         E: Amount
         F-G (merged): Date & Time  ✅ wide and clean
         H: blank
  ========================================================= */
  const exportExcel = async (): Promise<void> => {
    try {
      const now = new Date();

      const expRows = filteredRows;
      const coRows = filteredCashOuts;

      const wb = new ExcelJS.Workbook();
      wb.creator = "Admin";
      wb.created = now;

      const ws = wb.addWorksheet("Logs", { views: [{ state: "frozen", ySplit: 6 }] });

      // 8 columns (same as expenses)
      ws.columns = [
        { header: "Col1", key: "c1", width: 22 }, // A
        { header: "Col2", key: "c2", width: 30 }, // B
        { header: "Col3", key: "c3", width: 16 }, // C
        { header: "Col4", key: "c4", width: 10 }, // D
        { header: "Col5", key: "c5", width: 16 }, // E
        { header: "Col6", key: "c6", width: 34 }, // F
        { header: "Col7", key: "c7", width: 22 }, // G
        { header: "Col8", key: "c8", width: 20 }, // H
      ];

      /* =========================
         TOP TITLE BLOCK (rows 1-4)
      ========================= */
      ws.mergeCells(1, 1, 1, 8);
      ws.mergeCells(2, 1, 2, 8);
      ws.mergeCells(3, 1, 3, 8);
      ws.mergeCells(4, 1, 4, 8);

      ws.getCell("A1").value = "STAFF EXPENSES / EXPIRED REPORT";
      ws.getCell("A2").value = `Date: ${selectedDate}`;
      ws.getCell("A3").value = `Generated: ${now.toLocaleString()}`;
      ws.getCell("A4").value = `Expenses Rows: ${expRows.length}   Total Qty: ${totalExpensesQty}   Voided: ${totalVoided}`;

      styleTitleCell(ws.getCell("A1"), 16, true);
      styleMetaCell(ws.getCell("A2"));
      styleMetaCell(ws.getCell("A3"));
      styleMetaCell(ws.getCell("A4"), true);

      blankRow(ws, 5);

      /* =========================
         EXPENSES HEADER (row 6)
      ========================= */
      const h1 = ws.getRow(6);
      h1.values = ["Full Name", "Product", "Category", "Qty", "Type", "Description", "Date & Time", "Status"];
      applyHeaderStyle(h1);
      h1.commit();

      /* =========================
         EXPENSES DATA (start row 7)
      ========================= */
      let curRow = 7;

      for (const r of expRows) {
        const row = ws.getRow(curRow);

        const status = r.voided ? `VOIDED${r.voided_at ? ` • ${formatDateTime(r.voided_at)}` : ""}` : "ACTIVE";

        row.getCell(1).value = r.full_name || "—";
        row.getCell(2).value = r.product_name || "—";
        row.getCell(3).value = r.category || "—";
        row.getCell(4).value = Number(r.quantity ?? 0);
        row.getCell(5).value = typeLabel(r.expense_type);
        row.getCell(6).value = r.description || "—";
        row.getCell(7).value = formatDateTime(r.created_at);
        row.getCell(8).value = status;

        row.height = 22;

        for (let c = 1; c <= 8; c++) {
          const cell = row.getCell(c);
          cell.alignment =
            c === 2 || c === 6
              ? { vertical: "middle", horizontal: "left", wrapText: true }
              : { vertical: "middle", horizontal: c === 4 ? "center" : "left", wrapText: true };
        }
        applyCellBorders(row, 1, 8);

        if (r.voided) {
          for (let c = 1; c <= 8; c++) {
            row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };
          }
        }

        row.commit();
        curRow++;
      }

      /* =========================
         CASH OUTS SECTION
      ========================= */
      curRow += 1;
      blankRow(ws, curRow - 1);

      ws.mergeCells(curRow, 1, curRow, 8);
      ws.mergeCells(curRow + 1, 1, curRow + 1, 8);

      ws.getCell(curRow, 1).value = "CASH OUTS REPORT";
      ws.getCell(curRow + 1, 1).value = `Cash Outs Rows: ${coRows.length}   Total: ${peso(cashOutsTotal)}`;

      styleTitleCell(ws.getCell(curRow, 1), 14, true);
      styleMetaCell(ws.getCell(curRow + 1, 1), true);

      ws.getRow(curRow).height = 20;
      ws.getRow(curRow + 1).height = 18;

      curRow += 3;
      blankRow(ws, curRow - 1);

      /* =========================
         CASH OUTS HEADER (nice layout)
         A: Type
         B-D merged: Description
         E: Amount
         F-G merged: Date & Time (wide like expenses)
      ========================= */
      const h2 = ws.getRow(curRow);

      // merges for header row
      ws.mergeCells(curRow, 2, curRow, 4); // B-D
      ws.mergeCells(curRow, 6, curRow, 7); // F-G

      h2.getCell(1).value = "Type";
      h2.getCell(2).value = "Description"; // (B-D merged)
      h2.getCell(5).value = "Amount";
      h2.getCell(6).value = "Date & Time"; // (F-G merged)
      h2.getCell(8).value = "";

      // style only A..G (H ignored)
      applyHeaderStyleRange(h2, 1, 7);
      applyCellBorders(h2, 1, 7);

      // header alignment (wrap ok)
      for (const c of [1, 2, 5, 6]) {
        h2.getCell(c).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }

      h2.commit();
      curRow++;

      /* =========================
         CASH OUTS DATA
      ========================= */
      for (const r of coRows) {
        const row = ws.getRow(curRow);

        // merges for data row
        ws.mergeCells(curRow, 2, curRow, 4); // B-D
        ws.mergeCells(curRow, 6, curRow, 7); // F-G

        row.getCell(1).value = r.type || "—";
        row.getCell(2).value = r.description || "—";

        row.getCell(5).value = Number(r.amount ?? 0);
        row.getCell(5).numFmt = '"₱"#,##0.00';

        // ✅ Real Date value + nice Excel format (no ugly wrap)
        const dt = cashOutDateTimeDate(r);
        row.getCell(6).value = dt;
        row.getCell(6).numFmt = 'm/d/yyyy h:mm AM/PM';

        row.height = 22;

        // align like expenses
        row.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        row.getCell(2).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        row.getCell(5).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
        row.getCell(6).alignment = { vertical: "middle", horizontal: "left", wrapText: true };

        applyCellBorders(row, 1, 7);

        row.commit();
        curRow++;
      }

      // ✅ Download
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const pad2 = (n: number) => String(n).padStart(2, "0");

          const filenameNow = new Date();
          const y = filenameNow.getFullYear();
          const m = pad2(filenameNow.getMonth() + 1);
          const d = pad2(filenameNow.getDate());
          const hh = pad2(filenameNow.getHours());
          const mm = pad2(filenameNow.getMinutes());

          const fileName = `MeTyme_Staff_Expenses_CashOuts_${selectedDate}_generated_${y}-${m}-${d}_${hh}${mm}.xlsx`;

          saveAs(blob, fileName);

      setToastMsg("Exported Excel successfully.");
      setToastOpen(true);
    } catch (e) {
      console.error(e);
      setToastMsg("Export failed.");
      setToastOpen(true);
    }
  };

  const doVoid = async (r: ExpenseRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase
        .from("add_on_expenses")
        .update({ voided: true })
        .eq("id", r.id)
        .eq("voided", false);

      if (error) throw error;

      setToastMsg("Voided. Stock/counts restored.");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to void record.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  const doDelete = async (r: ExpenseRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.from("add_on_expenses").delete().eq("id", r.id);
      if (error) throw error;

      setToastMsg("Deleted log (no stock changes).");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to delete record.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  const doDeleteCashOut = async (r: CashOutRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.from("cash_outs").delete().eq("id", r.id);
      if (error) throw error;

      setToastMsg("Deleted cash out.");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to delete cash out.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Staff Expenses & Expired</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>{" "}
                <span style={{ marginLeft: 8 }}>
                  (Expenses: <strong>{filteredRows.length}</strong> • Cash Outs:{" "}
                  <strong>{filteredCashOuts.length}</strong>)
                </span>
              </div>
            </div>

            <div className="customer-topbar-right">
              <IonButton className="receipt-btn" onClick={() => void exportExcel()} fill="outline">
                <IonIcon slot="start" icon={downloadOutline} />
                Export Excel
              </IonButton>

              <IonButton className="receipt-btn" onClick={() => void fetchAll()} fill="outline">
                <IonIcon slot="start" icon={refreshOutline} />
                Refresh
              </IonButton>

              <label className="date-pill" style={{ marginLeft: 10 }}>
                <span className="date-pill-label">Date</span>
                <input
                  className="date-pill-input"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
                />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="customer-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IonSpinner />
              <span>Loading...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="customer-note">No EXPENSE records found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={`exp-${selectedDate}`}>
              <table className="customer-table admin-exp-table">
                <thead>
                  <tr>
                    <th>Full Name</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Qty</th>
                    <th>Type</th>
                    <th>Date & Time</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id} className={r.voided ? "is-voided" : ""}>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{r.full_name || "—"}</span>
                          {r.voided && (
                            <span className="cell-sub">
                              <span className="pill pill--muted">VOIDED</span>
                              {r.voided_at ? ` • ${formatDateTime(r.voided_at)}` : ""}
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{r.product_name || "—"}</span>
                          <span className="cell-sub">{r.description || "—"}</span>
                        </div>
                      </td>

                      <td>{r.category || "—"}</td>

                      <td>
                        <span className="pill pill--dark">{r.quantity}</span>
                      </td>

                      <td>
                        <span className={`pill ${r.expense_type === "expired" ? "pill--warn" : "pill--info"}`}>
                          {typeLabel(r.expense_type)}
                        </span>
                      </td>

                      <td>{formatDateTime(r.created_at)}</td>

                      <td>
                        <div className="action-stack action-stack--row">
                          <button
                            className="receipt-btn btn-danger"
                            disabled={r.voided || busyId === r.id}
                            onClick={() => setConfirmVoid(r)}
                            title={r.voided ? "Already voided" : "Void (reverts stock via trigger)"}
                          >
                            <IonIcon icon={closeCircleOutline} />
                            <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Void"}</span>
                          </button>

                          <button
                            className="receipt-btn btn-gray"
                            disabled={busyId === r.id}
                            onClick={() => setConfirmDelete(r)}
                            title="Delete log only (no revert)"
                          >
                            <IonIcon icon={trashOutline} />
                            <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Delete"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CASH OUTS TABLE */}
          <div style={{ marginTop: 18 }}>
            <div className="customer-topbar" style={{ padding: 0, marginBottom: 10 }}>
              <div className="customer-topbar-left">
                <h2 className="customer-lists-title" style={{ fontSize: 18, margin: 0 }}>
                  Cash Outs
                </h2>
                <div className="customer-subtext" style={{ marginTop: 4 }}>
                  Total cash outs for <strong>{selectedDate}</strong>: <strong>{peso(cashOutsTotal)}</strong>
                </div>
              </div>
            </div>

            {loading ? null : filteredCashOuts.length === 0 ? (
              <p className="customer-note">No CASH OUTS found for this date</p>
            ) : (
              <div className="customer-table-wrap" key={`co-${selectedDate}`}>
                <table className="customer-table admin-cashouts-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Date & Time</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCashOuts.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="pill pill--info">{r.type || "—"}</span>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{r.description || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <span className="pill pill--dark">{peso(r.amount)}</span>
                        </td>
                        <td>{cashOutDateTimeDate(r).toLocaleString()}</td>
                        <td>
                          <div className="action-stack action-stack--row">
                            <button
                              className="receipt-btn btn-gray"
                              disabled={busyId === r.id}
                              onClick={() => setConfirmDeleteCashOut(r)}
                              title="Delete cash out"
                            >
                              <IonIcon icon={trashOutline} />
                              <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Delete"}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ALERTS */}
          <IonAlert
            isOpen={!!confirmVoid}
            onDidDismiss={() => setConfirmVoid(null)}
            header="Void this record?"
            message={
              confirmVoid
                ? `This will restore stock by reverting ${typeLabel(confirmVoid.expense_type)} (qty: ${confirmVoid.quantity}).`
                : ""
            }
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Void",
                role: "destructive",
                handler: () => {
                  const r = confirmVoid;
                  setConfirmVoid(null);
                  if (r) void doVoid(r);
                },
              },
            ]}
          />

          <IonAlert
            isOpen={!!confirmDelete}
            onDidDismiss={() => setConfirmDelete(null)}
            header="Delete this log?"
            message="This will delete the record only. Stock/counts will NOT change."
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Delete",
                role: "destructive",
                handler: () => {
                  const r = confirmDelete;
                  setConfirmDelete(null);
                  if (r) void doDelete(r);
                },
              },
            ]}
          />

          <IonAlert
            isOpen={!!confirmDeleteCashOut}
            onDidDismiss={() => setConfirmDeleteCashOut(null)}
            header="Delete this cash out?"
            message="This will delete the cash out record only."
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Delete",
                role: "destructive",
                handler: () => {
                  const r = confirmDeleteCashOut;
                  setConfirmDeleteCashOut(null);
                  if (r) void doDeleteCashOut(r);
                },
              },
            ]}
          />

          <IonToast isOpen={toastOpen} message={toastMsg} duration={2500} onDidDismiss={() => setToastOpen(false)} />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Staff_Expenses_Expired;
