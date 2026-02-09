// src/admin/Admin_Customer_Cancelled.tsx
// ✅ SAME UI/LOGIC as src/pages/Customer_Cancelled.tsx (TABS: Add-Ons / Walk-in / Reservation)
// ✅ Add-Ons tab: existing grouped logic (Asia/Manila day range +08:00) from cancelled_at
// ✅ Walk-in tab: reads public.customer_sessions_cancelled where reservation='no'
// ✅ Reservation tab: reads public.customer_sessions_cancelled where reservation='yes'
// ✅ Same layout/classnames style (customer-*)
// ✅ Receipt modal (view details)
// ✅ READ-ONLY (NOT EDITABLE; paid badge NOT clickable; no updates)
// ✅ ADMIN EXTRA:
//    - Delete by DATE (top): deletes ALL cancelled records for selectedDate (Add-Ons + Sessions)
//    - Delete per row/group (Action)
//    - Export to Excel (ONE FILE) with 3 sections: Add-Ons (TOP) + Walk-in + Reservation
// ✅ STRICT TS (no any)

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText, IonAlert, IonSpinner } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

// ✅ EXCEL
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

/* =========================
   TYPES (Add-Ons)
========================= */
type NumericLike = number | string;

interface AddOnInfo {
  id: string;
  name: string;
  category: string;
  size: string | null;
}

interface CancelRowDB_AddOns {
  id: string;
  cancelled_at: string;
  original_id: string;

  created_at: string | null;
  add_on_id: string;
  quantity: number;
  price: NumericLike;

  full_name: string;
  seat_number: string;

  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  description: string;

  add_ons: AddOnInfo | null;
}

type CancelItemAddOn = {
  id: string; // cancelled row id
  original_id: string;
  add_on_id: string;

  item_name: string;
  category: string;
  size: string | null;

  quantity: number;
  price: number;
  total: number;

  cancelled_at: string;
  created_at: string | null;

  full_name: string;
  seat_number: string;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  description: string;
};

type CancelGroupItemAddOn = {
  id: string;
  original_id: string;
  add_on_id: string;
  item_name: string;
  category: string;
  size: string | null;
  quantity: number;
  price: number;
  total: number;
};

type CancelGroupAddOn = {
  key: string;
  cancelled_at: string;

  full_name: string;
  seat_number: string;

  description: string;

  items: CancelGroupItemAddOn[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
};

/* =========================
   TYPES (Sessions Cancelled)
========================= */
type DiscountKind = "none" | "percent" | "amount";

type CancelledSessionDB = {
  id: string;
  cancelled_at: string;
  cancel_reason: string;

  created_at: string | null;
  staff_id: string | null;

  date: string; // date
  full_name: string;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  hour_avail: string;
  time_started: string;
  time_ended: string;
  total_time: number | string;
  total_amount: number | string;

  reservation: string; // 'no' or 'yes'
  reservation_date: string | null;

  id_number: string | null;
  seat_number: string;

  promo_booking_id: string | null;

  discount_kind: DiscountKind | string;
  discount_value: number | string;
  discount_reason: string | null;

  gcash_amount: number | string;
  cash_amount: number | string;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  phone_number: string | null;
  down_payment: number | string | null;
};

type CancelledSession = {
  id: string;
  cancelled_at: string;
  cancel_reason: string;

  date: string;
  reservation: "no" | "yes";
  reservation_date: string | null;

  full_name: string;
  phone_number: string | null;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  seat_number: string;

  hour_avail: string;
  time_started: string;
  time_ended: string;
  total_time: number;
  total_amount: number;

  discount_kind: DiscountKind;
  discount_value: number;
  discount_reason: string | null;

  down_payment: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
};

/* =========================
   HELPERS
========================= */
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

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// ✅ Manila day range from YYYY-MM-DD
const manilaDayRange = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const start = new Date(`${yyyyMmDd}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length > 0 ? v : "—";
};

const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH");
};

const formatTimeText = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "-";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, minV: number, maxV: number): number => Math.min(maxV, Math.max(minV, n));

const applyDiscount = (
  baseCost: number,
  kind: DiscountKind,
  value: number
): { discountedCost: number; discountAmount: number } => {
  const cost = round2(Math.max(0, baseCost));
  const v = round2(Math.max(0, value));

  if (kind === "percent") {
    const pct = clamp(v, 0, 100);
    const disc = round2((cost * pct) / 100);
    return { discountedCost: round2(Math.max(0, cost - disc)), discountAmount: disc };
  }
  if (kind === "amount") {
    const disc = round2(Math.min(cost, v));
    return { discountedCost: round2(Math.max(0, cost - disc)), discountAmount: disc };
  }
  return { discountedCost: cost, discountAmount: 0 };
};

const getDiscountText = (kind: DiscountKind, value: number): string => {
  const v = round2(Math.max(0, value));
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

// ✅ read-only badge (NOT a button)
const ReadOnlyBadge: React.FC<{ paid: boolean }> = ({ paid }) => {
  return (
    <span
      className={`pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 10px",
        borderRadius: 999,
        fontWeight: 900,
        fontSize: 12,
        userSelect: "none",
        pointerEvents: "none",
      }}
      aria-label={paid ? "PAID" : "UNPAID"}
    >
      {paid ? "PAID" : "UNPAID"}
    </span>
  );
};

const GROUP_WINDOW_MS = 10_000;

/* =========================
   COMPONENT
========================= */
type CancelTab = "addons" | "walkin" | "reservation";

const Admin_Customer_Cancelled: React.FC = () => {
  const [tab, setTab] = useState<CancelTab>("addons");

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [loading, setLoading] = useState<boolean>(true);

  // Add-ons data
  const [rowsAddOns, setRowsAddOns] = useState<CancelItemAddOn[]>([]);
  const [selectedGroupAddOns, setSelectedGroupAddOns] = useState<CancelGroupAddOn | null>(null);

  // Sessions data (walk-in + reservation)
  const [rowsSessions, setRowsSessions] = useState<CancelledSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<CancelledSession | null>(null);

  // ✅ Admin actions state
  const [confirmDeleteDate, setConfirmDeleteDate] = useState<boolean>(false);
  const [confirmDeleteAddOnGroup, setConfirmDeleteAddOnGroup] = useState<CancelGroupAddOn | null>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<CancelledSession | null>(null);
  const [busyDelete, setBusyDelete] = useState<boolean>(false);
  const [busyExport, setBusyExport] = useState<boolean>(false);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tab]);

  const refresh = async (): Promise<void> => {
    setSelectedGroupAddOns(null);
    setSelectedSession(null);

    if (tab === "addons") {
      await fetchCancelledAddOns(selectedDate);
    } else if (tab === "walkin") {
      await fetchCancelledSessions(selectedDate, "no");
    } else {
      await fetchCancelledSessions(selectedDate, "yes");
    }
  };


  /* -----------------------------
     FETCH: Add-Ons Cancelled
  ------------------------------ */
  const fetchCancelledAddOns = async (dateStr: string): Promise<void> => {
    setLoading(true);

    const { startIso, endIso } = manilaDayRange(dateStr);

    const { data, error } = await supabase
      .from("customer_session_add_ons_cancelled")
      .select(
        `
        id,
        cancelled_at,
        original_id,
        created_at,
        add_on_id,
        quantity,
        price,
        full_name,
        seat_number,
        gcash_amount,
        cash_amount,
        is_paid,
        paid_at,
        description,
        add_ons (
          id,
          name,
          category,
          size
        )
      `
      )
      .gte("cancelled_at", startIso)
      .lt("cancelled_at", endIso)
      .order("cancelled_at", { ascending: true })
      .returns<CancelRowDB_AddOns[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CANCELLED ADD-ONS ERROR:", error);
      setRowsAddOns([]);
      setLoading(false);
      return;
    }

    const mapped: CancelItemAddOn[] = (data ?? []).map((r) => {
      const a = r.add_ons;
      const qty = Math.max(0, Math.floor(Number(r.quantity) || 0));
      const price = round2(Math.max(0, toNumber(r.price)));
      const total = round2(qty * price);

      return {
        id: r.id,
        original_id: r.original_id,
        add_on_id: r.add_on_id,

        item_name: a?.name ?? "-",
        category: a?.category ?? "-",
        size: a?.size ?? null,

        quantity: qty,
        price,
        total,

        cancelled_at: r.cancelled_at,
        created_at: r.created_at ?? null,

        full_name: r.full_name,
        seat_number: r.seat_number,

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,

        description: String(r.description ?? "").trim(),
      };
    });

    setRowsAddOns(mapped);
    setLoading(false);
  };

  const groupAddOnsFromRows = (rows: CancelItemAddOn[]): CancelGroupAddOn[] => {
    if (rows.length === 0) return [];

    const groups: CancelGroupAddOn[] = [];
    let current: CancelGroupAddOn | null = null;
    let last: CancelItemAddOn | null = null;

    const sameKey = (a: CancelItemAddOn, b: CancelItemAddOn): boolean =>
      norm(a.full_name) === norm(b.full_name) &&
      norm(a.seat_number) === norm(b.seat_number) &&
      norm(a.description) === norm(b.description);

    for (const r of rows) {
      const startNew =
        current === null ||
        last === null ||
        !sameKey(r, last) ||
        Math.abs(ms(r.cancelled_at) - ms(last.cancelled_at)) > GROUP_WINDOW_MS;

      if (startNew) {
        const key = `${norm(r.full_name)}|${norm(r.seat_number)}|${ms(r.cancelled_at)}|${norm(r.description)}`;
        current = {
          key,
          cancelled_at: r.cancelled_at,
          full_name: r.full_name,
          seat_number: r.seat_number,
          description: r.description || "-",
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
        id: r.id,
        original_id: r.original_id,
        add_on_id: r.add_on_id,
        item_name: r.item_name,
        category: r.category,
        size: r.size,
        quantity: r.quantity,
        price: r.price,
        total: r.total,
      });

      current.grand_total = round2(current.grand_total + r.total);
      current.gcash_amount = round2(current.gcash_amount + r.gcash_amount);
      current.cash_amount = round2(current.cash_amount + r.cash_amount);
      current.is_paid = current.is_paid || r.is_paid;
      current.paid_at = current.paid_at ?? r.paid_at;

      last = r;
    }

    return groups.sort((a, b) => ms(b.cancelled_at) - ms(a.cancelled_at));
  };

  const groupedAddOns = useMemo<CancelGroupAddOn[]>(() => groupAddOnsFromRows(rowsAddOns), [rowsAddOns]);

  /* -----------------------------
     FETCH: Sessions Cancelled
  ------------------------------ */
  const fetchCancelledSessions = async (dateStr: string, reservation: "no" | "yes"): Promise<void> => {
    setLoading(true);
    const mapped = await fetchCancelledSessionsReturn(dateStr, reservation);
    setRowsSessions(mapped);
    setLoading(false);
  };

  const fetchCancelledSessionsReturn = async (dateStr: string, reservation: "no" | "yes"): Promise<CancelledSession[]> => {
    const { startIso, endIso } = manilaDayRange(dateStr);

    const { data, error } = await supabase
      .from("customer_sessions_cancelled")
      .select(
        `
        id,
        cancelled_at,
        cancel_reason,
        created_at,
        staff_id,
        date,
        full_name,
        customer_type,
        customer_field,
        has_id,
        hour_avail,
        time_started,
        time_ended,
        total_time,
        total_amount,
        reservation,
        reservation_date,
        id_number,
        seat_number,
        promo_booking_id,
        discount_kind,
        discount_value,
        discount_reason,
        gcash_amount,
        cash_amount,
        is_paid,
        paid_at,
        phone_number,
        down_payment
      `
      )
      .gte("cancelled_at", startIso)
      .lt("cancelled_at", endIso)
      .eq("reservation", reservation)
      .order("cancelled_at", { ascending: false })
      .returns<CancelledSessionDB[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CANCELLED SESSIONS ERROR:", error);
      return [];
    }

    const mapped: CancelledSession[] = (data ?? []).map((r) => {
      const kindRaw = String(r.discount_kind ?? "none") as DiscountKind;
      const kind: DiscountKind =
        kindRaw === "percent" || kindRaw === "amount" || kindRaw === "none" ? kindRaw : "none";

      return {
        id: r.id,
        cancelled_at: r.cancelled_at,
        cancel_reason: String(r.cancel_reason ?? "").trim() || "-",

        date: String(r.date ?? ""),
        reservation: (String(r.reservation ?? "no") === "yes" ? "yes" : "no") as "no" | "yes",
        reservation_date: r.reservation_date ?? null,

        full_name: String(r.full_name ?? "-"),
        phone_number: r.phone_number ?? null,
        customer_type: String(r.customer_type ?? "-"),
        customer_field: r.customer_field ?? null,
        has_id: Boolean(r.has_id),
        id_number: r.id_number ?? null,
        seat_number: String(r.seat_number ?? "-"),

        hour_avail: String(r.hour_avail ?? "-"),
        time_started: String(r.time_started ?? ""),
        time_ended: String(r.time_ended ?? ""),
        total_time: round2(Math.max(0, toNumber(r.total_time as NumericLike))),
        total_amount: round2(Math.max(0, toNumber(r.total_amount as NumericLike))),

        discount_kind: kind,
        discount_value: round2(Math.max(0, toNumber(r.discount_value as NumericLike))),
        discount_reason: r.discount_reason ?? null,

        down_payment: round2(Math.max(0, toNumber(r.down_payment as NumericLike))),

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount as NumericLike))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount as NumericLike))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,
      };
    });

    return mapped;
  };

  /* =========================
     ADMIN: DELETE
  ========================= */
  const deleteByDateAll = async (): Promise<void> => {
    try {
      setBusyDelete(true);
      const { startIso, endIso } = manilaDayRange(selectedDate);

      const { error: e1 } = await supabase
        .from("customer_session_add_ons_cancelled")
        .delete()
        .gte("cancelled_at", startIso)
        .lt("cancelled_at", endIso);

      if (e1) {
        alert(`Delete Add-Ons by date failed: ${e1.message}`);
        return;
      }

      const { error: e2 } = await supabase
        .from("customer_sessions_cancelled")
        .delete()
        .gte("cancelled_at", startIso)
        .lt("cancelled_at", endIso);

      if (e2) {
        alert(`Delete Sessions by date failed: ${e2.message}`);
        return;
      }

      setConfirmDeleteDate(false);
      await refresh();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Delete by date failed.");
    } finally {
      setBusyDelete(false);
    }
  };

  const deleteAddOnGroup = async (g: CancelGroupAddOn): Promise<void> => {
    try {
      setBusyDelete(true);
      const ids = g.items.map((x) => x.id).filter((x) => String(x || "").length > 0);
      if (ids.length === 0) return;

      const { error } = await supabase.from("customer_session_add_ons_cancelled").delete().in("id", ids);
      if (error) {
        alert(`Delete group failed: ${error.message}`);
        return;
      }

      setConfirmDeleteAddOnGroup(null);
      setSelectedGroupAddOns(null);
      await fetchCancelledAddOns(selectedDate);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Delete group failed.");
    } finally {
      setBusyDelete(false);
    }
  };

  const deleteSessionRow = async (s: CancelledSession): Promise<void> => {
    try {
      setBusyDelete(true);

      const { error } = await supabase.from("customer_sessions_cancelled").delete().eq("id", s.id);
      if (error) {
        alert(`Delete row failed: ${error.message}`);
        return;
      }

      setConfirmDeleteSession(null);
      setSelectedSession(null);

      // refresh current tab only
      await fetchCancelledSessions(selectedDate, s.reservation === "yes" ? "yes" : "no");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Delete row failed.");
    } finally {
      setBusyDelete(false);
    }
  };

  /* =========================
     ADMIN: EXCEL (ONE FILE)
  ========================= */
  const exportExcelAll = async (): Promise<void> => {
    try {
      setBusyExport(true);

      // Pull all sections fresh
      const { startIso, endIso } = manilaDayRange(selectedDate);

      // Add-ons
      const { data: addData, error: addErr } = await supabase
        .from("customer_session_add_ons_cancelled")
        .select(
          `
          id,
          cancelled_at,
          original_id,
          created_at,
          add_on_id,
          quantity,
          price,
          full_name,
          seat_number,
          gcash_amount,
          cash_amount,
          is_paid,
          paid_at,
          description,
          add_ons (
            id,
            name,
            category,
            size
          )
        `
        )
        .gte("cancelled_at", startIso)
        .lt("cancelled_at", endIso)
        .order("cancelled_at", { ascending: true })
        .returns<CancelRowDB_AddOns[]>();

      if (addErr) throw addErr;

      const addMapped: CancelItemAddOn[] = (addData ?? []).map((r) => {
        const a = r.add_ons;
        const qty = Math.max(0, Math.floor(Number(r.quantity) || 0));
        const price = round2(Math.max(0, toNumber(r.price)));
        const total = round2(qty * price);

        return {
          id: r.id,
          original_id: r.original_id,
          add_on_id: r.add_on_id,

          item_name: a?.name ?? "-",
          category: a?.category ?? "-",
          size: a?.size ?? null,

          quantity: qty,
          price,
          total,

          cancelled_at: r.cancelled_at,
          created_at: r.created_at ?? null,

          full_name: r.full_name,
          seat_number: r.seat_number,

          gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
          cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
          is_paid: toBool(r.is_paid),
          paid_at: r.paid_at ?? null,

          description: String(r.description ?? "").trim(),
        };
      });

      const addGroups = groupAddOnsFromRows(addMapped);

      // Walk-in + Reservation
      const walkin = await fetchCancelledSessionsReturn(selectedDate, "no");
      const reservation = await fetchCancelledSessionsReturn(selectedDate, "yes");

      const wb = new ExcelJS.Workbook();
      wb.creator = "Me Tyme Lounge";
      wb.created = new Date();

      const ws = wb.addWorksheet("Cancelled Records", {
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        properties: { defaultRowHeight: 18 },
      });

      ws.columns = [
        { key: "c1", width: 22 },
        { key: "c2", width: 18 },
        { key: "c3", width: 18 },
        { key: "c4", width: 26 },
        { key: "c5", width: 14 },
        { key: "c6", width: 14 },
        { key: "c7", width: 18 },
        { key: "c8", width: 14 },
        { key: "c9", width: 14 },
        { key: "c10", width: 14 },
        { key: "c11", width: 16 },
        { key: "c12", width: 34 },
      ];

      const borderAll: Partial<ExcelJS.Borders> = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };

      const fillGray = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

      const setBorderRow = (rowNo: number, from: number, to: number): void => {
        for (let c = from; c <= to; c++) ws.getCell(rowNo, c).border = borderAll;
      };

      const titleRow = (rowNo: number, text: string): void => {
        ws.mergeCells(rowNo, 1, rowNo, 12);
        const cell = ws.getCell(rowNo, 1);
        cell.value = text;
        cell.font = { bold: true, size: 14 };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.fill = fillGray("FFE5E7EB");
        setBorderRow(rowNo, 1, 12);
        ws.getRow(rowNo).height = 24;
      };

      const headerRow = (rowNo: number, values: string[]): void => {
        ws.getRow(rowNo).values = ["", ...values];
        const row = ws.getRow(rowNo);
        row.font = { bold: true };
        row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        row.height = 22;
        for (let c = 1; c <= 12; c++) {
          const cell = ws.getCell(rowNo, c);
          cell.fill = fillGray("FFF3F4F6");
          cell.border = borderAll;
        }
      };

      const setText = (rowNo: number, col: number, v: string): void => {
        const cell = ws.getCell(rowNo, col);
        cell.value = v;
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = borderAll;
      };

      const setCenter = (rowNo: number, col: number, v: string): void => {
        const cell = ws.getCell(rowNo, col);
        cell.value = v;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = borderAll;
      };

      const setMoney = (rowNo: number, col: number, v: number): void => {
        const cell = ws.getCell(rowNo, col);
        cell.value = round2(v);
        cell.numFmt = '₱#,##0.00';
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.border = borderAll;
      };

      // Optional logo
      try {
        const res = await fetch(logo);
        const buf = await res.arrayBuffer();
        const imgId = wb.addImage({ buffer: buf, extension: "png" });
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 90, height: 90 } });
      } catch {
        // ignore
      }

      ws.mergeCells(1, 1, 1, 12);
      ws.getCell(1, 1).value = "ME TYME LOUNGE — CANCELLED RECORDS";
      ws.getCell(1, 1).font = { bold: true, size: 16 };
      ws.getCell(1, 1).alignment = { vertical: "middle", horizontal: "center" };

      ws.mergeCells(2, 1, 2, 12);
      ws.getCell(2, 1).value = `Date (Cancelled At / Manila): ${selectedDate}`;
      ws.getCell(2, 1).font = { bold: true };
      ws.getCell(2, 1).alignment = { vertical: "middle", horizontal: "center" };

      ws.mergeCells(3, 1, 3, 12);
      ws.getCell(3, 1).value = `Generated: ${new Date().toLocaleString("en-PH")}`;
      ws.getCell(3, 1).alignment = { vertical: "middle", horizontal: "center" };

      let r = 5;

      // 1) ADD-ONS
      titleRow(r, "1) CANCELLED ADD-ONS (Grouped)");
      r++;

      headerRow(r, ["Cancelled At", "Full Name", "Seat", "Item", "Category", "Size", "Qty", "Price", "Total", "Paid", "Description", "Group Key"]);
      r++;

      let addTotal = 0;

      for (const g of addGroups) {
        for (const it of g.items) {
          addTotal = round2(addTotal + it.total);

          setText(r, 1, formatDateTime(g.cancelled_at));
          setText(r, 2, g.full_name || "-");
          setText(r, 3, g.seat_number || "-");
          setText(r, 4, it.item_name || "-");
          setText(r, 5, it.category || "-");
          setText(r, 6, sizeText(it.size));
          setCenter(r, 7, String(it.quantity));
          setMoney(r, 8, it.price);
          setMoney(r, 9, it.total);
          setCenter(r, 10, g.is_paid ? "PAID" : "UNPAID");
          setText(r, 11, g.description || "-");
          setText(r, 12, g.key);
          r++;
        }
      }

      ws.mergeCells(r, 1, r, 8);
      ws.getCell(r, 1).value = "ADD-ONS TOTAL";
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 1).alignment = { vertical: "middle", horizontal: "right" };
      setBorderRow(r, 1, 8);
      setMoney(r, 9, addTotal);
      setBorderRow(r, 10, 12);
      ws.getCell(r, 10).value = "";
      ws.getCell(r, 11).value = "";
      ws.getCell(r, 12).value = "";
      r += 2;

      // 2) WALK-IN
      titleRow(r, "2) CANCELLED WALK-IN");
      r++;

      headerRow(r, ["Cancelled At", "Date", "Full Name", "Phone", "Seat", "Type", "Hours", "Time In", "Time Out", "Amount (After Discount)", "Cancel Reason", "Paid"]);
      r++;

      let wTotal = 0;

      for (const s of walkin) {
        const base = round2(Math.max(0, s.total_amount));
        const disc = applyDiscount(base, s.discount_kind, s.discount_value);
        wTotal = round2(wTotal + disc.discountedCost);

        setText(r, 1, formatDateTime(s.cancelled_at));
        setText(r, 2, s.date);
        setText(r, 3, s.full_name);
        setText(r, 4, String(s.phone_number ?? "").trim() || "N/A");
        setText(r, 5, s.seat_number);
        setText(r, 6, s.customer_type);
        setCenter(r, 7, s.hour_avail);
        setText(r, 8, formatTimeText(s.time_started));
        setText(r, 9, formatTimeText(s.time_ended));
        setMoney(r, 10, disc.discountedCost);
        setText(r, 11, s.cancel_reason || "-");
        setCenter(r, 12, s.is_paid ? "PAID" : "UNPAID");
        r++;
      }

      ws.mergeCells(r, 1, r, 9);
      ws.getCell(r, 1).value = "WALK-IN TOTAL (After Discount)";
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 1).alignment = { vertical: "middle", horizontal: "right" };
      setBorderRow(r, 1, 9);
      setMoney(r, 10, wTotal);
      setBorderRow(r, 11, 12);
      ws.getCell(r, 11).value = "";
      ws.getCell(r, 12).value = "";
      r += 2;

      // 3) RESERVATION
      titleRow(r, "3) CANCELLED RESERVATION");
      r++;

      headerRow(r, ["Cancelled At", "Date", "Reservation Date", "Full Name", "Phone", "Seat", "Type", "Hours", "Time In", "Time Out", "Amount (After Discount)", "Cancel Reason"]);
      r++;

      let resTotal = 0;

      for (const s of reservation) {
        const base = round2(Math.max(0, s.total_amount));
        const disc = applyDiscount(base, s.discount_kind, s.discount_value);
        resTotal = round2(resTotal + disc.discountedCost);

        setText(r, 1, formatDateTime(s.cancelled_at));
        setText(r, 2, s.date);
        setText(r, 3, s.reservation_date ?? "-");
        setText(r, 4, s.full_name);
        setText(r, 5, String(s.phone_number ?? "").trim() || "N/A");
        setText(r, 6, s.seat_number);
        setText(r, 7, s.customer_type);
        setCenter(r, 8, s.hour_avail);
        setText(r, 9, formatTimeText(s.time_started));
        setText(r, 10, formatTimeText(s.time_ended));
        setMoney(r, 11, disc.discountedCost);
        setText(r, 12, s.cancel_reason || "-");
        r++;
      }

      ws.mergeCells(r, 1, r, 10);
      ws.getCell(r, 1).value = "RESERVATION TOTAL (After Discount)";
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 1).alignment = { vertical: "middle", horizontal: "right" };
      setBorderRow(r, 1, 10);
      setMoney(r, 11, resTotal);
      setBorderRow(r, 12, 12);
      ws.getCell(r, 12).value = "";
      r += 2;

      titleRow(r, "SUMMARY");
      r++;

      headerRow(r, ["Section", "Count", "Total", "", "", "", "", "", "", "", "", ""]);
      r++;

      const addCount = addGroups.reduce((acc, g) => acc + g.items.length, 0);

      setText(r, 1, "Add-Ons (items)");
      setCenter(r, 2, String(addCount));
      setMoney(r, 3, addTotal);
      setBorderRow(r, 4, 12);
      r++;

      setText(r, 1, "Walk-in");
      setCenter(r, 2, String(walkin.length));
      setMoney(r, 3, wTotal);
      setBorderRow(r, 4, 12);
      r++;

      setText(r, 1, "Reservation");
      setCenter(r, 2, String(reservation.length));
      setMoney(r, 3, resTotal);
      setBorderRow(r, 4, 12);
      r++;

      ws.mergeCells(r, 1, r, 2);
      ws.getCell(r, 1).value = "GRAND TOTAL";
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 1).alignment = { vertical: "middle", horizontal: "right" };
      setBorderRow(r, 1, 2);
      setMoney(r, 3, round2(addTotal + wTotal + resTotal));
      setBorderRow(r, 4, 12);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `Cancelled_Records_${selectedDate}.xlsx`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Export failed.");
    } finally {
      setBusyExport(false);
    }
  };

  /* -----------------------------
     UI
  ------------------------------ */
  const tabTitle =
    tab === "addons" ? "Cancelled Add-Ons" : tab === "walkin" ? "Cancelled Walk-in" : "Cancelled Reservation";

  return (
    <IonPage>
      <IonContent className="cancelled-content">
        {/* ✅ CONFIRM DELETE BY DATE */}
        <IonAlert
          isOpen={confirmDeleteDate}
          onDidDismiss={() => setConfirmDeleteDate(false)}
          header="Delete Cancelled Records"
          message={`Delete ALL cancelled records for ${selectedDate}? (Add-Ons + Walk-in + Reservation)`}
          buttons={[
            { text: "Cancel", role: "cancel" },
            {
              text: busyDelete ? "Deleting..." : "Delete",
              role: "destructive",
              handler: () => {
                void deleteByDateAll();
              },
            },
          ]}
        />

        {/* ✅ CONFIRM DELETE GROUP */}
        <IonAlert
          isOpen={Boolean(confirmDeleteAddOnGroup)}
          onDidDismiss={() => setConfirmDeleteAddOnGroup(null)}
          header="Delete Cancelled Add-Ons"
          message={
            confirmDeleteAddOnGroup
              ? `Delete this cancelled add-ons group for ${confirmDeleteAddOnGroup.full_name} (${confirmDeleteAddOnGroup.items.length} item(s))?`
              : ""
          }
          buttons={[
            { text: "Cancel", role: "cancel" },
            {
              text: busyDelete ? "Deleting..." : "Delete",
              role: "destructive",
              handler: () => {
                if (confirmDeleteAddOnGroup) void deleteAddOnGroup(confirmDeleteAddOnGroup);
              },
            },
          ]}
        />

        {/* ✅ CONFIRM DELETE SESSION */}
        <IonAlert
          isOpen={Boolean(confirmDeleteSession)}
          onDidDismiss={() => setConfirmDeleteSession(null)}
          header="Delete Cancelled Session"
          message={
            confirmDeleteSession
              ? `Delete this cancelled ${confirmDeleteSession.reservation === "yes" ? "RESERVATION" : "WALK-IN"} record for ${
                  confirmDeleteSession.full_name
                }?`
              : ""
          }
          buttons={[
            { text: "Cancel", role: "cancel" },
            {
              text: busyDelete ? "Deleting..." : "Delete",
              role: "destructive",
              handler: () => {
                if (confirmDeleteSession) void deleteSessionRow(confirmDeleteSession);
              },
            },
          ]}
        />

        <div className="customer-lists-container">
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">{tabTitle} Records</h2>
              <div className="customer-subtext">
                Showing cancelled records for: <strong>{selectedDate}</strong>{" "}
                {tab === "addons" ? `(${groupedAddOns.length})` : `(${rowsSessions.length})`}
              </div>
              <div className="customer-subtext" style={{ fontSize: 12, opacity: 0.75 }}>
                Read-only: cancelled records cannot be edited. (Admin can delete/export)
              </div>
            </div>

            <div className="customer-topbar-right" style={{ gap: 10, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
              {/* ✅ TABS */}
              <div className="customer-searchbar-inline" style={{ minWidth: 360 }}>
                <div className="customer-searchbar-inner" style={{ gap: 8 }}>
                  <button
                    className={`receipt-btn ${tab === "addons" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("addons");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Add-Ons
                  </button>

                  <button
                    className={`receipt-btn ${tab === "walkin" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("walkin");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Walk-in
                  </button>

                  <button
                    className={`receipt-btn ${tab === "reservation" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("reservation");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Reservation
                  </button>
                </div>
              </div>

              {/* DATE */}
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

              <button
                className="receipt-btn"
                onClick={() => void refresh()}
                style={{ whiteSpace: "nowrap" }}
                type="button"
                disabled={loading || busyDelete}
              >
                Refresh
              </button>

              <button
                className="receipt-btn"
                onClick={() => void exportExcelAll()}
                style={{ whiteSpace: "nowrap" }}
                type="button"
                disabled={busyExport || busyDelete}
              >
                {busyExport ? "Exporting..." : "Export Excel (ALL)"}
              </button>

              <button
                className="receipt-btn admin-danger"
                onClick={() => setConfirmDeleteDate(true)}
                style={{ whiteSpace: "nowrap" }}
                type="button"
                disabled={busyDelete || busyExport}
              >
                {busyDelete ? "Deleting..." : "Delete by Date"}
              </button>
            </div>
          </div>

          {loading && (
            <div className="customer-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IonSpinner name="dots" /> Loading...
            </div>
          )}

          {/* =========================
              TAB: ADD-ONS
          ========================= */}
          {tab === "addons" && (
            <>
              {loading ? (
                <p className="customer-note">Loading...</p>
              ) : groupedAddOns.length === 0 ? (
                <p className="customer-note">No cancelled add-ons found for this date</p>
              ) : (
                <div className="customer-table-wrap" key={`${selectedDate}-addons`}>
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Cancelled At</th>
                        <th>Full Name</th>
                        <th>Seat</th>
                        <th>Items</th>
                        <th>Grand Total</th>
                        <th>Description</th>
                        <th>Paid</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {groupedAddOns.map((g) => (
                        <tr key={g.key}>
                          <td>{formatDateTime(g.cancelled_at)}</td>
                          <td>{g.full_name || "-"}</td>
                          <td>{g.seat_number || "-"}</td>

                          <td>
                            <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                              {g.items.map((it) => (
                                <div
                                  key={it.id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                                    paddingBottom: 6,
                                  }}
                                >
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 900 }}>
                                      {it.item_name}{" "}
                                      <span style={{ fontWeight: 700, opacity: 0.7 }}>
                                        ({it.category}
                                        {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                                      </span>
                                    </div>
                                    <div style={{ opacity: 0.85, fontSize: 13 }}>
                                      Qty: {it.quantity} • {moneyText(it.price)}
                                    </div>
                                  </div>
                                  <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(it.total)}</div>
                                </div>
                              ))}
                            </div>
                          </td>

                          <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(g.grand_total)}</td>

                          <td style={{ minWidth: 220 }}>
                            <div className="cancel-desc">{g.description || "-"}</div>
                          </td>

                          <td>
                            <ReadOnlyBadge paid={g.is_paid} />
                          </td>

                          <td>
                            <div className="action-stack">
                              <button className="receipt-btn" onClick={() => setSelectedGroupAddOns(g)} type="button">
                                View Receipt
                              </button>

                              <button
                                className="receipt-btn admin-danger"
                                onClick={() => setConfirmDeleteAddOnGroup(g)}
                                type="button"
                                disabled={busyDelete}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* RECEIPT MODAL (ADD-ONS) */}
              {selectedGroupAddOns && (
                <div className="receipt-overlay" onClick={() => setSelectedGroupAddOns(null)}>
                  <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                    <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                    <h3 className="receipt-title">ME TYME LOUNGE</h3>
                    <p className="receipt-subtitle">CANCELLED ADD-ONS RECEIPT</p>

                    <hr />

                    <div className="receipt-row">
                      <span>Cancelled At</span>
                      <span>{formatDateTime(selectedGroupAddOns.cancelled_at)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Customer</span>
                      <span>{selectedGroupAddOns.full_name}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Seat</span>
                      <span>{selectedGroupAddOns.seat_number}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Description</span>
                      <span style={{ fontWeight: 800 }}>{selectedGroupAddOns.description || "-"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Status</span>
                      <span className="receipt-status">{selectedGroupAddOns.is_paid ? "PAID" : "UNPAID"}</span>
                    </div>

                    <hr />

                    {selectedGroupAddOns.items.map((it) => (
                      <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900 }}>
                            {it.item_name}{" "}
                            <span style={{ fontWeight: 700, opacity: 0.7 }}>
                              ({it.category}
                              {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                            </span>
                          </div>
                          <div style={{ opacity: 0.8, fontSize: 13 }}>
                            {it.quantity} × {moneyText(it.price)}
                          </div>
                        </div>
                        <div style={{ fontWeight: 1000, whiteSpace: "nowrap" }}>{moneyText(it.total)}</div>
                      </div>
                    ))}

                    <hr />

                    <div className="receipt-row">
                      <span>Total</span>
                      <span style={{ fontWeight: 900 }}>{moneyText(selectedGroupAddOns.grand_total)}</span>
                    </div>

                    <p className="receipt-footer">
                      Cancelled record archived <br />
                      <strong>Me Tyme Lounge</strong>
                    </p>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="close-btn" onClick={() => setSelectedGroupAddOns(null)} type="button">
                        Close
                      </button>
                      <button
                        className="receipt-btn admin-danger"
                        onClick={() => setConfirmDeleteAddOnGroup(selectedGroupAddOns)}
                        type="button"
                        disabled={busyDelete}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* =========================
              TAB: WALK-IN / RESERVATION
          ========================= */}
          {tab !== "addons" && (
            <>
              {loading ? (
                <p className="customer-note">Loading...</p>
              ) : rowsSessions.length === 0 ? (
                <p className="customer-note">No cancelled sessions found for this date</p>
              ) : (
                <div className="customer-table-wrap" key={`${selectedDate}-${tab}`}>
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Cancelled At</th>
                        <th>Date</th>
                        {tab === "reservation" && <th>Reservation Date</th>}
                        <th>Full Name</th>
                        <th>Phone #</th>
                        <th>Seat</th>
                        <th>Type</th>
                        <th>Hours</th>
                        <th>Time In</th>
                        <th>Time Out</th>
                        <th>Total Amount</th>
                        <th>Discount</th>
                        <th>Down Payment</th>
                        <th>Paid</th>
                        <th>Cancel Reason</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {rowsSessions.map((s) => {
                        const base = round2(Math.max(0, s.total_amount));
                        const disc = applyDiscount(base, s.discount_kind, s.discount_value);
                        const dp = round2(Math.max(0, s.down_payment));
                        const afterDp = round2(Math.max(0, disc.discountedCost - dp));

                        return (
                          <tr key={s.id}>
                            <td>{formatDateTime(s.cancelled_at)}</td>
                            <td>{s.date}</td>
                            {tab === "reservation" && <td>{s.reservation_date ?? "-"}</td>}
                            <td>{s.full_name}</td>
                            <td>{String(s.phone_number ?? "").trim() || "N/A"}</td>
                            <td>{s.seat_number}</td>
                            <td>{s.customer_type}</td>
                            <td>{s.hour_avail}</td>
                            <td>{formatTimeText(s.time_started)}</td>
                            <td>{formatTimeText(s.time_ended)}</td>
                            <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(base)}</td>
                            <td>{getDiscountText(s.discount_kind, s.discount_value)}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{moneyText(dp)}</td>
                            <td>
                              <ReadOnlyBadge paid={s.is_paid} />
                            </td>
                            <td style={{ minWidth: 220 }}>
                              <div className="cancel-desc">{s.cancel_reason || "-"}</div>
                            </td>
                            <td>
                              <div className="action-stack">
                                <button className="receipt-btn" onClick={() => setSelectedSession(s)} type="button">
                                  View Receipt
                                </button>

                                <button
                                  className="receipt-btn admin-danger"
                                  onClick={() => setConfirmDeleteSession(s)}
                                  type="button"
                                  disabled={busyDelete}
                                >
                                  Delete
                                </button>

                                <div style={{ fontSize: 12, opacity: 0.8 }}>
                                  After DP: <strong>{moneyText(afterDp)}</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* RECEIPT MODAL (SESSIONS) */}
              {selectedSession && (
                <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
                  <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                    <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                    <h3 className="receipt-title">ME TYME LOUNGE</h3>
                    <p className="receipt-subtitle">
                      {selectedSession.reservation === "yes"
                        ? "CANCELLED RESERVATION RECEIPT"
                        : "CANCELLED WALK-IN RECEIPT"}
                    </p>

                    <hr />

                    <div className="receipt-row">
                      <span>Cancelled At</span>
                      <span>{formatDateTime(selectedSession.cancelled_at)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Date</span>
                      <span>{selectedSession.date}</span>
                    </div>

                    {selectedSession.reservation === "yes" && (
                      <div className="receipt-row">
                        <span>Reservation Date</span>
                        <span>{selectedSession.reservation_date ?? "-"}</span>
                      </div>
                    )}

                    <div className="receipt-row">
                      <span>Customer</span>
                      <span>{selectedSession.full_name}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Phone</span>
                      <span>{String(selectedSession.phone_number ?? "").trim() || "N/A"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Type</span>
                      <span>{selectedSession.customer_type}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Field</span>
                      <span>{selectedSession.customer_field ?? ""}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Seat</span>
                      <span>{selectedSession.seat_number}</span>
                    </div>

                    <hr />

                    <div className="receipt-row">
                      <span>Time In</span>
                      <span>{formatTimeText(selectedSession.time_started)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Time Out</span>
                      <span>{formatTimeText(selectedSession.time_ended)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Total Time</span>
                      <span>{selectedSession.total_time}</span>
                    </div>

                    <hr />

                    {(() => {
                      const base = round2(Math.max(0, selectedSession.total_amount));
                      const disc = applyDiscount(base, selectedSession.discount_kind, selectedSession.discount_value);
                      const dp = round2(Math.max(0, selectedSession.down_payment));
                      const afterDp = round2(Math.max(0, disc.discountedCost - dp));
                      const change = round2(Math.max(0, dp - disc.discountedCost));

                      const bottomLabel = afterDp > 0 ? "BALANCE AFTER DP" : "CHANGE";
                      const bottomVal = afterDp > 0 ? afterDp : change;

                      return (
                        <>
                          <div className="receipt-row">
                            <span>System Cost (Before)</span>
                            <span>{moneyText(base)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Discount</span>
                            <span>{getDiscountText(selectedSession.discount_kind, selectedSession.discount_value)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>System Cost (After Discount)</span>
                            <span>{moneyText(disc.discountedCost)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Down Payment</span>
                            <span>{moneyText(dp)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>GCash</span>
                            <span>{moneyText(selectedSession.gcash_amount)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Cash</span>
                            <span>{moneyText(selectedSession.cash_amount)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Status</span>
                            <span className="receipt-status">{selectedSession.is_paid ? "PAID" : "UNPAID"}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Cancel Reason</span>
                            <span style={{ fontWeight: 800 }}>{selectedSession.cancel_reason || "-"}</span>
                          </div>

                          <div className="receipt-total">
                            <span>{bottomLabel}</span>
                            <span>{moneyText(bottomVal)}</span>
                          </div>
                        </>
                      );
                    })()}

                    <p className="receipt-footer">
                      Cancelled record archived <br />
                      <strong>Me Tyme Lounge</strong>
                    </p>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="close-btn" onClick={() => setSelectedSession(null)} type="button">
                        Close
                      </button>
                      <button
                        className="receipt-btn admin-danger"
                        onClick={() => setConfirmDeleteSession(selectedSession)}
                        type="button"
                        disabled={busyDelete}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Customer_Cancelled;
