// src/pages/staff_sales_report.tsx
// ✅ STRICT TS, NO any
// ✅ Cash Outs TOTAL now split into CASH / GCASH (uses cash_outs.payment_method)
// ✅ If your table still uses ONLY cashout_date + amount, it will fallback to ALL as CASH
// ✅ Uses paid_at date window logic elsewhere unchanged
// ✅ FIX: Add-ons (Paid) is now based on PAYMENT amounts (cash_amount + gcash_amount)
//         grouped per order (same full_name+seat within 10s) to avoid double counting
// ✅ FIX (YOUR REQUEST): "Total Time" is now based on TIME CONSUMED amount
//         Example: 1 hour => ₱20 (HOURLY_RATE=20). Uses Customer_Lists/Reservations logic.
//         Includes BOTH: non-reservation (date) + reservation (reservation_date).
//         If OPEN session: uses NOW as time_out.
// ✅ NEW (YOUR REQUEST): If session is UNPAID, DO NOT COUNT:
//         - Discount total
//         - Total Time amount
//         Applies to BOTH non-reservation + reservation.
// ✅ CONSIGNMENT NET (SAME AS ADMIN):
//         - Uses RPC: get_consignment_totals_for_day(p_date)
//         - RPC handles Manila date inside (paid_at at time zone 'Asia/Manila')
//         - Returns: gross, fee15, net
//         - Display boxes: Consignment Sales / Inventory Loss
// ✅ NEW (YOUR REQUEST): Inventory Loss is now loaded from add_on_expenses
//         - expense_type='inventory_loss'
//         - within selected Manila day
//         - not voided
//         - sum(expense_amount)
// ✅ NEW (YOUR REQUEST): Total Time now INCLUDES PROMO (same idea as Admin Sales Report)
//         - promo_bookings paid within selected Manila day (paid_at preferred)
//         - adds promo base price into Total Time amount
//         - adds promo discount into Discount total (PAID ONLY)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonHeader,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonText,
  IonItem,
  IonLabel,
  IonInput,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonToast,
  IonModal,
  IonButtons,
  IonIcon,
  IonDatetime,
  IonToolbar,
  IonTitle,
} from "@ionic/react";
import { calendarOutline, closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

/* =========================
   PRICING (same idea as Customer_Lists/Reservations)
========================= */

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

/* =========================
   TYPES
========================= */

type MoneyKind = "cash" | "coin";
type CashOutMethod = "cash" | "gcash";

interface DailyReportRow {
  id: string;
  report_date: string; // YYYY-MM-DD
  starting_cash: number | string;
  starting_gcash: number | string;
  bilin_amount: number | string;

  is_submitted?: boolean;
  submitted_at?: string | null;
}

interface CashCountDBRow {
  report_id: string;
  money_kind: MoneyKind;
  denomination: number | string;
  qty: number;
}

interface CashLine {
  report_id: string;
  money_kind: MoneyKind;
  denomination: number;
  qty: number;
}

interface SalesTotalsRow {
  id: string;
  report_date: string;

  starting_cash: number | string;
  starting_gcash: number | string;
  bilin_amount: number | string;

  coh_total: number | string;
  expenses_amount: number | string;

  paid_reservation_cash: number | string;
  paid_reservation_gcash: number | string;

  advance_cash: number | string;
  advance_gcash: number | string;

  walkin_cash: number | string;
  walkin_gcash: number | string;

  total_time: number | string;

  addons_total: number | string;
  discount_total: number | string;

  cash_sales: number | string;
  gcash_sales: number | string;

  system_sale: number | string;

  sales_collected: number | string;
  net_collected: number | string;
}

type ConsignmentState = {
  gross: number;
  fee15: number;
  net: number;
};

type ConsignmentRpcRow = {
  gross: number | string | null;
  fee15: number | string | null;
  net: number | string | null;
};

// ✅ for Add-ons payment grouping (avoid double counting)
type AddOnPaymentRow = {
  created_at: string;
  full_name: string;
  seat_number: string;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
};

// ✅ for total time + discount (PAID ONLY)
type SessionForTimeRow = {
  date: string | null;
  reservation: string | null;
  reservation_date: string | null;

  time_started: string | null;
  time_ended: string | null;
  hour_avail: string | null;

  is_paid: boolean | null;

  discount_kind: string | null; // 'none' | 'percent' | 'amount'
  discount_value: number | string | null;
};

// ✅ inventory loss rows
type AddOnExpenseRow = {
  created_at: string;
  expense_type: string;
  expense_amount: number | string | null;
  voided: boolean | null;
};

// ✅ promo rows for Total Time + Discount
type PromoForTimeRow = {
  created_at: string;
  paid_at: string | null;
  is_paid: boolean | null;
  start_at: string;
  end_at: string;
  price: number | string | null;
  discount_kind: string | null;
  discount_value: number | string | null;
};

/* =========================
   CONSTANTS
========================= */

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50];
const COIN_DENOMS: number[] = [20, 10, 5, 1];

const toNumber = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

const todayYMD = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const isYMD = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

const addDaysYMD = (ymd: string, days: number): string => {
  if (!isYMD(ymd)) return todayYMD();
  const [yy, mm, dd] = ymd.split("-").map((x) => Number(x));
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* =========================
   SAFE EVENT VALUE HELPERS (NO any)
========================= */

const getDetailValue = (ev: unknown): unknown => {
  if (!ev || typeof ev !== "object") return null;
  if (!("detail" in ev)) return null;

  const detail = (ev as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;

  return (detail as { value?: unknown }).value ?? null;
};

const valueToString = (v: unknown): string => (typeof v === "string" ? v : "");

const valueToNonNegInt = (v: unknown): number => {
  const s = valueToString(v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
};

const valueToNonNegMoney = (v: unknown): number => {
  const s = valueToString(v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
};

/* =========================
   DATE HELPERS
========================= */

const isoToYMD = (iso: string): string => {
  const raw = iso.trim();
  if (!raw) return todayYMD();
  const ymd = raw.slice(0, 10);
  return isYMD(ymd) ? ymd : todayYMD();
};

const buildZeroLines = (reportId: string): CashLine[] => {
  const merged: CashLine[] = [];
  for (const d of CASH_DENOMS) merged.push({ report_id: reportId, money_kind: "cash", denomination: d, qty: 0 });
  for (const d of COIN_DENOMS) merged.push({ report_id: reportId, money_kind: "coin", denomination: d, qty: 0 });
  return merged;
};

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/* =========================
   ADD-ONS PAYMENT GROUPING (avoid double count)
========================= */

const GROUP_WINDOW_MS = 10_000;

const computeAddonsPaidFromPayments = (rows: AddOnPaymentRow[]): number => {
  if (rows.length === 0) return 0;

  const sorted = [...rows].sort((a, b) => ms(a.created_at) - ms(b.created_at));

  let total = 0;

  let curName = "";
  let curSeat = "";
  let curLast = 0;
  let started = false;

  let maxG = 0;
  let maxC = 0;

  const flush = (): void => {
    total += Math.max(0, maxG) + Math.max(0, maxC);
    maxG = 0;
    maxC = 0;
  };

  for (const r of sorted) {
    const t = ms(r.created_at);
    const name = norm(r.full_name);
    const seat = norm(r.seat_number);

    const g = Math.max(0, toNumber(r.gcash_amount));
    const c = Math.max(0, toNumber(r.cash_amount));

    const startNew = !started || name !== curName || seat !== curSeat || Math.abs(t - curLast) > GROUP_WINDOW_MS;

    if (startNew) {
      if (started) flush();
      started = true;
      curName = name;
      curSeat = seat;
      curLast = t;
      maxG = g;
      maxC = c;
      continue;
    }

    curLast = t;
    maxG = Math.max(maxG, g);
    maxC = Math.max(maxC, c);
  }

  if (started) flush();

  return total;
};

/* =========================
   TOTAL TIME AMOUNT (TIME CONSUMED => ₱)
   + DISCOUNT TOTAL (PAID ONLY)
========================= */

const isOpenTimeSession = (hourAvail: string | null | undefined, timeEnded: string | null | undefined): boolean => {
  if ((hourAvail ?? "").toUpperCase() === "OPEN") return true;
  if (!timeEnded) return true;
  const end = new Date(timeEnded);
  if (!Number.isFinite(end.getTime())) return true;
  return end.getFullYear() >= 2999;
};

const diffMinutes = (startIso: string, endIso: string): number => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / (1000 * 60));
};

const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
  const minutesUsed = diffMinutes(startIso, endIso);
  const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
  const perMinute = HOURLY_RATE / 60;
  return round2(chargeMinutes * perMinute);
};

const computeDiscountAmountFromBaseCost = (
  baseCost: number,
  kindRaw: string | null | undefined,
  valueRaw: number | string | null | undefined
): number => {
  const kind = (kindRaw ?? "none").toLowerCase().trim();
  const v = Math.max(0, toNumber(valueRaw));

  if (kind === "amount") return round2(Math.min(baseCost, v));
  if (kind === "percent") return round2(baseCost * (Math.min(100, v) / 100));
  return 0;
};

/* =========================
   PAGE
========================= */

const StaffSalesReport: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(() => todayYMD());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [loading, setLoading] = useState<boolean>(true);

  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  // ✅ CONSIGNMENT (PAID ONLY) — from RPC (same as admin)
  const [consignment, setConsignment] = useState<ConsignmentState>({ gross: 0, fee15: 0, net: 0 });

  // ✅ ADD-ONS (PAYMENTS)
  const [addonsPaid, setAddonsPaid] = useState<number>(0);

  // ✅ CASH OUTS TOTAL (cashout_date) split cash/gcash
  const [cashOutsCash, setCashOutsCash] = useState<number>(0);
  const [cashOutsGcash, setCashOutsGcash] = useState<number>(0);

  // ✅ Total Time amount (₱) — PAID ONLY (includes PROMO now)
  const [totalTimeAmount, setTotalTimeAmount] = useState<number>(0);

  // ✅ Discount total — PAID ONLY (includes PROMO now)
  const [discountPaid, setDiscountPaid] = useState<number>(0);

  // ✅ NEW: Inventory Loss (amount) from add_on_expenses (expense_type='inventory_loss')
  const [inventoryLossAmount, setInventoryLossAmount] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; color?: string }>(() => ({
    open: false,
    msg: "",
    color: "success",
  }));

  /* =========================
     LOAD / ENSURE REPORT
  ========================= */

  const ensureReportRow = async (dateYMD: string): Promise<void> => {
    const upsertRes = await supabase
      .from("daily_sales_reports")
      .upsert(
        { report_date: dateYMD, starting_cash: 0, starting_gcash: 0, bilin_amount: 0 },
        { onConflict: "report_date", ignoreDuplicates: true }
      );

    if (upsertRes.error) {
      // eslint-disable-next-line no-console
      console.error("daily_sales_reports ensure(upsert) error:", upsertRes.error.message);
    }
  };

  const loadReport = async (dateYMD: string): Promise<void> => {
    setLoading(true);

    if (!isYMD(dateYMD)) {
      setReport(null);
      setLines([]);
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setCashOutsCash(0);
      setCashOutsGcash(0);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      setInventoryLossAmount(0);
      setLoading(false);
      return;
    }

    await ensureReportRow(dateYMD);

    const res = await supabase
      .from("daily_sales_reports")
      .select("id, report_date, starting_cash, starting_gcash, bilin_amount, is_submitted, submitted_at")
      .eq("report_date", dateYMD)
      .single<DailyReportRow>();

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("daily_sales_reports select error:", res.error.message);
      setReport(null);
      setLines([]);
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setCashOutsCash(0);
      setCashOutsGcash(0);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      setInventoryLossAmount(0);
      setLoading(false);
      return;
    }

    // ✅ if submitted date: staff sees zeros (hidden view)
    if (res.data?.is_submitted) {
      const r = res.data;
      setReport({ ...r, starting_cash: 0, starting_gcash: 0, bilin_amount: 0 });
      setLines(buildZeroLines(r.id));
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setCashOutsCash(0);
      setCashOutsGcash(0);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      setInventoryLossAmount(0);
      setLoading(false);
      return;
    }

    setReport(res.data);
    setLoading(false);
  };

  const loadCashLines = async (reportId: string): Promise<void> => {
    const res = await supabase
      .from("daily_cash_count_lines")
      .select("report_id, money_kind, denomination, qty")
      .eq("report_id", reportId);

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("daily_cash_count_lines select error:", res.error.message);
      return;
    }

    const rows: CashCountDBRow[] = (res.data ?? []) as CashCountDBRow[];
    const merged: CashLine[] = [];

    for (const d of CASH_DENOMS) {
      const found = rows.find((r) => r.money_kind === "cash" && toNumber(r.denomination) === d);
      merged.push({ report_id: reportId, money_kind: "cash", denomination: d, qty: found?.qty ?? 0 });
    }

    for (const d of COIN_DENOMS) {
      const found = rows.find((r) => r.money_kind === "coin" && toNumber(r.denomination) === d);
      merged.push({ report_id: reportId, money_kind: "coin", denomination: d, qty: found?.qty ?? 0 });
    }

    setLines(merged);
  };

  const loadTotals = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setTotals(null);
      return;
    }

    const res = await supabase
      .from("v_daily_sales_report_totals")
      .select("*")
      .eq("report_date", dateYMD)
      .single<SalesTotalsRow>();

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("v_daily_sales_report_totals error:", res.error.message);
      setTotals(null);
      return;
    }

    setTotals(res.data);
  };

  /**
   * ✅ CONSIGNMENT NET (SAME AS ADMIN)
   */
  const loadConsignment = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    const res = await supabase.rpc("get_consignment_totals_for_day", { p_date: dateYMD });

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("get_consignment_totals_for_day error:", res.error.message);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    const row = (res.data?.[0] ?? null) as ConsignmentRpcRow | null;
    if (!row) {
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    setConsignment({
      gross: toNumber(row.gross),
      fee15: toNumber(row.fee15),
      net: toNumber(row.net),
    });
  };

  // ✅ FIXED: Add-ons (Paid) based on PAYMENT, not total
  const loadAddonsPaid = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setAddonsPaid(0);
      return;
    }

    // Manila day range (timestamptz safe)
    const start = new Date(`${dateYMD}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const res = await supabase
      .from("customer_session_add_ons")
      .select("created_at, full_name, seat_number, gcash_amount, cash_amount")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("addonsPaid(payment) query error:", res.error.message);
      setAddonsPaid(0);
      return;
    }

    const rows = (res.data ?? []) as AddOnPaymentRow[];
    const onlyWithPayment = rows.filter((r) => toNumber(r.gcash_amount) > 0 || toNumber(r.cash_amount) > 0);

    const totalPayments = computeAddonsPaidFromPayments(onlyWithPayment);
    setAddonsPaid(totalPayments);
  };

  /**
   * ✅ NEW: Inventory Loss amount for the day
   * - reads add_on_expenses within Manila day
   * - expense_type = 'inventory_loss'
   * - not voided
   * - sum(expense_amount)
   */
  const loadInventoryLossAmount = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setInventoryLossAmount(0);
      return;
    }

    // Manila day range (timestamptz safe)
    const start = new Date(`${dateYMD}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const res = await supabase
      .from("add_on_expenses")
      .select("created_at, expense_type, expense_amount, voided")
      .eq("expense_type", "inventory_loss")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("inventory loss query error:", res.error.message);
      setInventoryLossAmount(0);
      return;
    }

    const rows = (res.data ?? []) as AddOnExpenseRow[];
    const sum = rows
      .filter((r) => !r.voided)
      .reduce((acc, r) => acc + Math.max(0, toNumber(r.expense_amount)), 0);

    setInventoryLossAmount(round2(sum));
  };

  /**
   * ✅ CASH OUTS (FIX)
   * - Prefer: cash_outs.payment_method ('cash' | 'gcash')
   * - If column doesn't exist, fallback to old schema
   */
  const loadCashOutsTotal = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setCashOutsCash(0);
      setCashOutsGcash(0);
      return;
    }

    // Try with payment_method first
    const res = await supabase.from("cash_outs").select("amount, cashout_date, payment_method").eq("cashout_date", dateYMD);

    if (res.error) {
      // If payment_method column doesn't exist, fallback to old schema
      const fallback = await supabase.from("cash_outs").select("amount, cashout_date").eq("cashout_date", dateYMD);

      if (fallback.error) {
        // eslint-disable-next-line no-console
        console.error("cash_outs query error:", fallback.error.message);
        setCashOutsCash(0);
        setCashOutsGcash(0);
        return;
      }

      const rows = (fallback.data ?? []) as Array<{ amount: number | string | null }>;
      const total = rows.reduce((sum, r) => sum + toNumber(r.amount), 0);
      setCashOutsCash(total);
      setCashOutsGcash(0);
      return;
    }

    const rows = (res.data ?? []) as Array<{ amount: number | string | null; payment_method?: CashOutMethod | null }>;
    const cash = rows.filter((r) => (r.payment_method ?? "cash") === "cash").reduce((sum, r) => sum + toNumber(r.amount), 0);
    const gcash = rows.filter((r) => (r.payment_method ?? "cash") === "gcash").reduce((sum, r) => sum + toNumber(r.amount), 0);

    setCashOutsCash(cash);
    setCashOutsGcash(gcash);
  };

  /**
   * ✅ TOTAL TIME AMOUNT + DISCOUNT (PAID ONLY)
   * ✅ NOW INCLUDES PROMO (PAID ONLY)
   */
  const loadTimeAndDiscountPaid = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      return;
    }

    const nowIso = new Date().toISOString();

    // Manila day range (timestamptz safe)
    const start = new Date(`${dateYMD}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const selectCols =
      "date,reservation,reservation_date,time_started,time_ended,hour_avail,is_paid,discount_kind,discount_value";

    // 1) Walk-in (PAID only)
    const walkinRes = await supabase
      .from("customer_sessions")
      .select(selectCols)
      .eq("reservation", "no")
      .eq("date", dateYMD)
      .eq("is_paid", true);

    if (walkinRes.error) {
      // eslint-disable-next-line no-console
      console.error("time/discount walkin query error:", walkinRes.error.message);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      return;
    }

    // 2) Reservation (PAID only)
    const reservRes = await supabase
      .from("customer_sessions")
      .select(selectCols)
      .eq("reservation", "yes")
      .eq("reservation_date", dateYMD)
      .eq("is_paid", true);

    if (reservRes.error) {
      // eslint-disable-next-line no-console
      console.error("time/discount reservation query error:", reservRes.error.message);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      return;
    }

    const allSessions: SessionForTimeRow[] = ([] as SessionForTimeRow[]).concat(
      (walkinRes.data ?? []) as SessionForTimeRow[],
      (reservRes.data ?? []) as SessionForTimeRow[]
    );

    // 3) PROMO BOOKINGS (PAID only)
    // Prefer paid_at within Manila day; fallback also include created_at within day (in case paid_at missing)
    const promoRes = await supabase
      .from("promo_bookings")
      .select("created_at, paid_at, is_paid, start_at, end_at, price, discount_kind, discount_value")
      .eq("is_paid", true)
      .or(
        `paid_at.gte.${start.toISOString()},paid_at.lt.${end.toISOString()},and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})`
      );

    if (promoRes.error) {
      // eslint-disable-next-line no-console
      console.error("promo time/discount query error:", promoRes.error.message);
      setTotalTimeAmount(0);
      setDiscountPaid(0);
      return;
    }

    const promoRows = (promoRes.data ?? []) as PromoForTimeRow[];

    let timeSum = 0;
    let discountSum = 0;

    // Sessions: compute time cost based on time consumed
    for (const s of allSessions) {
      if (!s.is_paid) continue;

      const startIso = String(s.time_started ?? "").trim();
      if (!startIso) continue;

      const open = isOpenTimeSession(s.hour_avail, s.time_ended);
      const endIso = open ? nowIso : String(s.time_ended ?? "").trim();
      if (!endIso) continue;

      const timeCost = computeCostWithFreeMinutes(startIso, endIso);
      timeSum += timeCost;

      const dAmt = computeDiscountAmountFromBaseCost(timeCost, s.discount_kind, s.discount_value);
      discountSum += dAmt;
    }

    // Promo: include promo base price as "Total Time" contribution, and promo discount as discount total
    for (const p of promoRows) {
      if (!p.is_paid) continue;

      const base = round2(Math.max(0, toNumber(p.price)));
      if (base <= 0) continue;

      timeSum += base;

      const dAmt = computeDiscountAmountFromBaseCost(base, p.discount_kind, p.discount_value);
      discountSum += dAmt;
    }

    setTotalTimeAmount(round2(timeSum));
    setDiscountPaid(round2(discountSum));
  };

  const upsertQty = async (line: CashLine, qty: number): Promise<void> => {
    if (submitting) return;

    // ✅ submitted date: local-only edit
    if (report?.is_submitted) {
      setLines((prev) =>
        prev.map((x) => (x.money_kind === line.money_kind && x.denomination === line.denomination ? { ...x, qty } : x))
      );
      return;
    }

    const res = await supabase
      .from("daily_cash_count_lines")
      .upsert(
        { report_id: line.report_id, money_kind: line.money_kind, denomination: line.denomination, qty },
        { onConflict: "report_id,money_kind,denomination" }
      );

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("daily_cash_count_lines upsert error:", res.error.message);
      return;
    }

    setLines((prev) =>
      prev.map((x) => (x.money_kind === line.money_kind && x.denomination === line.denomination ? { ...x, qty } : x))
    );
    await loadTotals(selectedDate);
  };

  const updateReportField = async (
    field: "starting_cash" | "starting_gcash" | "bilin_amount",
    valueNum: number
  ): Promise<void> => {
    if (!report || submitting) return;

    const safe = Math.max(0, valueNum);

    // ✅ submitted date: local-only edit
    if (report.is_submitted) {
      setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
      return;
    }

    const res = await supabase.from("daily_sales_reports").update({ [field]: safe }).eq("id", report.id);

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error("daily_sales_reports update error:", res.error.message);
      return;
    }

    setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
    await loadTotals(selectedDate);
  };

  /* =========================
     SUBMIT / DONE
  ========================= */

  const goNextDay = (): void => {
    const next = addDaysYMD(isYMD(selectedDate) ? selectedDate : todayYMD(), 1);
    setReport(null);
    setLines([]);
    setTotals(null);
    setConsignment({ gross: 0, fee15: 0, net: 0 });
    setAddonsPaid(0);
    setCashOutsCash(0);
    setCashOutsGcash(0);
    setTotalTimeAmount(0);
    setDiscountPaid(0);
    setInventoryLossAmount(0);
    setSelectedDate(next);
  };

  const overwriteSaveForSameDate = async (): Promise<string | null> => {
    if (!report) return "No report loaded.";

    if (report.is_submitted) {
      const del = await supabase.from("daily_cash_count_lines").delete().eq("report_id", report.id);
      if (del.error) return del.error.message;
    }

    const r1 = await supabase
      .from("daily_sales_reports")
      .update({
        starting_cash: Math.max(0, toNumber(report.starting_cash)),
        starting_gcash: Math.max(0, toNumber(report.starting_gcash)),
        bilin_amount: Math.max(0, toNumber(report.bilin_amount)),
      })
      .eq("id", report.id);

    if (r1.error) return r1.error.message;

    const payload = lines.map((l) => ({
      report_id: l.report_id,
      money_kind: l.money_kind,
      denomination: l.denomination,
      qty: Math.max(0, Math.floor(toNumber(l.qty))),
    }));

    if (payload.length > 0) {
      const r2 = await supabase
        .from("daily_cash_count_lines")
        .upsert(payload, { onConflict: "report_id,money_kind,denomination" });
      if (r2.error) return r2.error.message;
    }

    return null;
  };

  const onSubmitDone = async (): Promise<void> => {
    if (!report) return;

    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date. Use YYYY-MM-DD.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const saveErr = await overwriteSaveForSameDate();
    if (saveErr) {
      setToast({ open: true, msg: `Save failed: ${saveErr}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const res = await supabase
      .from("daily_sales_reports")
      .update({ is_submitted: true, submitted_at: new Date().toISOString() })
      .eq("id", report.id);

    if (res.error) {
      setToast({ open: true, msg: `Submit failed: ${res.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    // ✅ after submit hide/zero
    setConsignment({ gross: 0, fee15: 0, net: 0 });
    setAddonsPaid(0);
    setCashOutsCash(0);
    setCashOutsGcash(0);
    setTotalTimeAmount(0);
    setDiscountPaid(0);
    setInventoryLossAmount(0);

    setToast({ open: true, msg: `DONE saved for ${selectedDate}. Moving to next day…`, color: "success" });

    setSubmitting(false);
    goNextDay();
  };

  /* =========================
     LOAD when date changes
  ========================= */

  useEffect(() => {
    void (async () => {
      await loadReport(selectedDate);

      if (!isYMD(selectedDate)) {
        setConsignment({ gross: 0, fee15: 0, net: 0 });
        setAddonsPaid(0);
        setCashOutsCash(0);
        setCashOutsGcash(0);
        setTotalTimeAmount(0);
        setDiscountPaid(0);
        setInventoryLossAmount(0);
        return;
      }

      const check = await supabase
        .from("daily_sales_reports")
        .select("is_submitted")
        .eq("report_date", selectedDate)
        .single<{ is_submitted: boolean }>();

      const isSubmitted = Boolean(check.data?.is_submitted);

      if (isSubmitted) {
        setConsignment({ gross: 0, fee15: 0, net: 0 });
        setAddonsPaid(0);
        setCashOutsCash(0);
        setCashOutsGcash(0);
        setTotalTimeAmount(0);
        setDiscountPaid(0);
        setInventoryLossAmount(0);
      } else {
        void loadConsignment(selectedDate);
        void loadAddonsPaid(selectedDate);
        void loadCashOutsTotal(selectedDate);
        void loadTimeAndDiscountPaid(selectedDate); // ✅ includes PROMO now
        void loadInventoryLossAmount(selectedDate);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!report) return;

    if (report.is_submitted) {
      setLines(buildZeroLines(report.id));
      setTotals(null);
      return;
    }

    void loadCashLines(report.id);
    void loadTotals(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  /* =========================
     COMPUTED
  ========================= */

  const cashTotal = useMemo(() => {
    return lines.filter((l) => l.money_kind === "cash").reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const coinTotal = useMemo(() => {
    return lines.filter((l) => l.money_kind === "coin").reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;

  // ✅ COH: cash from cash count, gcash from gcashSales
  const cohCash = cashTotal + coinTotal;
  const cohGcash = gcashSales;

  // ✅ SHOW VALUES (UI)
  const paidResCash = totals ? toNumber(totals.paid_reservation_cash) : 0;
  const paidResGcash = totals ? toNumber(totals.paid_reservation_gcash) : 0;

  const advCash = totals ? toNumber(totals.advance_cash) : 0;
  const advGcash = totals ? toNumber(totals.advance_gcash) : 0;

  const dpCash = totals ? toNumber(totals.walkin_cash) : 0;
  const dpGcash = totals ? toNumber(totals.walkin_gcash) : 0;

  const startingCash = report ? toNumber(report.starting_cash) : 0;
  const startingGcash = report ? toNumber(report.starting_gcash) : 0;

  const addons = addonsPaid;
  const discount = discountPaid;

  const bilin = report ? toNumber(report.bilin_amount) : 0;

  /**
   * ✅ Actual System (your existing)
   */
  const salesSystem = cohCash + cohGcash + paidResCash + advCash + dpCash - (startingCash + startingGcash);

  /**
   * ✅ Sales System (computed)
   * add-ons + total time (PAID ONLY) + consignment NET - discount (PAID ONLY)
   * (total time includes PROMO now)
   */
  const salesSystemComputed = addons + totalTimeAmount + consignment.net - discount;

  /**
   * ✅ Sales Collected:
   */
  const salesCollectedDisplay = salesSystem - bilin;

  if (loading) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div className="ssr-loading">
            <IonSpinner />
            <IonText className="ssr-loading-text">Loading…</IonText>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const submitLabel = report?.is_submitted ? "DONE / UPDATE" : "DONE / SUBMIT";

  return (
    <IonPage>
      <IonHeader />
      <IonContent className="ion-padding ssr-page">
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((p) => ({ ...p, open: false }))}
        />

        {/* DATE + SUBMIT */}
        <IonCard className="ssr-card">
          <IonCardContent className="ssr-card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <IonItem lines="none" className="ssr-date-item">
                  <IonLabel position="stacked">Report Date (YYYY-MM-DD)</IonLabel>

                  <div className="ssr-date-inline">
                    <IonInput
                      className="ssr-date-input"
                      value={selectedDate}
                      placeholder="YYYY-MM-DD"
                      inputmode="numeric"
                      disabled={submitting}
                      onIonChange={(ev) => {
                        const v = valueToString(getDetailValue(ev)).trim();
                        if (isYMD(v)) setSelectedDate(v);
                        else if (v === "") setSelectedDate("");
                      }}
                      onIonBlur={() => {
                        if (!selectedDate) setSelectedDate(todayYMD());
                      }}
                    />

                    <IonButton className="ssr-cal-btn" fill="clear" disabled={submitting} onClick={() => setDatePickerOpen(true)}>
                      <IonIcon icon={calendarOutline} />
                    </IonButton>
                  </div>
                </IonItem>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  Status: <b>{report?.is_submitted ? "SUBMITTED (hidden view, overwrite on submit)" : "DRAFT"}</b>
                  {report?.submitted_at ? (
                    <span style={{ marginLeft: 8 }}>(last submit: {new Date(report.submitted_at).toLocaleString()})</span>
                  ) : null}
                </div>
              </div>

              <IonButton strong disabled={submitting || !report} onClick={() => void onSubmitDone()}>
                {submitting ? "Saving..." : submitLabel}
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        {/* Calendar Modal */}
        <IonModal isOpen={datePickerOpen} onDidDismiss={() => setDatePickerOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Select Date</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDatePickerOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <IonDatetime
              presentation="date"
              value={selectedDate || todayYMD()}
              onIonChange={(ev) => {
                const v = valueToString(getDetailValue(ev));
                const ymd = isoToYMD(v);
                setSelectedDate(ymd);
                setDatePickerOpen(false);
              }}
            />
          </IonContent>
        </IonModal>

        <IonGrid className="ssr-grid">
          <IonRow>
            {/* LEFT */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <div className="ssr-left-head">
                    <div className="ssr-left-title">CATEGORY</div>
                    <div className="ssr-left-cols">
                      <span className="ssr-left-col">CASH</span>
                      <span className="ssr-left-col">GCASH</span>
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Starting Balance</div>

                    <div className="ssr-left-cell">
                      <IonItem lines="none" className="ssr-input-item">
                        <IonLabel position="stacked">Cash</IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_cash)) : "0"}
                          onIonChange={(ev) => updateReportField("starting_cash", valueToNonNegMoney(getDetailValue(ev)))}
                        />
                      </IonItem>
                    </div>

                    <div className="ssr-left-cell">
                      <IonItem lines="none" className="ssr-input-item">
                        <IonLabel position="stacked">GCash</IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_gcash)) : "0"}
                          onIonChange={(ev) => updateReportField("starting_gcash", valueToNonNegMoney(getDetailValue(ev)))}
                        />
                      </IonItem>
                    </div>
                  </div>

                  {/* COH */}
                  <div className="ssr-left-row">
                    <div className="ssr-left-label">COH / Total of the Day</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cohCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(cohGcash)}</div>
                  </div>

                  {/* ✅ CASH OUTS SPLIT */}
                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Cash Outs</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cashOutsCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(cashOutsGcash)}</div>
                  </div>

                  {/* Paid reservations */}
                  <div className="ssr-left-row ssr-left-row--tint">
                    <div className="ssr-left-label">Paid reservations for this date</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(paidResCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(paidResGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">New Advance Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(advCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(advGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Down payments within this date only</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(dpCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(dpGcash)}</div>
                  </div>

                  {/* Actual + Computed */}
                  <div className="ssr-system-grid">
                    <div className="ssr-system-box">
                      <div className="ssr-system-label">Actual System</div>
                      <div className="ssr-system-value">{peso(salesSystem)}</div>
                    </div>

                    <div className="ssr-system-box">
                      <div className="ssr-system-label">Sales System</div>
                      <div className="ssr-system-value">{peso(salesSystemComputed)}</div>
                    </div>
                  </div>

                  <div className="ssr-sales-boxes">
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Cash Sales</span>
                      <span className="ssr-sales-box-value">{peso(cashSales)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">GCash Sales</span>
                      <span className="ssr-sales-box-value">{peso(gcashSales)}</span>
                    </div>
                  </div>

                  {/* ✅ SAME AS ADMIN: show consignment + inventory loss */}
                  <div className="ssr-sales-boxes" style={{ marginTop: 10 }}>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment Sales</span>
                      <span className="ssr-sales-box-value">{peso(consignment.net)}</span>
                    </div>

                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Inventory Loss</span>
                      <span className="ssr-sales-box-value">{peso(inventoryLossAmount)}</span>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>

            {/* RIGHT */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <div className="ssr-card-head">
                    <IonText className="ssr-card-title">Cash Count</IonText>
                    <div className="ssr-total-chip">
                      Cash: <b>{peso(cashTotal)}</b> | Coins: <b>{peso(coinTotal)}</b>
                    </div>
                  </div>

                  <div className="ssr-cash-table">
                    <div className="ssr-cash-head">
                      <div className="ssr-ch">CASH</div>
                      <div className="ssr-ch ssr-ch--center">QTY</div>
                      <div className="ssr-ch ssr-ch--right">AMOUNT</div>
                    </div>

                    {lines
                      .filter((x) => x.money_kind === "cash")
                      .map((line) => {
                        const amount = line.denomination * line.qty;
                        return (
                          <div className="ssr-cash-row" key={`cash-${line.denomination}`}>
                            <div className="ssr-cd">{line.denomination}</div>
                            <div className="ssr-cq">
                              <IonInput
                                className="ssr-qty-input"
                                type="number"
                                inputmode="numeric"
                                disabled={submitting}
                                value={String(line.qty)}
                                onIonChange={(ev) => upsertQty(line, valueToNonNegInt(getDetailValue(ev)))}
                              />
                            </div>
                            <div className="ssr-ca">{peso(amount)}</div>
                          </div>
                        );
                      })}

                    <div className="ssr-cash-footer">
                      <div className="ssr-cash-footer-left">TOTAL CASH</div>
                      <div className="ssr-cash-footer-right">{peso(cashTotal)}</div>
                    </div>
                  </div>

                  <div className="ssr-coins-table">
                    <div className="ssr-cash-head">
                      <div className="ssr-ch">COINS</div>
                      <div className="ssr-ch ssr-ch--center">QTY</div>
                      <div className="ssr-ch ssr-ch--right">AMOUNT</div>
                    </div>

                    {lines
                      .filter((x) => x.money_kind === "coin")
                      .map((line) => {
                        const amount = line.denomination * line.qty;
                        return (
                          <div className="ssr-cash-row" key={`coin-${line.denomination}`}>
                            <div className="ssr-cd">{line.denomination}</div>
                            <div className="ssr-cq">
                              <IonInput
                                className="ssr-qty-input"
                                type="number"
                                inputmode="numeric"
                                disabled={submitting}
                                value={String(line.qty)}
                                onIonChange={(ev) => upsertQty(line, valueToNonNegInt(getDetailValue(ev)))}
                              />
                            </div>
                            <div className="ssr-ca">{peso(amount)}</div>
                          </div>
                        );
                      })}

                    <div className="ssr-cash-footer">
                      <div className="ssr-cash-footer-left">TOTAL COINS</div>
                      <div className="ssr-cash-footer-right">{peso(coinTotal)}</div>
                    </div>

                    <div className="ssr-coh-bar">
                      <span>COH / Total of the Day</span>
                      <b>{peso(cohCash)}</b>
                    </div>
                  </div>

                  <div className="ssr-collected-wrap">
                    <div className="ssr-collected-box ssr-collected-box--bilin">
                      <div className="ssr-collected-label">Bilin</div>
                      <IonInput
                        className="ssr-bilin-input"
                        type="number"
                        inputmode="decimal"
                        disabled={submitting}
                        value={report ? String(toNumber(report.bilin_amount)) : "0"}
                        onIonChange={(ev) => updateReportField("bilin_amount", valueToNonNegMoney(getDetailValue(ev)))}
                      />
                    </div>

                    <div className="ssr-collected-box ssr-collected-box--net">
                      <div className="ssr-collected-label">Sales Collected</div>
                      <div className="ssr-collected-value">{peso(salesCollectedDisplay)}</div>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>

              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <IonText className="ssr-card-title">Other Totals</IonText>

                  <div className="ssr-mini">
                    <div className="ssr-mini-row">
                      <span>Add-ons (Paid)</span>
                      <b>{peso(addonsPaid)}</b>
                    </div>

                    <div className="ssr-mini-row">
                      <span>Discount (amount)</span>
                      <b>{peso(discountPaid)}</b>
                    </div>

                    <div className="ssr-mini-row">
                      <span>Total Time</span>
                      <b>{peso(totalTimeAmount)}</b>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};

export default StaffSalesReport;
