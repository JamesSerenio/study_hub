// src/pages/Admin_Customer_Add_ons.tsx
// ✅ UI MATCHES Customer_Lists (TOPBAR + DATE PILL CALENDAR + TABLE WRAP + NOTES)
// ✅ Same className + UI style as Customer_Lists
// ✅ Payment modal: GCash/Cash auto updates to match Due
// ✅ Save Payment auto sets PAID/UNPAID (paid >= due) + paid_at
// ✅ Manual PAID/UNPAID toggle works (can return to UNPAID even if fully paid)
// ✅ Receipt status follows manual is_paid
// ✅ Excel export (REAL XLSX + images)
// ✅ NEW: show SIZE in items table + receipt
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

// ✅ Excel export (REAL XLSX + images)
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type NumericLike = number | string;

interface AddOnInfo {
  id: string;
  sold: NumericLike;
}

interface CustomerSessionAddOnRow {
  id: string;
  created_at: string;
  add_on_id: string;
  quantity: number;
  price: NumericLike;
  total: NumericLike;
  full_name: string;
  seat_number: string;

  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
}

interface AddOnLookup {
  id: string;
  name: string;
  category: string;
  size: string | null; // ✅ NEW
  image_url: string | null; // ✅ for excel image
}

interface CustomerAddOnMerged {
  id: string;
  created_at: string;
  add_on_id: string;
  quantity: number;
  price: number;
  total: number;
  full_name: string;
  seat_number: string;
  item_name: string;
  category: string;
  size: string | null; // ✅ NEW
  image_url: string | null;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
}

type OrderItem = {
  id: string; // customer_session_add_ons.id
  add_on_id: string;
  category: string;
  size: string | null; // ✅ NEW
  item_name: string;
  quantity: number;
  price: number;
  total: number;
};

type OrderGroup = {
  key: string;
  created_at: string;
  full_name: string;
  seat_number: string;

  items: OrderItem[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;

  is_paid: boolean;
  paid_at: string | null;
};

/* ---------------- helpers ---------------- */

const toNumber = (v: NumericLike | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const extractLocalDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length > 0 ? v : "—";
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH");
};

const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
};

const localDayRangeIso = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

const GROUP_WINDOW_MS = 10_000;

const samePersonSeat = (a: CustomerAddOnMerged, b: CustomerAddOnMerged): boolean =>
  norm(a.full_name) === norm(b.full_name) && norm(a.seat_number) === norm(b.seat_number);

/* =========================
   ✅ Excel helpers
========================= */

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const cellText = (v: ExcelJS.Cell["value"]): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toLocaleString();
  return String(v);
};

const autoFitColumns = (
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  cols: number[],
  minMap: Record<number, number>,
  maxMap: Record<number, number>
): void => {
  for (const c of cols) {
    let maxLen = 0;
    for (let r = startRow; r <= endRow; r++) {
      const t = cellText(ws.getRow(r).getCell(c).value).trim();
      if (!t) continue;
      maxLen = Math.max(maxLen, t.length);
    }
    const minW = minMap[c] ?? 8;
    const maxW = maxMap[c] ?? 40;
    ws.getColumn(c).width = clamp(Math.ceil(maxLen + 2), minW, maxW);
  }
};

const applyHeaderStyle = (row: ExcelJS.Row, startCol: number, endCol: number): void => {
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

const applyBorders = (row: ExcelJS.Row, startCol: number, endCol: number): void => {
  for (let c = startCol; c <= endCol; c++) {
    row.getCell(c).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }
};

// ✅ fetch image -> base64 (ExcelJS addImage)
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const guessImageExtension = (url: string, contentType: string | null): "png" | "jpeg" => {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpg") || ct.includes("jpeg")) return "jpeg";
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "png";
  return "jpeg";
};

const fetchImageBase64 = async (url: string): Promise<{ base64: string; extension: "png" | "jpeg" } | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    const buf = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const extension = guessImageExtension(url, ct);
    return { base64, extension };
  } catch {
    return null;
  }
};

/* ---------------- component ---------------- */

const Admin_Customer_Add_ons: React.FC = () => {
  const [records, setRecords] = useState<CustomerAddOnMerged[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const [selectedOrder, setSelectedOrder] = useState<OrderGroup | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<OrderGroup | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [togglingPaidKey, setTogglingPaidKey] = useState<string | null>(null);

  useEffect(() => {
    void fetchAddOns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAddOns = async (): Promise<void> => {
    setLoading(true);

    const { data: rows, error } = await supabase
      .from("customer_session_add_ons")
      .select(
        `
        id,
        created_at,
        add_on_id,
        quantity,
        price,
        total,
        full_name,
        seat_number,
        gcash_amount,
        cash_amount,
        is_paid,
        paid_at
      `
      )
      .order("created_at", { ascending: false })
      .returns<CustomerSessionAddOnRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("Error fetching customer_session_add_ons:", error);
      setRecords([]);
      setLoading(false);
      return;
    }

    const sessionRows = rows ?? [];
    if (sessionRows.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const addOnIds = Array.from(new Set(sessionRows.map((r) => r.add_on_id)));

    // ✅ include size + image_url
    const { data: addOnRows, error: addOnErr } = await supabase
      .from("add_ons")
      .select("id, name, category, size, image_url")
      .in("id", addOnIds)
      .returns<AddOnLookup[]>();

    if (addOnErr) {
      // eslint-disable-next-line no-console
      console.error("Error fetching add_ons:", addOnErr);
    }

    const addOnMap = new Map<string, AddOnLookup>();
    (addOnRows ?? []).forEach((a) => addOnMap.set(a.id, a));

    const merged: CustomerAddOnMerged[] = sessionRows.map((r) => {
      const addOn = addOnMap.get(r.add_on_id);

      return {
        id: r.id,
        created_at: r.created_at,
        add_on_id: r.add_on_id,
        quantity: Number.isFinite(r.quantity) ? r.quantity : 0,
        price: toNumber(r.price),
        total: toNumber(r.total),
        full_name: r.full_name,
        seat_number: r.seat_number,
        item_name: addOn?.name ?? "-",
        category: addOn?.category ?? "-",
        size: addOn?.size ?? null, // ✅ NEW
        image_url: addOn?.image_url ?? null,

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,
      };
    });

    setRecords(merged);
    setLoading(false);
  };

  const filteredRecords = useMemo(() => {
    return records
      .filter((r) => extractLocalDate(r.created_at) === selectedDate)
      .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  }, [records, selectedDate]);

  const groupedOrders = useMemo<OrderGroup[]>(() => {
    if (filteredRecords.length === 0) return [];

    const groups: OrderGroup[] = [];
    let current: OrderGroup | null = null;
    let lastRow: CustomerAddOnMerged | null = null;

    for (const row of filteredRecords) {
      const startNew =
        current === null ||
        lastRow === null ||
        !samePersonSeat(row, lastRow) ||
        Math.abs(ms(row.created_at) - ms(lastRow.created_at)) > GROUP_WINDOW_MS;

      if (startNew) {
        const key = `${norm(row.full_name)}|${norm(row.seat_number)}|${ms(row.created_at)}`;
        current = {
          key,
          created_at: row.created_at,
          full_name: row.full_name,
          seat_number: row.seat_number,
          items: [],
          grand_total: 0,
          gcash_amount: 0,
          cash_amount: 0,
          is_paid: false,
          paid_at: null,
        };
        groups.push(current);
      }

      if (!current) continue;

      current.items.push({
        id: row.id,
        add_on_id: row.add_on_id,
        category: row.category,
        size: row.size, // ✅ NEW
        item_name: row.item_name,
        quantity: Number(row.quantity) || 0,
        price: row.price,
        total: row.total,
      });

      current.grand_total = round2(current.grand_total + row.total);

      current.gcash_amount = round2(current.gcash_amount + row.gcash_amount);
      current.cash_amount = round2(current.cash_amount + row.cash_amount);

      current.is_paid = current.is_paid || row.is_paid;
      current.paid_at = current.paid_at ?? row.paid_at;

      lastRow = row;
    }

    return groups.sort((a, b) => ms(b.created_at) - ms(a.created_at));
  }, [filteredRecords]);

  /* =========================================================
     ✅ Export to EXCEL (.xlsx) with IMAGES + SIZE
  ========================================================= */
  const exportToExcelByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredRecords.length === 0) {
      alert("No records for selected date.");
      return;
    }

    try {
      const now = new Date();
      const wb = new ExcelJS.Workbook();
      wb.creator = "Admin";
      wb.created = now;

      const ws = wb.addWorksheet("AddOns", { views: [{ state: "frozen", ySplit: 7 }] });

      // A Image | B Date | C Time | D Full Name | E Seat | F Category | G Size | H Item | I Qty | J Price | K Total
      ws.columns = [
        { header: "Image", key: "img", width: 12 }, // A
        { header: "Date", key: "date", width: 12 }, // B
        { header: "Time", key: "time", width: 10 }, // C
        { header: "Full Name", key: "name", width: 22 }, // D
        { header: "Seat", key: "seat", width: 10 }, // E
        { header: "Category", key: "cat", width: 14 }, // F
        { header: "Size", key: "size", width: 10 }, // G ✅
        { header: "Item", key: "item", width: 22 }, // H
        { header: "Qty", key: "qty", width: 6 }, // I
        { header: "Price", key: "price", width: 12 }, // J
        { header: "Total", key: "total", width: 12 }, // K
      ];

      // Title block
      ws.mergeCells(1, 1, 1, 11);
      ws.mergeCells(2, 1, 2, 11);
      ws.mergeCells(3, 1, 3, 11);
      ws.mergeCells(4, 1, 4, 11);

      ws.getCell("A1").value = "ADMIN ADD-ONS REPORT";
      ws.getCell("A2").value = `Date: ${selectedDate}`;
      ws.getCell("A3").value = `Generated: ${now.toLocaleString()}`;
      ws.getCell("A4").value = `Rows: ${filteredRecords.length}`;

      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A3").font = { size: 11 };
      ws.getCell("A4").font = { size: 11, bold: true };

      ws.getRow(1).height = 22;
      ws.getRow(5).height = 8;

      // blank row 5
      ws.addRow([]);

      // Header row 6
      const headerRowIndex = 6;
      const h = ws.getRow(headerRowIndex);
      h.values = ["Image", "Date", "Time", "Full Name", "Seat", "Category", "Size", "Item", "Qty", "Price", "Total"];
      applyHeaderStyle(h, 1, 11);
      h.commit();

      // Data starts row 7
      let rIdx = 7;

      // cache images (avoid re-fetch for same url)
      const imageCache = new Map<string, { imageId: number; ext: "png" | "jpeg" }>();

      for (const r of filteredRecords) {
        const row = ws.getRow(rIdx);

        const d = extractLocalDate(r.created_at);
        const t = formatTimeText(r.created_at);

        row.getCell(2).value = d || "-";
        row.getCell(3).value = t || "-";
        row.getCell(4).value = r.full_name || "-";
        row.getCell(5).value = r.seat_number || "-";
        row.getCell(6).value = r.category || "-";
        row.getCell(7).value = sizeText(r.size); // ✅ SIZE
        row.getCell(8).value = r.item_name || "-";
        row.getCell(9).value = Number(r.quantity ?? 0);

        row.getCell(10).value = Number(r.price ?? 0);
        row.getCell(10).numFmt = '"₱"#,##0.00';

        row.getCell(11).value = Number(r.total ?? 0);
        row.getCell(11).numFmt = '"₱"#,##0.00';

        row.height = 46;

        // alignments
        for (let c = 1; c <= 11; c++) {
          const cell = row.getCell(c);
          cell.alignment =
            c === 8 || c === 4
              ? { vertical: "middle", horizontal: "left", wrapText: true }
              : { vertical: "middle", horizontal: c === 9 ? "center" : "left", wrapText: true };
        }

        // borders
        applyBorders(row, 1, 11);

        // ✅ IMAGE in column A
        const url = (r.image_url ?? "").trim();
        if (url) {
          const cached = imageCache.get(url);
          if (cached) {
            ws.addImage(cached.imageId, {
              tl: { col: 0.15, row: rIdx - 0.85 },
              ext: { width: 52, height: 52 },
            });
          } else {
            const img = await fetchImageBase64(url);
            if (img) {
              const imageId = wb.addImage({
                base64: `data:image/${img.extension};base64,${img.base64}`,
                extension: img.extension,
              });
              imageCache.set(url, { imageId, ext: img.extension });

              ws.addImage(imageId, {
                tl: { col: 0.15, row: rIdx - 0.85 },
                ext: { width: 52, height: 52 },
              });
            }
          }
        }

        row.commit();
        rIdx++;
      }

      // TOTAL row
      const totalRowIndex = rIdx + 1;
      const totalRow = ws.getRow(totalRowIndex);
      totalRow.getCell(10).value = "TOTAL:";
      totalRow.getCell(10).font = { bold: true };
      totalRow.getCell(10).alignment = { vertical: "middle", horizontal: "right" };

      totalRow.getCell(11).value = { formula: `SUM(K7:K${rIdx - 1})` };
      totalRow.getCell(11).numFmt = '"₱"#,##0.00';
      totalRow.getCell(11).font = { bold: true };
      totalRow.height = 20;

      applyBorders(totalRow, 1, 11);
      totalRow.commit();

      // auto-fit columns (except image col A)
      autoFitColumns(
        ws,
        6,
        totalRowIndex,
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        { 2: 10, 3: 8, 4: 16, 5: 8, 6: 10, 7: 8, 8: 14, 9: 6, 10: 10, 11: 10 },
        { 2: 14, 3: 12, 4: 28, 5: 12, 6: 18, 7: 12, 8: 30, 9: 8, 10: 14, 11: 14 }
      );

      ws.getColumn(1).width = 12;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `admin_addons_${selectedDate}.xlsx`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Export failed. (If images are blocked, check CORS or use public URLs.)");
    }
  };

  /* ===================== existing logic below (unchanged) ===================== */

  const voidOrder = async (o: OrderGroup): Promise<void> => {
    const ok = window.confirm(
      `VOID this whole order?\n\n${o.full_name}\nSeat: ${o.seat_number}\nItems: ${o.items.length}\nGrand Total: ${moneyText(
        o.grand_total
      )}\nDate: ${formatDateTime(o.created_at)}\n\nThis will RETURN stock and REVERSE sales for ALL items, then delete ALL rows.`
    );
    if (!ok) return;

    try {
      setVoidingId(o.key);

      for (const it of o.items) {
        const mergedRow = records.find((r) => r.id === it.id);
        if (!mergedRow) continue;

        const qty = Number.isFinite(mergedRow.quantity) ? mergedRow.quantity : 0;

        const { data: addOn, error: addOnErr } = await supabase
          .from("add_ons")
          .select("id, sold")
          .eq("id", mergedRow.add_on_id)
          .single<AddOnInfo>();

        if (addOnErr || !addOn) {
          alert(`VOID error: cannot read add_ons. ${addOnErr?.message ?? ""}`.trim());
          return;
        }

        const currentSold = toNumber(addOn.sold);
        const nextSold = Math.max(0, currentSold - qty);

        const { error: updErr } = await supabase.from("add_ons").update({ sold: nextSold }).eq("id", mergedRow.add_on_id);
        if (updErr) {
          alert(`VOID error: failed to reverse sold. ${updErr.message}`);
          return;
        }

        const { error: delErr } = await supabase.from("customer_session_add_ons").delete().eq("id", mergedRow.id);
        if (delErr) {
          alert(`VOID error: reversed sold but failed to delete record. ${delErr.message}`);
          return;
        }
      }

      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("VOID order failed.");
    } finally {
      setVoidingId(null);
    }
  };

  const deleteOrder = async (o: OrderGroup): Promise<void> => {
    const ok = window.confirm(
      `DELETE this whole order?\n\n${o.full_name}\nSeat: ${o.seat_number}\nItems: ${o.items.length}\nGrand Total: ${moneyText(
        o.grand_total
      )}\nDate: ${formatDateTime(o.created_at)}\n\nThis will NOT return stock and NOT reverse sales.`
    );
    if (!ok) return;

    try {
      setDeletingId(o.key);

      const ids = o.items.map((x) => x.id);
      const { error } = await supabase.from("customer_session_add_ons").delete().in("id", ids);

      if (error) {
        alert(`DELETE order error: ${error.message}`);
        return;
      }

      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("DELETE order failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const ok = window.confirm(`DELETE ALL add-ons on date: ${selectedDate}?\n\nThis will NOT return stock and NOT reverse sales.`);
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { startIso, endIso } = localDayRangeIso(selectedDate);

      const { error: delErr } = await supabase
        .from("customer_session_add_ons")
        .delete()
        .gte("created_at", startIso)
        .lte("created_at", endIso);

      if (delErr) {
        alert(`DELETE by date error: ${delErr.message}`);
        return;
      }

      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("DELETE by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  const openPaymentModal = (o: OrderGroup): void => {
    const due = round2(Math.max(0, o.grand_total));

    const existingTotalPaid = round2(o.gcash_amount + o.cash_amount);
    const existingGcash = existingTotalPaid > 0 ? o.gcash_amount : 0;

    const adj = recalcPaymentsToDue(due, existingGcash);

    setPaymentTarget(o);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setGcashAndAutoCash = (o: OrderGroup, gcashStr: string): void => {
    const due = round2(Math.max(0, o.grand_total));
    const gc = round2(Math.max(0, Number(gcashStr) || 0));
    const adj = recalcPaymentsToDue(due, gc);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setCashAndAutoGcash = (o: OrderGroup, cashStr: string): void => {
    const due = round2(Math.max(0, o.grand_total));
    const ca = round2(Math.max(0, Number(cashStr) || 0));

    const cash = round2(Math.min(due, ca));
    const gcash = round2(Math.max(0, due - cash));

    setCashInput(String(cash));
    setGcashInput(String(gcash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = round2(Math.max(0, paymentTarget.grand_total));
    const gcIn = round2(Math.max(0, Number(gcashInput) || 0));
    const adj = recalcPaymentsToDue(due, gcIn);

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due > 0 && totalPaid >= due;

    const itemIds = paymentTarget.items.map((x) => x.id);

    try {
      setSavingPayment(true);

      const { error } = await supabase
        .from("customer_session_add_ons")
        .update({
          gcash_amount: adj.gcash,
          cash_amount: adj.cash,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .in("id", itemIds);

      if (error) {
        alert(`Save payment error: ${error.message}`);
        return;
      }

      setPaymentTarget(null);
      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  const togglePaid = async (o: OrderGroup): Promise<void> => {
    const itemIds = o.items.map((x) => x.id);

    try {
      setTogglingPaidKey(o.key);

      const nextPaid = !toBool(o.is_paid);

      const { error } = await supabase
        .from("customer_session_add_ons")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .in("id", itemIds);

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidKey(null);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Add-Ons Records</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong> ({groupedOrders.length})
              </div>
            </div>

            <div className="customer-topbar-right">
              <label className="date-pill">
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

              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={() => void fetchAddOns()}>
                  Refresh
                </button>

                <button className="receipt-btn" onClick={() => void exportToExcelByDate()} disabled={filteredRecords.length === 0}>
                  Export to Excel
                </button>

                <button
                  className="receipt-btn admin-danger"
                  onClick={() => void deleteByDate()}
                  disabled={filteredRecords.length === 0 || deletingDate === selectedDate}
                >
                  {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : groupedOrders.length === 0 ? (
            <p className="customer-note">No add-ons found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Full Name</th>
                    <th>Seat</th>
                    <th>Items</th>
                    <th>Grand Total</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {groupedOrders.map((o) => {
                    const due = round2(o.grand_total);
                    const totalPaid = round2(o.gcash_amount + o.cash_amount);
                    const remaining = round2(Math.max(0, due - totalPaid));
                    const paid = toBool(o.is_paid);
                    const busyOrder = voidingId === o.key || deletingId === o.key;

                    return (
                      <tr key={o.key}>
                        <td>{formatDateTime(o.created_at)}</td>
                        <td>{o.full_name || "-"}</td>
                        <td>{o.seat_number || "-"}</td>

                        <td>
                          <div className="items-list">
                            {o.items.map((it) => (
                              <div className="item-row" key={it.id}>
                                <div className="item-left">
                                  <div className="item-title">
                                    {it.item_name}{" "}
                                    <span className="item-cat">
                                      ({it.category}
                                      {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                                    </span>
                                  </div>
                                  <div className="item-sub">
                                    Qty: {it.quantity} • {moneyText(it.price)}
                                  </div>
                                </div>
                                <div className="item-total">{moneyText(it.total)}</div>
                              </div>
                            ))}
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{moneyText(due)}</span>
                            {remaining > 0 && <span className="cell-muted">Remaining: {moneyText(remaining)}</span>}
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash {moneyText(o.gcash_amount)} / Cash {moneyText(o.cash_amount)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(o)}
                              disabled={due <= 0}
                              title={due <= 0 ? "No amount due" : "Set GCash/Cash payment"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(o)}
                            disabled={togglingPaidKey === o.key}
                            title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidKey === o.key ? "Updating..." : paid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => setSelectedOrder(o)}>
                              View Receipt
                            </button>

                            <button className="receipt-btn" disabled={busyOrder} onClick={() => void voidOrder(o)}>
                              {voidingId === o.key ? "Voiding..." : "Void"}
                            </button>

                            <button className="receipt-btn admin-neutral" disabled={busyOrder} onClick={() => void deleteOrder(o)}>
                              {deletingId === o.key ? "Deleting..." : "Delete"}
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

          {/* PAYMENT MODAL */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, paymentTarget.grand_total));
                  const gcIn = round2(Math.max(0, Number(gcashInput) || 0));
                  const adj = recalcPaymentsToDue(due, gcIn);

                  const totalPaid = round2(adj.gcash + adj.cash);
                  const remaining = round2(Math.max(0, due - totalPaid));

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total Balance (Due)</span>
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
                          onChange={(e) => setGcashAndAutoCash(paymentTarget, e.currentTarget.value)}
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
                          onChange={(e) => setCashAndAutoGcash(paymentTarget, e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span>{moneyText(remaining)}</span>
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

          {/* RECEIPT MODAL */}
          {selectedOrder && (
            <div className="receipt-overlay" onClick={() => setSelectedOrder(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{formatDateTime(selectedOrder.created_at)}</span>
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
                  const remaining = round2(Math.max(0, due - totalPaid));
                  const paid = toBool(selectedOrder.is_paid);

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
                        <span>Remaining Balance</span>
                        <span>{moneyText(remaining)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      {paid && (
                        <div className="receipt-row">
                          <span>Paid at</span>
                          <span>{selectedOrder.paid_at ? formatDateTime(selectedOrder.paid_at) : "-"}</span>
                        </div>
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

          {!loading && groupedOrders.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Customer_Add_ons;
