// src/pages/Customer_Consignment_Record.tsx
// ✅ Shows customer_session_consignment records
// ✅ Join with consignment for item info (name/image/size/category)
// ✅ View Receipt modal (same vibe as Admin_Customer_Add_ons receipt)
// ✅ Payment modal (Cash + GCash, FREE INPUTS, NO LIMIT) -> RPC set_consignment_payment
// ✅ Manual PAID toggle -> RPC set_consignment_paid_status
// ✅ VOID (required reason) -> returns stock by RPC void_customer_consignment
// ✅ NEW: CANCEL (required reason) -> archives to consignment_cancelled + deletes row from customer_session_consignment
// ✅ UPDATED (YOUR REQUEST):
//    - Filter Mode: DAY / WEEK / MONTH (anchor date)
//    - Export to Excel by DAY / WEEK / MONTH
//    - DELETE (permanent) by DAY / WEEK / MONTH (confirmation modal)
// ✅ STRICT TS: NO any
// ✅ Same "customer-*" + "receipt-btn" vibe
// ✅ Uses PH range for filtering created_at (timestamptz)

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

// ✅ EXCEL
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type NumericLike = number | string;

type FilterMode = "day" | "week" | "month";

type ConsignmentInfo = {
  item_name: string;
  size: string | null;
  image_url: string | null;
  category: string | null;
};

type CustomerConsignmentRow = {
  id: string;
  created_at: string | null;

  consignment_id: string;
  quantity: number;
  price: NumericLike;
  total: NumericLike | null;

  full_name: string;
  seat_number: string;

  paid_at: string | null;
  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;

  voided: boolean | number | string | null;
  voided_at: string | null;
  void_note: string | null;

  consignment: ConsignmentInfo | null;
};

type ReceiptItem = {
  id: string;
  item_name: string;
  category: string;
  size: string | null;
  quantity: number;
  price: number;
  total: number;
  image_url: string | null;
};

type ReceiptGroup = {
  id: string;
  created_at: string | null;
  full_name: string;
  seat_number: string;

  items: ReceiptItem[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;

  is_paid: boolean;
  paid_at: string | null;

  is_voided: boolean;
  voided_at: string | null;
  void_note: string | null;
};

/* ---------------- helpers ---------------- */

const pad2 = (n: number): string => String(n).padStart(2, "0");

const parseYmd = (ymd: string): { y: number; m: number; d: number } => {
  const parts = String(ymd || "").split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return { y, m, d };
};

const ymdFromUTCDate = (dt: Date): string => {
  const y = dt.getUTCFullYear();
  const m = pad2(dt.getUTCMonth() + 1);
  const d = pad2(dt.getUTCDate());
  return `${y}-${m}-${d}`;
};

const addDaysUTC = (dt: Date, days: number): Date => {
  const t = dt.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(t);
};

const toNumber = (v: NumericLike | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));
const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const show = (s: string | null | undefined, fallback = "-"): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : fallback;
};

const formatPHDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
};

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : "—";
};

// ✅ today key in PH (YYYY-MM-DD)
const todayPHKey = (): string => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

// ✅ PH day bounds -> UTC ISO (for timestamptz filtering)
const phBoundsFromKeys = (startKey: string, endKey: string): { startISO: string; endISO: string } => {
  const startPH = new Date(`${startKey}T00:00:00.000+08:00`);
  const endPH = new Date(`${endKey}T23:59:59.999+08:00`);
  return { startISO: startPH.toISOString(), endISO: endPH.toISOString() };
};

// ✅ Week range keys (Mon-Sun) from anchor date key
const getWeekRangeMonSunKeys = (anchorYmd: string): { startKey: string; endKey: string } => {
  const { y, m, d } = parseYmd(anchorYmd);
  const base = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)); // treat as calendar date
  const day = base.getUTCDay(); // 0 Sun..6 Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = addDaysUTC(base, diffToMon);
  const end = addDaysUTC(start, 6);
  return { startKey: ymdFromUTCDate(start), endKey: ymdFromUTCDate(end) };
};

// ✅ Month range keys from anchor date key
const getMonthRangeKeys = (anchorYmd: string): { startKey: string; endKey: string; monthLabel: string } => {
  const { y, m } = parseYmd(anchorYmd);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const lastDay = new Date(Date.UTC(y, m, 0, 0, 0, 0, 0)); // day 0 of next month = last day current month
  const monthLabel = `${y}-${pad2(m)}`;
  return { startKey: ymdFromUTCDate(start), endKey: ymdFromUTCDate(lastDay), monthLabel };
};

const rangeFromMode = (
  mode: FilterMode,
  anchorYmd: string
): { startKey: string; endKey: string; label: string; fileLabel: string } => {
  if (mode === "day") {
    return { startKey: anchorYmd, endKey: anchorYmd, label: anchorYmd, fileLabel: anchorYmd };
  }
  if (mode === "week") {
    const w = getWeekRangeMonSunKeys(anchorYmd);
    return {
      startKey: w.startKey,
      endKey: w.endKey,
      label: `${w.startKey} to ${w.endKey} (Mon-Sun)`,
      fileLabel: `${w.startKey}_to_${w.endKey}`,
    };
  }
  const m = getMonthRangeKeys(anchorYmd);
  return {
    startKey: m.startKey,
    endKey: m.endKey,
    label: `${m.monthLabel} (${m.startKey} to ${m.endKey})`,
    fileLabel: m.monthLabel,
  };
};

/* ✅ Excel helpers */
const isLikelyUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());

const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
};

/* ---------------- component ---------------- */

const Customer_Consignment_Record: React.FC = () => {
  const [rows, setRows] = useState<CustomerConsignmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchText, setSearchText] = useState<string>("");

  // ✅ NEW: range mode + anchor date
  const [filterMode, setFilterMode] = useState<FilterMode>("day");
  const [anchorDate, setAnchorDate] = useState<string>(() => todayPHKey()); // YYYY-MM-DD (PH)

  const activeRange = useMemo(() => rangeFromMode(filterMode, anchorDate), [filterMode, anchorDate]);

  // receipt modal
  const [selectedOrder, setSelectedOrder] = useState<ReceiptGroup | null>(null);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<ReceiptGroup | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // paid toggle busy
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  // VOID modal
  const [voidTarget, setVoidTarget] = useState<CustomerConsignmentRow | null>(null);
  const [voidReason, setVoidReason] = useState<string>("");
  const [voiding, setVoiding] = useState<boolean>(false);

  // CANCEL modal
  const [cancelTarget, setCancelTarget] = useState<CustomerConsignmentRow | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);

  // ✅ NEW: export / delete-by-range
  const [exporting, setExporting] = useState<boolean>(false);
  const [deleteRangeOpen, setDeleteRangeOpen] = useState<boolean>(false);
  const [deletingByRange, setDeletingByRange] = useState<boolean>(false);

  // ✅ fetch whenever range changes
  useEffect(() => {
    void fetchByRange(activeRange.startKey, activeRange.endKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRange.startKey, activeRange.endKey]);

  const fetchByRange = async (startKey: string, endKey: string): Promise<void> => {
    setLoading(true);

    const { startISO, endISO } = phBoundsFromKeys(startKey, endKey);

    const { data, error } = await supabase
      .from("customer_session_consignment")
      .select(
        `
        id,
        created_at,
        consignment_id,
        quantity,
        price,
        total,
        full_name,
        seat_number,
        paid_at,
        gcash_amount,
        cash_amount,
        is_paid,
        voided,
        voided_at,
        void_note,
        consignment:consignment_id (
          item_name,
          size,
          image_url,
          category
        )
      `
      )
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at", { ascending: false })
      .returns<CustomerConsignmentRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH customer_session_consignment ERROR:", error);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data ?? []);
    setLoading(false);
  };

  // ✅ search locally
  const filtered = useMemo(() => {
    const q = norm(searchText);
    if (!q) return rows;

    return rows.filter((r) => {
      const fn = norm(r.full_name);
      const seat = norm(r.seat_number);
      const item = norm(r.consignment?.item_name ?? "");
      const cat = norm(r.consignment?.category ?? "");
      return fn.includes(q) || seat.includes(q) || item.includes(q) || cat.includes(q);
    });
  }, [rows, searchText]);

  const totals = useMemo(() => {
    let totalAmount = 0;
    let totalCash = 0;
    let totalGcash = 0;

    for (const r of filtered) {
      const isVoided = toBool(r.voided);
      if (isVoided) continue;
      totalAmount += round2(toNumber(r.total));
      totalCash += round2(toNumber(r.cash_amount));
      totalGcash += round2(toNumber(r.gcash_amount));
    }

    return {
      totalAmount: round2(totalAmount),
      totalCash: round2(totalCash),
      totalGcash: round2(totalGcash),
    };
  }, [filtered]);

  const makeReceiptGroup = (r: CustomerConsignmentRow): ReceiptGroup => {
    const qty = Number(r.quantity ?? 0) || 0;
    const price = round2(toNumber(r.price));
    const total = round2(toNumber(r.total));

    const itemName = show(r.consignment?.item_name);
    const cat = show(r.consignment?.category);
    const img = r.consignment?.image_url ?? null;

    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const paid = toBool(r.is_paid);
    const isVoided = toBool(r.voided);

    return {
      id: r.id,
      created_at: r.created_at,
      full_name: r.full_name,
      seat_number: r.seat_number,
      items: [
        {
          id: r.id,
          item_name: itemName,
          category: cat,
          size: r.consignment?.size ?? null,
          quantity: qty,
          price,
          total,
          image_url: img,
        },
      ],
      grand_total: total,
      gcash_amount: gcash,
      cash_amount: cash,
      is_paid: paid,
      paid_at: r.paid_at ?? null,
      is_voided: isVoided,
      voided_at: r.voided_at ?? null,
      void_note: r.void_note ?? null,
    };
  };

  /* ---------------- actions ---------------- */

  const openReceipt = (r: CustomerConsignmentRow): void => setSelectedOrder(makeReceiptGroup(r));

  const openPaymentModal = (r: CustomerConsignmentRow): void => {
    const g = makeReceiptGroup(r);
    if (g.is_voided) {
      alert("Cannot set payment for VOIDED record.");
      return;
    }
    setPaymentTarget(g);
    setGcashInput(String(round2(Math.max(0, g.gcash_amount))));
    setCashInput(String(round2(Math.max(0, g.cash_amount))));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const g = round2(Math.max(0, toNumber(gcashInput)));
    const c = round2(Math.max(0, toNumber(cashInput)));

    try {
      setSavingPayment(true);

      const { error } = await supabase.rpc("set_consignment_payment", {
        p_row_id: paymentTarget.id,
        p_gcash: g,
        p_cash: c,
      });

      if (error) {
        alert(`Save payment error: ${error.message}`);
        return;
      }

      setPaymentTarget(null);
      await fetchByRange(activeRange.startKey, activeRange.endKey);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  const togglePaid = async (r: CustomerConsignmentRow): Promise<void> => {
    if (toBool(r.voided)) {
      alert("Cannot change paid status for VOIDED record.");
      return;
    }

    try {
      setTogglingPaidId(r.id);

      const nextPaid = !toBool(r.is_paid);

      const { error } = await supabase.rpc("set_consignment_paid_status", {
        p_row_id: r.id,
        p_is_paid: nextPaid,
      });

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      await fetchByRange(activeRange.startKey, activeRange.endKey);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const openVoid = (r: CustomerConsignmentRow): void => {
    setVoidTarget(r);
    setVoidReason("");
  };

  const submitVoid = async (): Promise<void> => {
    if (!voidTarget) return;

    const reason = voidReason.trim();
    if (!reason) {
      alert("Void reason is required.");
      return;
    }

    if (toBool(voidTarget.voided)) {
      alert("Already voided.");
      return;
    }

    try {
      setVoiding(true);

      const { error } = await supabase.rpc("void_customer_consignment", {
        p_row_id: voidTarget.id,
        p_reason: reason,
      });

      if (error) {
        alert(`Void failed: ${error.message}`);
        return;
      }

      setVoidTarget(null);
      setVoidReason("");
      setSelectedOrder(null);
      setPaymentTarget(null);
      await fetchByRange(activeRange.startKey, activeRange.endKey);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Void failed.");
    } finally {
      setVoiding(false);
    }
  };

  // ✅ CANCEL (per row)
  const openCancel = (r: CustomerConsignmentRow): void => {
    setCancelTarget(r);
    setCancelReason("");
  };

  const submitCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const reason = cancelReason.trim();
    if (!reason) {
      alert("Cancel reason is required.");
      return;
    }

    try {
      setCancelling(true);

      const { error } = await supabase.rpc("cancel_customer_consignment", {
        p_row_id: cancelTarget.id,
        p_reason: reason,
      });

      if (error) {
        alert(`Cancel failed: ${error.message}`);
        return;
      }

      setCancelTarget(null);
      setCancelReason("");
      setSelectedOrder(null);
      setPaymentTarget(null);
      setVoidTarget(null);

      await fetchByRange(activeRange.startKey, activeRange.endKey);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cancel failed.");
    } finally {
      setCancelling(false);
    }
  };

  // ✅ DELETE BY RANGE (permanent)
  const openDeleteByRangeModal = (): void => {
    if (loading || exporting || savingPayment || voiding || cancelling) return;
    if (rows.length === 0) {
      alert("No records to delete in this range.");
      return;
    }
    setDeleteRangeOpen(true);
  };

  const deleteByRange = async (): Promise<void> => {
    try {
      setDeletingByRange(true);

      const { startISO, endISO } = phBoundsFromKeys(activeRange.startKey, activeRange.endKey);

      const { error } = await supabase
        .from("customer_session_consignment")
        .delete()
        .gte("created_at", startISO)
        .lte("created_at", endISO);

      if (error) {
        alert(`Delete failed: ${error.message}`);
        return;
      }

      setRows([]);
      setSelectedOrder(null);
      setPaymentTarget(null);
      setVoidTarget(null);
      setCancelTarget(null);

      setDeleteRangeOpen(false);
      alert(`Deleted ALL consignment records for ${filterMode.toUpperCase()} range: ${activeRange.label}`);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete by range failed.");
    } finally {
      setDeletingByRange(false);
    }
  };

  // ✅ EXPORT TO EXCEL (range-based)
  const exportToExcel = async (): Promise<void> => {
    if (filtered.length === 0) {
      alert("No records for selected range.");
      return;
    }

    try {
      setExporting(true);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Me Tyme Lounge";
      wb.created = new Date();

      const ws = wb.addWorksheet("Consignment", {
        views: [{ state: "frozen", ySplit: 6 }],
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      ws.columns = [
        { header: "Date/Time (PH)", key: "dt", width: 22 },
        { header: "Full Name", key: "full_name", width: 24 },
        { header: "Seat", key: "seat", width: 10 },
        { header: "Item", key: "item", width: 22 },
        { header: "Category", key: "category", width: 16 },
        { header: "Size", key: "size", width: 10 },
        { header: "Qty", key: "qty", width: 8 },
        { header: "Price", key: "price", width: 12 },
        { header: "Total", key: "total", width: 12 },
        { header: "GCash", key: "gcash", width: 12 },
        { header: "Cash", key: "cash", width: 12 },
        { header: "Total Paid", key: "paid_total", width: 12 },
        { header: "Paid?", key: "paid", width: 10 },
        { header: "Voided?", key: "voided", width: 10 },
        { header: "Void Note", key: "void_note", width: 26 },
        { header: "Image", key: "image", width: 14 }, // image cell (optional embed)
      ];

      const lastColLetter = "P";

      ws.mergeCells(`A1:${lastColLetter}1`);
      ws.getCell("A1").value = "ME TYME LOUNGE — Customer Consignment Records";
      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

      ws.mergeCells(`A2:${lastColLetter}2`);
      ws.getCell("A2").value = `${filterMode.toUpperCase()} Range: ${activeRange.label}    •    Records: ${filtered.length}`;
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

      ws.getRow(1).height = 26;
      ws.getRow(2).height = 18;

      // add logo top-right (if url)
      if (isLikelyUrl(logo)) {
        const ab = await fetchAsArrayBuffer(logo);
        if (ab) {
          const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
          const imgId = wb.addImage({ buffer: ab, extension: ext });
          ws.addImage(imgId, { tl: { col: 12.6, row: 0.25 }, ext: { width: 170, height: 64 } });
        }
      }

      const headerRowIndex = 6;
      const headerRow = ws.getRow(headerRowIndex);
      headerRow.values = ws.columns.map((c) => String(c.header ?? ""));
      headerRow.height = 20;

      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FF9CA3AF" } },
          left: { style: "thin", color: { argb: "FF9CA3AF" } },
          bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
          right: { style: "thin", color: { argb: "FF9CA3AF" } },
        };
      });

      const moneyCols = new Set(["price", "total", "gcash", "cash", "paid_total"]);
      const imageColIndex = ws.columns.findIndex((c) => String(c.key) === "image") + 1;

      for (let idx = 0; idx < filtered.length; idx++) {
        const r = filtered[idx];

        const itemName = show(r.consignment?.item_name);
        const cat = show(r.consignment?.category);
        const sz = sizeText(r.consignment?.size);
        const imgUrl = r.consignment?.image_url ?? null;

        const qty = Number(r.quantity ?? 0) || 0;
        const price = round2(toNumber(r.price));
        const total = round2(toNumber(r.total));

        const gcash = round2(toNumber(r.gcash_amount));
        const cash = round2(toNumber(r.cash_amount));
        const paidTotal = round2(gcash + cash);

        const isPaid = toBool(r.is_paid);
        const isVoided = toBool(r.voided);

        const row = ws.addRow({
          dt: formatPHDateTime(r.created_at),
          full_name: show(r.full_name),
          seat: show(r.seat_number),
          item: itemName,
          category: cat,
          size: sz,
          qty,
          price,
          total,
          gcash,
          cash,
          paid_total: paidTotal,
          paid: isPaid ? "PAID" : "UNPAID",
          voided: isVoided ? "VOIDED" : "—",
          void_note: show(r.void_note, ""),
          image: "", // we’ll embed if possible
        });

        const rowIndex = row.number;
        ws.getRow(rowIndex).height = 52;

        row.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: "middle", horizontal: colNumber === 2 || colNumber === 4 || colNumber === 15 ? "left" : "center", wrapText: true };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            left: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
            right: { style: "thin", color: { argb: "FFE5E7EB" } },
          };
          const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        });

        // money formatting
        ws.columns.forEach((c, i) => {
          if (!c.key) return;
          if (moneyCols.has(String(c.key))) {
            const cell = ws.getCell(rowIndex, i + 1);
            cell.numFmt = '"₱"#,##0.00;[Red]"₱"#,##0.00';
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }
        });

        // paid badge
        const paidColIndex = ws.columns.findIndex((c) => String(c.key) === "paid") + 1;
        if (paidColIndex > 0) {
          const paidCell = ws.getCell(rowIndex, paidColIndex);
          if (String(paidCell.value) === "PAID") {
            paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
            paidCell.font = { bold: true, color: { argb: "FF166534" } };
          } else {
            paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
            paidCell.font = { bold: true, color: { argb: "FF991B1B" } };
          }
        }

        // embed item image (best-effort)
        if (imageColIndex > 0 && isLikelyUrl(imgUrl)) {
          const ab = await fetchAsArrayBuffer(imgUrl);
          if (ab) {
            const ext = imgUrl.toLowerCase().includes(".jpg") || imgUrl.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
            const imgId = wb.addImage({ buffer: ab, extension: ext });

            // place inside the "Image" cell area
            ws.addImage(imgId, {
              tl: { col: imageColIndex - 1 + 0.15, row: rowIndex - 1 + 0.15 },
              ext: { width: 64, height: 64 },
            });
          }
        }
      }

      ws.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: ws.columns.length },
      };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `customer-consignment_${filterMode}_${activeRange.fileLabel}.xlsx`);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const rangeHint =
    filterMode === "day"
      ? `Showing records for: ${anchorDate}`
      : filterMode === "week"
      ? `Showing WEEK range: ${activeRange.label}`
      : `Showing MONTH range: ${activeRange.label}`;

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOPBAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Consignment Records</h2>

              <div className="customer-subtext">
                <strong>{rangeHint}</strong>
              </div>

              <div className="customer-subtext">
                Rows: <strong>{filtered.length}</strong> • Total: <strong>{moneyText(totals.totalAmount)}</strong> • Cash:{" "}
                <strong>{moneyText(totals.totalCash)}</strong> • GCash: <strong>{moneyText(totals.totalGcash)}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* SEARCH */}
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>

                  <input
                    className="customer-search-input"
                    type="text"
                    placeholder="Search fullname / seat / item / category..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                  />

                  {searchText.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearchText("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* MODE + ANCHOR + ACTIONS */}
              <div className="admin-tools-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {/* Mode */}
                <label className="date-pill" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontWeight: 900 }}>Mode</span>
                  <select
                    value={filterMode}
                    onChange={(e) => setFilterMode(e.currentTarget.value as FilterMode)}
                    style={{
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 12,
                      padding: "8px 10px",
                      fontWeight: 800,
                      outline: "none",
                      background: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </label>

                {/* Anchor Date */}
                <div className="date-pill" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontWeight: 900 }}>{filterMode === "day" ? "Date" : "Anchor"}</span>
                  <input
                    type="date"
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.currentTarget.value)}
                    style={{
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 12,
                      padding: "8px 10px",
                      fontWeight: 800,
                      outline: "none",
                      background: "rgba(255,255,255,0.85)",
                    }}
                  />
                </div>

                <button className="receipt-btn" onClick={() => void fetchByRange(activeRange.startKey, activeRange.endKey)} disabled={loading}>
                  Refresh
                </button>

                <button
                  className="receipt-btn admin-danger"
                  onClick={() => openDeleteByRangeModal()}
                  disabled={loading || exporting || deletingByRange || rows.length === 0}
                  title={rows.length === 0 ? "No data to delete" : `Delete ALL records for this ${filterMode.toUpperCase()} range`}
                >
                  {deletingByRange ? "Deleting..." : `Delete (${filterMode})`}
                </button>

                <button
                  className="receipt-btn"
                  onClick={() => void exportToExcel()}
                  disabled={exporting || loading || filtered.length === 0}
                  title={filtered.length === 0 ? "No data to export" : `Export .xlsx for this ${filterMode.toUpperCase()} range`}
                >
                  {exporting ? "Exporting..." : "Export to Excel"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="customer-note">No data found for this range</p>
          ) : (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Date/Time (PH)</th>
                    <th>Full Name</th>
                    <th>Seat</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((r) => {
                    const qty = Number(r.quantity ?? 0) || 0;
                    const price = round2(toNumber(r.price));
                    const total = round2(toNumber(r.total));

                    const cash = round2(toNumber(r.cash_amount));
                    const gcash = round2(toNumber(r.gcash_amount));

                    const itemName = show(r.consignment?.item_name);
                    const cat = show(r.consignment?.category);
                    const img = r.consignment?.image_url ?? null;

                    const isVoided = toBool(r.voided);
                    const isPaid = toBool(r.is_paid);
                    const busyPaid = togglingPaidId === r.id;

                    return (
                      <tr key={r.id} style={isVoided ? { opacity: 0.65 } : undefined}>
                        <td style={{ width: 86 }}>
                          {img ? (
                            <img
                              src={img}
                              alt={itemName}
                              style={{
                                width: 64,
                                height: 64,
                                objectFit: "cover",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.12)",
                              }}
                              loading="lazy"
                            />
                          ) : (
                            <div
                              style={{
                                width: 64,
                                height: 64,
                                borderRadius: 12,
                                border: "1px dashed rgba(0,0,0,0.25)",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 12,
                                opacity: 0.75,
                              }}
                            >
                              No Image
                            </div>
                          )}
                        </td>

                        <td style={{ fontWeight: 900 }}>{itemName}</td>
                        <td style={{ fontWeight: 800 }}>{cat}</td>
                        <td>{formatPHDateTime(r.created_at)}</td>
                        <td style={{ fontWeight: 900 }}>{show(r.full_name)}</td>
                        <td style={{ fontWeight: 900 }}>{show(r.seat_number)}</td>
                        <td>{sizeText(r.consignment?.size)}</td>

                        <td style={{ fontWeight: 900 }}>{qty}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(price)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(total)}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash {moneyText(gcash)} / Cash {moneyText(cash)}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(r)}
                              disabled={isVoided || total <= 0}
                              title={isVoided ? "Voided" : "Set Cash & GCash freely (no limit)"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${isPaid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(r)}
                            disabled={busyPaid || isVoided}
                            title={isVoided ? "Voided" : isPaid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {busyPaid ? "Updating..." : isPaid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => openReceipt(r)}>
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn"
                              onClick={() => openVoid(r)}
                              disabled={isVoided}
                              title={isVoided ? "Already voided" : "Void (returns stock)"}
                            >
                              Void
                            </button>

                            <button
                              className="receipt-btn"
                              onClick={() => openCancel(r)}
                              title="Cancel (archive + delete from database)"
                              disabled={cancelling}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ✅ DELETE BY RANGE CONFIRM MODAL */}
          {deleteRangeOpen && (
            <div className="receipt-overlay" onClick={() => (deletingByRange ? null : setDeleteRangeOpen(false))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DELETE ({filterMode.toUpperCase()})</h3>
                <p className="receipt-subtitle">
                  This will permanently delete <strong>ALL</strong> consignment records in this range:
                  <br />
                  <strong>{activeRange.label}</strong>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Records Found</span>
                  <span>{rows.length}</span>
                </div>

                <div className="receipt-row" style={{ opacity: 0.85, fontSize: 12 }}>
                  <span>Warning</span>
                  <span>Permanent delete (cannot undo).</span>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDeleteRangeOpen(false)} disabled={deletingByRange}>
                    Cancel
                  </button>

                  <button className="receipt-btn admin-danger" onClick={() => void deleteByRange()} disabled={deletingByRange}>
                    {deletingByRange ? "Deleting..." : "Delete Now"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ CANCEL MODAL (required reason) */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancelling ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL RECORD</h3>
                <p className="receipt-subtitle">
                  {show(cancelTarget.consignment?.item_name)} • Qty: <b>{cancelTarget.quantity}</b> • Seat: <b>{show(cancelTarget.seat_number)}</b>
                </p>

                <hr />

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    Reason <span style={{ color: "crimson" }}>*</span>
                  </div>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.currentTarget.value)}
                    placeholder="Example: cancelled order / mistaken entry / customer changed mind..."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      resize: "vertical",
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.15)",
                      outline: "none",
                      fontSize: 14,
                    }}
                    disabled={cancelling}
                  />
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
                  • This will be saved to <b>consignment_cancelled</b> then removed from <b>customer_session_consignment</b>.
                  <br />
                  • If this record is <b>NOT VOIDED</b>, stock will be returned by reducing <b>consignment.sold</b>.
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void submitCancel()} disabled={cancelling}>
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ PAYMENT MODAL (NO LIMIT) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => (savingPayment ? null : setPaymentTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} • Seat {paymentTarget.seat_number}
                </p>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, paymentTarget.grand_total));

                  const g = round2(Math.max(0, toNumber(gcashInput)));
                  const c = round2(Math.max(0, toNumber(cashInput)));
                  const totalPaid = round2(g + c);

                  const diff = round2(totalPaid - due);
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due</span>
                        <span>{moneyText(due)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashInput(e.currentTarget.value)}
                          disabled={savingPayment}
                        />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.currentTarget.value)}
                          disabled={savingPayment}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>{moneyText(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Status</span>
                        <span className="receipt-status">{isPaidAuto ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)} disabled={savingPayment}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment}>
                          {savingPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ✅ RECEIPT MODAL */}
          {selectedOrder && (
            <div className="receipt-overlay" onClick={() => setSelectedOrder(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{formatPHDateTime(selectedOrder.created_at)}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedOrder.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{selectedOrder.seat_number}</span>
                </div>

                <hr />

                <div className="items-receipt">
                  {selectedOrder.items.map((it) => (
                    <div className="receipt-item-row" key={it.id}>
                      <div className="receipt-item-left">
                        <div className="receipt-item-title">
                          {it.item_name}{" "}
                          <span className="item-cat">
                            ({it.category}
                            {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                          </span>
                        </div>
                        <div className="receipt-item-sub">
                          {it.quantity} × {moneyText(it.price)}
                        </div>
                      </div>
                      <div className="receipt-item-total">{moneyText(it.total)}</div>
                    </div>
                  ))}
                </div>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, selectedOrder.grand_total));
                  const gcash = round2(Math.max(0, selectedOrder.gcash_amount));
                  const cash = round2(Math.max(0, selectedOrder.cash_amount));
                  const totalPaid = round2(gcash + cash);
                  const diff = round2(totalPaid - due);

                  const paid = toBool(selectedOrder.is_paid);
                  const isVoided = selectedOrder.is_voided;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total</span>
                        <span>{moneyText(due)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>{moneyText(gcash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>{moneyText(cash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>{moneyText(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{isVoided ? "VOIDED" : paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      {paid && !isVoided && (
                        <div className="receipt-row">
                          <span>Paid at</span>
                          <span>{selectedOrder.paid_at ? formatPHDateTime(selectedOrder.paid_at) : "-"}</span>
                        </div>
                      )}

                      {isVoided && (
                        <>
                          <div className="receipt-row">
                            <span>Voided at</span>
                            <span>{selectedOrder.voided_at ? formatPHDateTime(selectedOrder.voided_at) : "-"}</span>
                          </div>
                          <div className="receipt-row">
                            <span>Void note</span>
                            <span style={{ textAlign: "right", maxWidth: 220 }}>{show(selectedOrder.void_note, "-")}</span>
                          </div>
                        </>
                      )}

                      <div className="receipt-total">
                        <span>TOTAL</span>
                        <span>{moneyText(due)}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                <button className="close-btn" onClick={() => setSelectedOrder(null)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ✅ VOID MODAL */}
          {voidTarget && (
            <div className="receipt-overlay" onClick={() => (voiding ? null : setVoidTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">VOID CONSIGNMENT</h3>
                <p className="receipt-subtitle">
                  {show(voidTarget.consignment?.item_name)} • Qty: <b>{voidTarget.quantity}</b> • Seat: <b>{show(voidTarget.seat_number)}</b>
                </p>

                <hr />

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    Reason <span style={{ color: "crimson" }}>*</span>
                  </div>
                  <textarea
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.currentTarget.value)}
                    placeholder="Example: wrong item / mistaken quantity / cancelled..."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      resize: "vertical",
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.15)",
                      outline: "none",
                      fontSize: 14,
                    }}
                    disabled={voiding}
                  />
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Note: Voiding will <b>return stock</b> by reducing <b>consignment.sold</b>.
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setVoidTarget(null)} disabled={voiding}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void submitVoid()} disabled={voiding}>
                    {voiding ? "Voiding..." : "Confirm Void"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!loading && filtered.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Consignment_Record;
