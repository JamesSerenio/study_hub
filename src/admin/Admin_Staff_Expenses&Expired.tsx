// src/pages/Admin_Staff_Expenses&Expired.tsx
// ✅ Admin view: Damage/Expired logs + Inventory Loss logs + Cash outs logs + Bilin (Utang) logs
// ✅ TOPBAR ORDER: Dropdown -> Export -> Date -> Refresh
// ✅ Damage/Expired + Inventory Loss: filtered by selectedDate
// ✅ Cash outs: filtered by cashout_date = selectedDate
// ✅ Bilin (Utang): whole week (Mon-Sun) based on selectedDate
// ✅ Case-insensitive name grouping
// ✅ VOID uses RPC void_addon_expense (restores counters)
// ✅ DELETE deletes log only (no revert)
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
import { trashOutline, closeCircleOutline, refreshOutline, downloadOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type SectionKind = "damage_expired" | "inventory_loss" | "cash_outs" | "bilin";

// ✅ unify with DB + Admin_Item_Lists
type ExpenseType = "expired" | "inventory_loss" | "bilin";

type ExpenseRow = {
  id: string;
  created_at: string;
  add_on_id: string;
  full_name: string;
  category: string;
  product_name: string;
  quantity: number;
  expense_type: ExpenseType;
  expense_amount: number;
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
  expense_amount: number | string | null;
  description: string | null;
  voided: boolean | null;
  voided_at: string | null;
};

/* =========================
   CASH OUTS TYPES
========================= */
type CashOutRow = {
  id: string;
  created_at: string;
  created_by: string;
  cashout_date: string;
  cashout_time: string;
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

const startOfLocalDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const getWeekRangeMonSun = (selectedYmd: string): { start: Date; endExclusive: Date } => {
  const base = new Date(`${selectedYmd}T00:00:00`);
  const day = base.getDay(); // 0 Sun ... 6 Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = startOfLocalDay(new Date(base.getTime() + diffToMon * 24 * 60 * 60 * 1000));
  const endExclusive = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, endExclusive };
};

const inRange = (d: Date, start: Date, endExclusive: Date): boolean => {
  const t = d.getTime();
  return t >= start.getTime() && t < endExclusive.getTime();
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
};

const typeLabel = (t: ExpenseType): string => {
  if (t === "expired") return "Expired / Damaged";
  if (t === "inventory_loss") return "Inventory Loss";
  return "Bilin (Utang)";
};

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
  const x = String(v ?? "").trim().toLowerCase();
  if (x === "expired") return "expired";
  if (x === "inventory_loss") return "inventory_loss";
  if (x === "bilin") return "bilin";

  // backward-compat (old rows)
  if (x === "staff_consumed" || x === "staff_consume") return "inventory_loss";

  return null;
};

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normNameKey = (name: string): string => String(name ?? "").trim().toLowerCase();
const prettyName = (name: string): string => String(name ?? "").trim() || "—";

const cashOutDateTimeDate = (r: CashOutRow): Date => {
  const date = String(r.cashout_date ?? "").trim();
  const time = String(r.cashout_time ?? "").trim();
  if (date && time) {
    const isoLike = `${date}T${time}`;
    const d = new Date(isoLike);
    if (Number.isFinite(d.getTime())) return d;
  }
  const fallback = new Date(r.created_at);
  return Number.isFinite(fallback.getTime()) ? fallback : new Date();
};

type BilinSummaryRow = {
  key: string;
  display_name: string;
  total_qty: number;
  total_amount: number;
  tx_count: number;
};

const Admin_Staff_Expenses_Expired: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [cashOuts, setCashOuts] = useState<CashOutRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>("");

  const [confirmVoid, setConfirmVoid] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);
  const [confirmDeleteCashOut, setConfirmDeleteCashOut] = useState<CashOutRow | null>(null);

  const [busyId, setBusyId] = useState<string>("");

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [section, setSection] = useState<SectionKind>("damage_expired");

  const fetchExpenses = async (): Promise<ExpenseRow[]> => {
    const { data, error } = await supabase
      .from("add_on_expenses")
      .select("id, created_at, add_on_id, full_name, category, product_name, quantity, expense_type, expense_amount, description, voided, voided_at")
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
          expense_amount: toMoney(r.expense_amount),
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
      .select("id, created_at, created_by, cashout_date, cashout_time, type, description, amount")
      .order("created_at", { ascending: false })
      .returns<CashOutRowDB[]>();

    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      created_by: r.created_by,
      cashout_date: String(r.cashout_date ?? "").trim(),
      cashout_time: String(r.cashout_time ?? "").trim(),
      type: String(r.type ?? "").trim(),
      description: String(r.description ?? "").trim(),
      amount: toMoney(r.amount),
    }));
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

  // ✅ Daily filter by selectedDate (for damage/expired + inventory loss views)
  const rowsBySelectedDate = useMemo(() => {
    return rows.filter((r) => {
      const d = new Date(r.created_at);
      if (!Number.isFinite(d.getTime())) return false;
      return yyyyMmDdLocal(d) === selectedDate;
    });
  }, [rows, selectedDate]);

  // ✅ These 2 sections share same table, just different expense_type filter
  const expenseRowsForSection = useMemo(() => {
    if (section === "inventory_loss") {
      return rowsBySelectedDate.filter((r) => r.expense_type === "inventory_loss");
    }
    // damage_expired
    return rowsBySelectedDate.filter((r) => r.expense_type === "expired" || r.expense_type === "inventory_loss");
  }, [rowsBySelectedDate, section]);

  const totalDamageExpiredQty = useMemo(
    () => expenseRowsForSection.reduce((sum, r) => sum + (Number.isFinite(r.quantity) ? r.quantity : 0), 0),
    [expenseRowsForSection]
  );
  const totalDamageExpiredVoided = useMemo(() => expenseRowsForSection.filter((r) => r.voided).length, [expenseRowsForSection]);

  // ✅ Week range for bilin
  const bilinWeek = useMemo(() => getWeekRangeMonSun(selectedDate), [selectedDate]);

  const bilinWeekRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.expense_type !== "bilin") return false;
      const d = new Date(r.created_at);
      if (!Number.isFinite(d.getTime())) return false;
      return inRange(d, bilinWeek.start, bilinWeek.endExclusive);
    });
  }, [rows, bilinWeek.start, bilinWeek.endExclusive]);

  const bilinSummary = useMemo((): BilinSummaryRow[] => {
    const map = new Map<string, BilinSummaryRow>();

    for (const r of bilinWeekRows) {
      if (r.voided) continue;
      const key = normNameKey(r.full_name);
      if (!key) continue;

      const qty = Number.isFinite(r.quantity) ? r.quantity : 0;
      const amt = Number.isFinite(r.expense_amount) ? r.expense_amount : 0;

      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          key,
          display_name: prettyName(r.full_name),
          total_qty: qty,
          total_amount: amt,
          tx_count: 1,
        });
      } else {
        const bestName =
          prettyName(prev.display_name).length >= prettyName(r.full_name).length
            ? prev.display_name
            : prettyName(r.full_name);

        map.set(key, {
          ...prev,
          display_name: bestName,
          total_qty: prev.total_qty + qty,
          total_amount: prev.total_amount + amt,
          tx_count: prev.tx_count + 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
  }, [bilinWeekRows]);

  const bilinGrandTotal = useMemo(() => bilinSummary.reduce((s, x) => s + x.total_amount, 0), [bilinSummary]);

  const filteredCashOuts = useMemo(() => cashOuts.filter((r) => r.cashout_date === selectedDate), [cashOuts, selectedDate]);
  const cashOutsTotal = useMemo(() => filteredCashOuts.reduce((sum, r) => sum + r.amount, 0), [filteredCashOuts]);

  // ===== Excel helpers
  const applyHeaderStyle = (row: ExcelJS.Row): void => {
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = 20;

    row.eachCell((cell) => {
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });
  };

  const applyHeaderStyleRange = (row: ExcelJS.Row, startCol: number, endCol: number): void => {
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = 20;

    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    }
  };

  const applyCellBorders = (row: ExcelJS.Row, startCol: number, endCol: number): void => {
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
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

  const exportExcel = async (): Promise<void> => {
    try {
      const now = new Date();

      const wb = new ExcelJS.Workbook();
      wb.creator = "Admin";
      wb.created = now;

      const ws = wb.addWorksheet("Logs", { views: [{ state: "frozen", ySplit: 6 }] });

      ws.columns = [
        { header: "Col1", key: "c1", width: 22 },
        { header: "Col2", key: "c2", width: 30 },
        { header: "Col3", key: "c3", width: 16 },
        { header: "Col4", key: "c4", width: 10 },
        { header: "Col5", key: "c5", width: 16 },
        { header: "Col6", key: "c6", width: 34 },
        { header: "Col7", key: "c7", width: 22 },
        { header: "Col8", key: "c8", width: 20 },
      ];

      ws.mergeCells(1, 1, 1, 8);
      ws.mergeCells(2, 1, 2, 8);
      ws.mergeCells(3, 1, 3, 8);
      ws.mergeCells(4, 1, 4, 8);

      const sectionLabel =
        section === "damage_expired"
          ? "DAMAGE/EXPIRED"
          : section === "inventory_loss"
            ? "INVENTORY LOSS"
            : section === "cash_outs"
              ? "CASH OUTS"
              : "BILIN (UTANG)";

      ws.getCell("A1").value = `STAFF LOGS REPORT — ${sectionLabel}`;

      if (section === "bilin") {
        ws.getCell("A2").value = `Week: ${yyyyMmDdLocal(bilinWeek.start)} to ${yyyyMmDdLocal(
          new Date(bilinWeek.endExclusive.getTime() - 1)
        )} (Mon-Sun)`;
      } else {
        ws.getCell("A2").value = `Date: ${selectedDate}`;
      }

      ws.getCell("A3").value = `Generated: ${now.toLocaleString()}`;

      styleTitleCell(ws.getCell("A1"), 16, true);
      styleMetaCell(ws.getCell("A2"));
      styleMetaCell(ws.getCell("A3"));

      if (section === "cash_outs") {
        ws.getCell("A4").value = `Rows: ${filteredCashOuts.length}   Total: ${peso(cashOutsTotal)}`;
      } else if (section === "bilin") {
        ws.getCell("A4").value = `People: ${bilinSummary.length}   Grand Total: ${peso(bilinGrandTotal)}`;
      } else {
        ws.getCell("A4").value = `Rows: ${expenseRowsForSection.length}   Total Qty: ${totalDamageExpiredQty}   Voided: ${totalDamageExpiredVoided}`;
      }
      styleMetaCell(ws.getCell("A4"), true);

      blankRow(ws, 5);

      if (section === "cash_outs") {
        const h = ws.getRow(6);

        ws.mergeCells(6, 2, 6, 4); // B-D
        ws.mergeCells(6, 6, 6, 7); // F-G

        h.getCell(1).value = "Type";
        h.getCell(2).value = "Description";
        h.getCell(5).value = "Amount";
        h.getCell(6).value = "Date & Time";
        h.getCell(8).value = "";

        applyHeaderStyleRange(h, 1, 7);
        applyCellBorders(h, 1, 7);
        h.commit();

        let cur = 7;

        for (const r of filteredCashOuts) {
          const row = ws.getRow(cur);

          ws.mergeCells(cur, 2, cur, 4);
          ws.mergeCells(cur, 6, cur, 7);

          row.getCell(1).value = r.type || "—";
          row.getCell(2).value = r.description || "—";

          row.getCell(5).value = Number(r.amount ?? 0);
          row.getCell(5).numFmt = '"₱"#,##0.00';

          const dt = cashOutDateTimeDate(r);
          row.getCell(6).value = dt;
          row.getCell(6).numFmt = "m/d/yyyy h:mm AM/PM";

          row.height = 22;

          applyCellBorders(row, 1, 7);
          row.commit();
          cur++;
        }
      } else if (section === "bilin") {
        const hSum = ws.getRow(6);
        hSum.values = ["Staff", "Tx Count", "Total Qty", "Total Amount", "", "", "", ""];
        applyHeaderStyle(hSum);
        hSum.commit();

        let cur = 7;
        for (const s of bilinSummary) {
          const row = ws.getRow(cur);
          row.getCell(1).value = s.display_name;
          row.getCell(2).value = s.tx_count;
          row.getCell(3).value = s.total_qty;
          row.getCell(4).value = s.total_amount;
          row.getCell(4).numFmt = '"₱"#,##0.00';
          row.height = 20;
          applyCellBorders(row, 1, 4);
          row.commit();
          cur++;
        }

        cur += 2;
        blankRow(ws, cur - 1);

        const h = ws.getRow(cur);
        h.values = ["Full Name", "Product", "Category", "Qty", "Amount", "Description", "Date & Time", "Status"];
        applyHeaderStyle(h);
        h.commit();
        cur++;

        for (const r of bilinWeekRows) {
          const row = ws.getRow(cur);
          const status = r.voided ? `VOIDED${r.voided_at ? ` • ${formatDateTime(r.voided_at)}` : ""}` : "ACTIVE";

          row.getCell(1).value = r.full_name || "—";
          row.getCell(2).value = r.product_name || "—";
          row.getCell(3).value = r.category || "—";
          row.getCell(4).value = Number(r.quantity ?? 0);
          row.getCell(5).value = Number(r.expense_amount ?? 0);
          row.getCell(5).numFmt = '"₱"#,##0.00';
          row.getCell(6).value = r.description || "—";
          row.getCell(7).value = formatDateTime(r.created_at);
          row.getCell(8).value = status;

          row.height = 22;
          applyCellBorders(row, 1, 8);

          if (r.voided) {
            for (let c = 1; c <= 8; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };
          }

          row.commit();
          cur++;
        }
      } else {
        // damage_expired OR inventory_loss
        const h = ws.getRow(6);
        h.values = ["Full Name", "Product", "Category", "Qty", "Type", "Description", "Date & Time", "Status"];
        applyHeaderStyle(h);
        h.commit();

        let cur = 7;
        for (const r of expenseRowsForSection) {
          const row = ws.getRow(cur);
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
          applyCellBorders(row, 1, 8);

          if (r.voided) {
            for (let c = 1; c <= 8; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };
          }

          row.commit();
          cur++;
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      const pad2 = (n: number) => String(n).padStart(2, "0");
      const filenameNow = new Date();
      const y = filenameNow.getFullYear();
      const m = pad2(filenameNow.getMonth() + 1);
      const d = pad2(filenameNow.getDate());
      const hh = pad2(filenameNow.getHours());
      const mm = pad2(filenameNow.getMinutes());

      const sec =
        section === "damage_expired"
          ? "DamageExpired"
          : section === "inventory_loss"
            ? "InventoryLoss"
            : section === "cash_outs"
              ? "CashOuts"
              : "Bilin";

      const dateLabel =
        section === "bilin"
          ? `${yyyyMmDdLocal(bilinWeek.start)}_to_${yyyyMmDdLocal(new Date(bilinWeek.endExclusive.getTime() - 1))}`
          : selectedDate;

      const fileName = `MeTyme_StaffLogs_${sec}_${dateLabel}_generated_${y}-${m}-${d}_${hh}${mm}.xlsx`;

      saveAs(blob, fileName);
      setToastMsg("Exported Excel successfully.");
      setToastOpen(true);
    } catch (e) {
      console.error(e);
      setToastMsg("Export failed.");
      setToastOpen(true);
    }
  };

  // ✅ VOID via RPC
  const doVoid = async (r: ExpenseRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);

    try {
      const { error } = await supabase.rpc("void_addon_expense", { p_expense_id: r.id });
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

  const sectionTitle =
    section === "damage_expired"
      ? "Damage/Expired"
      : section === "inventory_loss"
        ? "Inventory Loss"
        : section === "cash_outs"
          ? "Cash Outs"
          : "Bilin (Utang)";

  const sectionCount =
    section === "cash_outs" ? filteredCashOuts.length : section === "bilin" ? bilinWeekRows.length : expenseRowsForSection.length;

  const bilinWeekLabel = `${yyyyMmDdLocal(bilinWeek.start)} to ${yyyyMmDdLocal(new Date(bilinWeek.endExclusive.getTime() - 1))}`;

  return (
    <IonPage>
      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Staff Logs</h2>
              <div className="customer-subtext">
                Showing: <strong>{sectionTitle}</strong> •{" "}
                {section === "bilin" ? (
                  <>
                    Week (Mon-Sun): <strong>{bilinWeekLabel}</strong>
                  </>
                ) : (
                  <>
                    Date: <strong>{selectedDate}</strong>
                  </>
                )}{" "}
                • Rows: <strong>{sectionCount}</strong>
              </div>
            </div>

            {/* ✅ ORDER: Dropdown -> Export -> Date -> Refresh */}
            <div className="customer-topbar-right">
              <label className="date-pill" style={{ marginLeft: 10 }}>
                <span className="date-pill-label">Show</span>
                <select className="date-pill-input" value={section} onChange={(e) => setSection(e.currentTarget.value as SectionKind)}>
                  <option value="damage_expired">Damage/Expired</option>
                  <option value="inventory_loss">Inventory Loss</option>
                  <option value="cash_outs">Cash Outs</option>
                  <option value="bilin">Bilin (Utang)</option>
                </select>
                <span className="date-pill-icon" aria-hidden="true">
                  ▾
                </span>
              </label>

              <IonButton className="receipt-btn" onClick={() => void exportExcel()} fill="outline">
                <IonIcon slot="start" icon={downloadOutline} />
                Export Excel
              </IonButton>

              <label className="date-pill" style={{ marginLeft: 10 }}>
                <span className="date-pill-label">{section === "bilin" ? "Week of" : "Date"}</span>
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

              <IonButton className="receipt-btn" onClick={() => void fetchAll()} fill="outline">
                <IonIcon slot="start" icon={refreshOutline} />
                Refresh
              </IonButton>
            </div>
          </div>

          {loading ? (
            <div className="customer-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IonSpinner />
              <span>Loading...</span>
            </div>
          ) : section === "cash_outs" ? (
            filteredCashOuts.length === 0 ? (
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

                <div className="customer-note" style={{ marginTop: 10 }}>
                  Total cash outs: <strong>{peso(cashOutsTotal)}</strong>
                </div>
              </div>
            )
          ) : section === "bilin" ? (
            bilinWeekRows.length === 0 ? (
              <p className="customer-note">No BILIN (UTANG) records found for this week</p>
            ) : (
              <>
                <div className="customer-note" style={{ marginTop: 6 }}>
                  People: <strong>{bilinSummary.length}</strong> • Grand total this week: <strong>{peso(bilinGrandTotal)}</strong>
                </div>

                <div className="customer-table-wrap" style={{ marginTop: 10 }} key={`bilin-sum-${selectedDate}`}>
                  <table className="customer-table admin-exp-table">
                    <thead>
                      <tr>
                        <th>Staff Name</th>
                        <th>Transactions</th>
                        <th>Total Qty</th>
                        <th>Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bilinSummary.map((s) => (
                        <tr key={s.key}>
                          <td>
                            <span className="cell-strong">{s.display_name}</span>
                          </td>
                          <td>
                            <span className="pill pill--info">{s.tx_count}</span>
                          </td>
                          <td>
                            <span className="pill pill--dark">{s.total_qty}</span>
                          </td>
                          <td>
                            <span className="pill pill--dark">{peso(s.total_amount)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="customer-table-wrap" style={{ marginTop: 14 }} key={`bilin-${selectedDate}`}>
                  <table className="customer-table admin-exp-table">
                    <thead>
                      <tr>
                        <th>Full Name</th>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Qty</th>
                        <th>Amount</th>
                        <th>Date & Time</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {bilinWeekRows.map((r) => (
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
                            <span className="pill pill--dark">{peso(r.expense_amount)}</span>
                          </td>

                          <td>{formatDateTime(r.created_at)}</td>

                          <td>
                            <div className="action-stack action-stack--row">
                              <button
                                className="receipt-btn btn-danger"
                                disabled={r.voided || busyId === r.id}
                                onClick={() => setConfirmVoid(r)}
                                title={r.voided ? "Already voided" : "Void (RPC restores counters)"}
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
              </>
            )
          ) : expenseRowsForSection.length === 0 ? (
            <p className="customer-note">
              No {section === "inventory_loss" ? "INVENTORY LOSS" : "DAMAGE/EXPIRED"} records found for this date
            </p>
          ) : (
            <div className="customer-table-wrap" key={`exp-${selectedDate}-${section}`}>
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
                  {expenseRowsForSection.map((r) => (
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
                            title={r.voided ? "Already voided" : "Void (RPC restores counters)"}
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

              <div className="customer-note" style={{ marginTop: 10 }}>
                Total qty: <strong>{totalDamageExpiredQty}</strong> • Voided: <strong>{totalDamageExpiredVoided}</strong>
              </div>
            </div>
          )}

          {/* ALERTS */}
          <IonAlert
            isOpen={!!confirmVoid}
            onDidDismiss={() => setConfirmVoid(null)}
            header="Void this record?"
            message={
              confirmVoid ? `This will restore counts by reverting ${typeLabel(confirmVoid.expense_type)} (qty: ${confirmVoid.quantity}).` : ""
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
