// src/pages/Admin_Sales_Report.tsx
// ✅ STRICT TS, NO any
// ✅ Admin now matches latest Staff logic
// ✅ Actual System = Total Payment Collections - Starting Balance
// ✅ Payment breakdown rows added
// ✅ Total Time = Walk-in system paid + Reservation time only
// ✅ Promo REMOVED from Total Time
// ✅ Discount = Walk-in + Reservation + Promo discount
// ✅ Add-ons (Paid) = customer_session_add_ons + customer_order_payments
// ✅ Keeps Consignment Sales + Consignment 15% + Consignment Net
// ✅ PDF + Excel updated

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
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
  IonAlert,
} from "@ionic/react";
import {
  calendarOutline,
  closeOutline,
  downloadOutline,
  trashOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

/* =========================
   PRICING
========================= */

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

/* =========================
   TYPES
========================= */

type MoneyKind = "cash" | "coin";
type CashOutMethod = "cash" | "gcash";
type DiscountKind = "none" | "percent" | "amount";

interface DailyReportRow {
  id: string;
  report_date: string;
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

type AddOnPaymentRow = {
  created_at: string;
  full_name: string;
  seat_number: string;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
};

type CustomerOrderPaymentRow = {
  paid_at: string | null;
  is_paid: boolean | number | string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
};

type WalkinSystemPaidRow = {
  paid_at: string | null;
  is_paid: boolean | number | string | null;
  reservation: string | null;
  total_amount: number | string | null;
  discount_kind?: DiscountKind | null;
  discount_value?: number | string | null;
};

type ReservationForTimeRow = {
  reservation_date: string | null;
  time_started: string | null;
  time_ended: string | null;
  hour_avail: string | null;
  is_paid: boolean | null;
  discount_kind: string | null;
  discount_value: number | string | null;
};

type ReservationPaymentPlacementRow = {
  paid_at: string | null;
  is_paid: boolean | number | string | null;
  reservation_date: string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
};

type AddOnExpenseRow = {
  created_at: string;
  expense_type: string;
  expense_amount: number | string | null;
  voided: boolean | null;
};

type PromoPaymentRow = {
  paid_at: string | null;
  is_paid: boolean | number | string | null;
  start_at: string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
};

type PromoDiscountRow = {
  paid_at: string | null;
  is_paid: boolean | number | string | null;
  price: number | string | null;
  discount_kind: string | null;
  discount_value: number | string | null;
};

/* =========================
   CONSTANTS
========================= */

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50];
const COIN_DENOMS: number[] = [20, 10, 5, 1];
const GROUP_WINDOW_MS = 10_000;

/* =========================
   HELPERS
========================= */

const toNumber = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number =>
  Number((Number.isFinite(n) ? n : 0).toFixed(2));

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const applyDiscountToBase = (
  baseCost: number,
  kind: DiscountKind,
  value: number
): number => {
  const cost = Math.max(0, round2(baseCost));
  const v = Math.max(0, round2(value));

  if (kind === "percent") {
    const pct = clamp(v, 0, 100);
    return Math.max(0, round2(cost - (cost * pct) / 100));
  }

  if (kind === "amount") {
    return Math.max(0, round2(cost - v));
  }

  return cost;
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

const todayYMD = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const isYMD = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

const isoToYMD = (iso: string): string => {
  const raw = iso.trim();
  if (!raw) return todayYMD();
  const ymd = raw.slice(0, 10);
  return isYMD(ymd) ? ymd : todayYMD();
};

const isoToLocalYMD = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return todayYMD();

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const manilaDayRange = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const start = new Date(`${yyyyMmDd}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase();

const buildZeroLines = (reportId: string): CashLine[] => {
  const merged: CashLine[] = [];
  for (const d of CASH_DENOMS) {
    merged.push({ report_id: reportId, money_kind: "cash", denomination: d, qty: 0 });
  }
  for (const d of COIN_DENOMS) {
    merged.push({ report_id: reportId, money_kind: "coin", denomination: d, qty: 0 });
  }
  return merged;
};

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

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

    const startNew =
      !started ||
      name !== curName ||
      seat !== curSeat ||
      Math.abs(t - curLast) > GROUP_WINDOW_MS;

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

  return round2(total);
};

const isOpenTimeSession = (
  hourAvail: string | null | undefined,
  timeEnded: string | null | undefined
): boolean => {
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

/* =========================
   PAGE
========================= */

const AdminSalesReport: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(() => todayYMD());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);

  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  const [consignment, setConsignment] = useState<ConsignmentState>({
    gross: 0,
    fee15: 0,
    net: 0,
  });

  const [addonsPaidBase, setAddonsPaidBase] = useState<number>(0);
  const [customerOrderPaid, setCustomerOrderPaid] = useState<number>(0);
  const [walkinSystemPaid, setWalkinSystemPaid] = useState<number>(0);
  const [reservationTimeBase, setReservationTimeBase] = useState<number>(0);

  const [reservationDownCash, setReservationDownCash] = useState<number>(0);
  const [reservationDownGcash, setReservationDownGcash] = useState<number>(0);
  const [reservationAdvanceCash, setReservationAdvanceCash] = useState<number>(0);
  const [reservationAdvanceGcash, setReservationAdvanceGcash] = useState<number>(0);

  const [promoTodayCash, setPromoTodayCash] = useState<number>(0);
  const [promoTodayGcash, setPromoTodayGcash] = useState<number>(0);
  const [promoAdvanceCash, setPromoAdvanceCash] = useState<number>(0);
  const [promoAdvanceGcash, setPromoAdvanceGcash] = useState<number>(0);

  const [cashOutsCash, setCashOutsCash] = useState<number>(0);
  const [cashOutsGcash, setCashOutsGcash] = useState<number>(0);

  const [walkinDiscountAmount, setWalkinDiscountAmount] = useState<number>(0);
  const [reservationDiscountAmount, setReservationDiscountAmount] = useState<number>(0);
  const [promoDiscountAmount, setPromoDiscountAmount] = useState<number>(0);
  const [inventoryLossAmount, setInventoryLossAmount] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; color?: string }>(() => ({
    open: false,
    msg: "",
    color: "success",
  }));

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);

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
      console.error("daily_sales_reports ensure(upsert) error:", upsertRes.error.message);
    }
  };

  const resetAll = (): void => {
    setReport(null);
    setLines([]);
    setTotals(null);
    setConsignment({ gross: 0, fee15: 0, net: 0 });

    setAddonsPaidBase(0);
    setCustomerOrderPaid(0);
    setWalkinSystemPaid(0);
    setReservationTimeBase(0);

    setReservationDownCash(0);
    setReservationDownGcash(0);
    setReservationAdvanceCash(0);
    setReservationAdvanceGcash(0);

    setPromoTodayCash(0);
    setPromoTodayGcash(0);
    setPromoAdvanceCash(0);
    setPromoAdvanceGcash(0);

    setCashOutsCash(0);
    setCashOutsGcash(0);

    setWalkinDiscountAmount(0);
    setReservationDiscountAmount(0);
    setPromoDiscountAmount(0);
    setInventoryLossAmount(0);
  };

  const loadReport = async (dateYMD: string): Promise<void> => {
    setLoading(true);

    if (!isYMD(dateYMD)) {
      resetAll();
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
      console.error("daily_sales_reports select error:", res.error.message);
      resetAll();
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
      console.error("daily_cash_count_lines select error:", res.error.message);
      setLines(buildZeroLines(reportId));
      return;
    }

    const rows: CashCountDBRow[] = (res.data ?? []) as CashCountDBRow[];
    const merged: CashLine[] = [];

    for (const d of CASH_DENOMS) {
      const found = rows.find(
        (r) => r.money_kind === "cash" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "cash",
        denomination: d,
        qty: found?.qty ?? 0,
      });
    }

    for (const d of COIN_DENOMS) {
      const found = rows.find(
        (r) => r.money_kind === "coin" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "coin",
        denomination: d,
        qty: found?.qty ?? 0,
      });
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
      console.error("v_daily_sales_report_totals error:", res.error.message);
      setTotals(null);
      return;
    }

    setTotals(res.data);
  };

  const loadConsignment = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    const res = await supabase.rpc("get_consignment_totals_for_day", { p_date: dateYMD });

    if (res.error) {
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

  const loadInventoryLossAmount = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setInventoryLossAmount(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("add_on_expenses")
      .select("created_at, expense_type, expense_amount, voided")
      .eq("expense_type", "inventory_loss")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    if (res.error) {
      console.error("inventory loss query error:", res.error.message);
      const fallback = totals ? toNumber(totals.expenses_amount) : 0;
      setInventoryLossAmount(round2(fallback));
      return;
    }

    const rows = (res.data ?? []) as AddOnExpenseRow[];
    const sum = rows
      .filter((r) => !r.voided)
      .reduce((acc, r) => acc + Math.max(0, toNumber(r.expense_amount)), 0);

    setInventoryLossAmount(round2(sum));
  };

  const loadAddonsPaidBase = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setAddonsPaidBase(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("customer_session_add_ons")
      .select("created_at, full_name, seat_number, gcash_amount, cash_amount")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    if (res.error) {
      console.error("addonsPaid(payment) query error:", res.error.message);
      setAddonsPaidBase(0);
      return;
    }

    const rows = (res.data ?? []) as AddOnPaymentRow[];
    const onlyWithAnyPayment = rows.filter(
      (r) => toNumber(r.gcash_amount) > 0 || toNumber(r.cash_amount) > 0
    );

    setAddonsPaidBase(computeAddonsPaidFromPayments(onlyWithAnyPayment));
  };

  const loadCustomerOrderPaid = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setCustomerOrderPaid(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("customer_order_payments")
      .select("paid_at, is_paid, gcash_amount, cash_amount")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso);

    if (res.error) {
      console.error("customer_order_payments query error:", res.error.message);
      setCustomerOrderPaid(0);
      return;
    }

    const rows = (res.data ?? []) as CustomerOrderPaymentRow[];

    const total = rows
      .filter((r) => toBool(r.is_paid) && !!r.paid_at)
      .reduce(
        (sum, r) =>
          sum +
          Math.max(0, toNumber(r.gcash_amount)) +
          Math.max(0, toNumber(r.cash_amount)),
        0
      );

    setCustomerOrderPaid(round2(total));
  };

  const loadReservationPaymentPlacement = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setReservationDownCash(0);
      setReservationDownGcash(0);
      setReservationAdvanceCash(0);
      setReservationAdvanceGcash(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("customer_sessions")
      .select("paid_at, is_paid, reservation_date, gcash_amount, cash_amount")
      .eq("reservation", "yes")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso);

    if (res.error) {
      console.error("reservation payment placement query error:", res.error.message);
      setReservationDownCash(0);
      setReservationDownGcash(0);
      setReservationAdvanceCash(0);
      setReservationAdvanceGcash(0);
      return;
    }

    const rows = (res.data ?? []) as ReservationPaymentPlacementRow[];

    let todayCash = 0;
    let todayGcash = 0;
    let advanceCash = 0;
    let advanceGcash = 0;

    for (const r of rows) {
      if (!toBool(r.is_paid) || !r.paid_at) continue;

      const reservationYMD = String(r.reservation_date ?? "").trim();
      const cash = Math.max(0, toNumber(r.cash_amount));
      const gcash = Math.max(0, toNumber(r.gcash_amount));

      if (reservationYMD === dateYMD) {
        todayCash += cash;
        todayGcash += gcash;
      } else if (reservationYMD > dateYMD) {
        advanceCash += cash;
        advanceGcash += gcash;
      }
    }

    setReservationDownCash(round2(todayCash));
    setReservationDownGcash(round2(todayGcash));
    setReservationAdvanceCash(round2(advanceCash));
    setReservationAdvanceGcash(round2(advanceGcash));
  };

  const loadPromoPaymentPlacement = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setPromoTodayCash(0);
      setPromoTodayGcash(0);
      setPromoAdvanceCash(0);
      setPromoAdvanceGcash(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("promo_bookings")
      .select("paid_at, is_paid, start_at, gcash_amount, cash_amount")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso);

    if (res.error) {
      console.error("promo payment placement query error:", res.error.message);
      setPromoTodayCash(0);
      setPromoTodayGcash(0);
      setPromoAdvanceCash(0);
      setPromoAdvanceGcash(0);
      return;
    }

    const rows = (res.data ?? []) as PromoPaymentRow[];

    let todayCash = 0;
    let todayGcash = 0;
    let advanceCash = 0;
    let advanceGcash = 0;

    for (const r of rows) {
      if (!toBool(r.is_paid) || !r.paid_at) continue;

      const availYMD = r.start_at ? isoToLocalYMD(r.start_at) : "";
      const cash = Math.max(0, toNumber(r.cash_amount));
      const gcash = Math.max(0, toNumber(r.gcash_amount));

      if (availYMD === dateYMD) {
        todayCash += cash;
        todayGcash += gcash;
      } else if (availYMD > dateYMD) {
        advanceCash += cash;
        advanceGcash += gcash;
      }
    }

    setPromoTodayCash(round2(todayCash));
    setPromoTodayGcash(round2(todayGcash));
    setPromoAdvanceCash(round2(advanceCash));
    setPromoAdvanceGcash(round2(advanceGcash));
  };

  const loadWalkinSystemPaidAndDiscount = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setWalkinSystemPaid(0);
      setWalkinDiscountAmount(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("customer_sessions")
      .select("paid_at, is_paid, reservation, total_amount, discount_kind, discount_value")
      .eq("reservation", "no")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso);

    if (res.error) {
      console.error("walkin system paid query error:", res.error.message);
      setWalkinSystemPaid(0);
      setWalkinDiscountAmount(0);
      return;
    }

    const rows = (res.data ?? []) as WalkinSystemPaidRow[];

    let systemSum = 0;
    let discountSum = 0;

    for (const r of rows) {
      if (!toBool(r.is_paid) || !r.paid_at) continue;

      const base = Math.max(0, toNumber(r.total_amount));
      const kind = (r.discount_kind ?? "none") as DiscountKind;
      const value = Math.max(0, toNumber(r.discount_value));

      const discountAmt = computeDiscountAmountFromBaseCost(base, kind, value);
      const finalSystemCost = applyDiscountToBase(base, kind, value);

      systemSum += finalSystemCost;
      discountSum += discountAmt;
    }

    setWalkinSystemPaid(round2(systemSum));
    setWalkinDiscountAmount(round2(discountSum));
  };

  const loadReservationTimeAndDiscount = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setReservationTimeBase(0);
      setReservationDiscountAmount(0);
      return;
    }

    const nowIso = new Date().toISOString();

    const res = await supabase
      .from("customer_sessions")
      .select("reservation_date, time_started, time_ended, hour_avail, is_paid, discount_kind, discount_value")
      .eq("reservation", "yes")
      .eq("reservation_date", dateYMD)
      .eq("is_paid", true);

    if (res.error) {
      console.error("reservation time query error:", res.error.message);
      setReservationTimeBase(0);
      setReservationDiscountAmount(0);
      return;
    }

    const rows = (res.data ?? []) as ReservationForTimeRow[];

    let timeSum = 0;
    let discountSum = 0;

    for (const s of rows) {
      if (!s.is_paid) continue;

      const startIso = String(s.time_started ?? "").trim();
      if (!startIso) continue;

      const open = isOpenTimeSession(s.hour_avail, s.time_ended);
      const endIso = open ? nowIso : String(s.time_ended ?? "").trim();
      if (!endIso) continue;

      const baseCost = computeCostWithFreeMinutes(startIso, endIso);
      timeSum += baseCost;

      const dAmt = computeDiscountAmountFromBaseCost(
        baseCost,
        s.discount_kind,
        s.discount_value
      );
      discountSum += dAmt;
    }

    setReservationTimeBase(round2(timeSum));
    setReservationDiscountAmount(round2(discountSum));
  };

  const loadPromoDiscountAmount = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setPromoDiscountAmount(0);
      return;
    }

    const { startIso, endIso } = manilaDayRange(dateYMD);

    const res = await supabase
      .from("promo_bookings")
      .select("paid_at, is_paid, price, discount_kind, discount_value")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso);

    if (res.error) {
      console.error("promo discount query error:", res.error.message);
      setPromoDiscountAmount(0);
      return;
    }

    const rows = (res.data ?? []) as PromoDiscountRow[];

    let discountSum = 0;

    for (const row of rows) {
      if (!toBool(row.is_paid) || !row.paid_at) continue;

      const base = Math.max(0, toNumber(row.price));
      const dAmt = computeDiscountAmountFromBaseCost(
        base,
        row.discount_kind,
        row.discount_value
      );

      discountSum += dAmt;
    }

    setPromoDiscountAmount(round2(discountSum));
  };

  const loadCashOutsTotal = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setCashOutsCash(0);
      setCashOutsGcash(0);
      return;
    }

    const res = await supabase
      .from("cash_outs")
      .select("amount, cashout_date, payment_method")
      .eq("cashout_date", dateYMD);

    if (res.error) {
      const fallback = await supabase
        .from("cash_outs")
        .select("amount, cashout_date")
        .eq("cashout_date", dateYMD);

      if (fallback.error) {
        console.error("cash_outs query error:", fallback.error.message);
        setCashOutsCash(0);
        setCashOutsGcash(0);
        return;
      }

      const rows = (fallback.data ?? []) as Array<{ amount: number | string | null }>;
      const total = rows.reduce((sum, r) => sum + toNumber(r.amount), 0);
      setCashOutsCash(round2(total));
      setCashOutsGcash(0);
      return;
    }

    const rows = (res.data ?? []) as Array<{
      amount: number | string | null;
      payment_method?: CashOutMethod | null;
    }>;

    const cash = rows
      .filter((r) => (r.payment_method ?? "cash") === "cash")
      .reduce((sum, r) => sum + toNumber(r.amount), 0);

    const gcash = rows
      .filter((r) => (r.payment_method ?? "cash") === "gcash")
      .reduce((sum, r) => sum + toNumber(r.amount), 0);

    setCashOutsCash(round2(cash));
    setCashOutsGcash(round2(gcash));
  };

  const upsertQty = async (line: CashLine, qty: number): Promise<void> => {
    if (!report || submitting) return;

    const res = await supabase
      .from("daily_cash_count_lines")
      .upsert(
        {
          report_id: line.report_id,
          money_kind: line.money_kind,
          denomination: line.denomination,
          qty,
        },
        { onConflict: "report_id,money_kind,denomination" }
      );

    if (res.error) {
      console.error("daily_cash_count_lines upsert error:", res.error.message);
      return;
    }

    setLines((prev) =>
      prev.map((x) =>
        x.money_kind === line.money_kind && x.denomination === line.denomination
          ? { ...x, qty }
          : x
      )
    );
    await loadTotals(selectedDate);
  };

  const updateReportField = async (
    field: "starting_cash" | "starting_gcash" | "bilin_amount",
    valueNum: number
  ): Promise<void> => {
    if (!report || submitting) return;

    const safe = Math.max(0, valueNum);
    const res = await supabase
      .from("daily_sales_reports")
      .update({ [field]: safe })
      .eq("id", report.id);

    if (res.error) {
      console.error("daily_sales_reports update error:", res.error.message);
      return;
    }

    setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
    await loadTotals(selectedDate);
  };

  /* =========================
     ADMIN SAVE / UPDATE
  ========================= */

  const reloadEverything = async (): Promise<void> => {
    await loadReport(selectedDate);
    await loadTotals(selectedDate);
    await loadConsignment(selectedDate);
    await loadAddonsPaidBase(selectedDate);
    await loadCustomerOrderPaid(selectedDate);
    await loadReservationPaymentPlacement(selectedDate);
    await loadPromoPaymentPlacement(selectedDate);
    await loadWalkinSystemPaidAndDiscount(selectedDate);
    await loadReservationTimeAndDiscount(selectedDate);
    await loadPromoDiscountAmount(selectedDate);
    await loadCashOutsTotal(selectedDate);
    await loadInventoryLossAmount(selectedDate);
  };

  const onSubmitDone = async (): Promise<void> => {
    if (!report) return;

    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date. Use YYYY-MM-DD.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const r1 = await supabase
      .from("daily_sales_reports")
      .update({
        starting_cash: Math.max(0, toNumber(report.starting_cash)),
        starting_gcash: Math.max(0, toNumber(report.starting_gcash)),
        bilin_amount: Math.max(0, toNumber(report.bilin_amount)),
      })
      .eq("id", report.id);

    if (r1.error) {
      setToast({ open: true, msg: `Save failed: ${r1.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

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

      if (r2.error) {
        setToast({ open: true, msg: `Save lines failed: ${r2.error.message}`, color: "danger" });
        setSubmitting(false);
        return;
      }
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

    await reloadEverything();

    setToast({ open: true, msg: `Saved for ${selectedDate}.`, color: "success" });
    setSubmitting(false);
  };

  /* =========================
     DELETE BY DATE
  ========================= */

  const deleteByDate = async (): Promise<void> => {
    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const find = await supabase
      .from("daily_sales_reports")
      .select("id")
      .eq("report_date", selectedDate)
      .maybeSingle<{ id: string }>();

    if (find.error) {
      setToast({ open: true, msg: `Delete failed: ${find.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const reportId = find.data?.id;
    if (!reportId) {
      setToast({ open: true, msg: "No report found for that date.", color: "warning" });
      setSubmitting(false);
      return;
    }

    const d1 = await supabase.from("daily_cash_count_lines").delete().eq("report_id", reportId);
    if (d1.error) {
      setToast({ open: true, msg: `Delete lines failed: ${d1.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const d2 = await supabase.from("daily_sales_reports").delete().eq("id", reportId);
    if (d2.error) {
      setToast({ open: true, msg: `Delete report failed: ${d2.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    setToast({ open: true, msg: `Deleted report for ${selectedDate}.`, color: "success" });
    await reloadEverything();
    setSubmitting(false);
  };

  /* =========================
     COMPUTED
  ========================= */

  const cashTotal = useMemo(() => {
    return lines
      .filter((l) => l.money_kind === "cash")
      .reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const coinTotal = useMemo(() => {
    return lines
      .filter((l) => l.money_kind === "coin")
      .reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;

  const cohCash = cashTotal + coinTotal;
  const cohGcash = gcashSales;

  const walkinPaymentCash = totals ? toNumber(totals.walkin_cash) : 0;
  const walkinPaymentGcash = totals ? toNumber(totals.walkin_gcash) : 0;

  const totalPaymentCash = round2(
    walkinPaymentCash +
      reservationDownCash +
      reservationAdvanceCash +
      promoTodayCash +
      promoAdvanceCash
  );

  const totalPaymentGcash = round2(
    walkinPaymentGcash +
      reservationDownGcash +
      reservationAdvanceGcash +
      promoTodayGcash +
      promoAdvanceGcash
  );

  const startingCash = report ? toNumber(report.starting_cash) : 0;
  const startingGcash = report ? toNumber(report.starting_gcash) : 0;

  const addonsTotalWithCustomerOrders = round2(addonsPaidBase + customerOrderPaid);
  const totalTimeAmount = round2(walkinSystemPaid + reservationTimeBase);

  const discount = round2(
    walkinDiscountAmount + reservationDiscountAmount + promoDiscountAmount
  );

  const bilin = report ? toNumber(report.bilin_amount) : 0;

  const actualSystem = round2(
    (totalPaymentCash + totalPaymentGcash) - (startingCash + startingGcash)
  );

  const salesSystemComputed = round2(
    addonsTotalWithCustomerOrders + totalTimeAmount + consignment.net - discount
  );

  const salesCollectedDisplay = round2(actualSystem - bilin);

  /* =========================
     EXPORT PDF
  ========================= */

const exportToPDF = (): void => {
  if (!report || !isYMD(selectedDate)) {
    setToast({ open: true, msg: "Pick a valid date first.", color: "danger" });
    return;
  }

  const cashLines = lines.filter((x) => x.money_kind === "cash");
  const coinLines = lines.filter((x) => x.money_kind === "coin");

  const cashTotalLocal = cashLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);
  const coinTotalLocal = coinLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);

  const cohCashLocal = cashTotalLocal + coinTotalLocal;
  const cohGcashLocal = gcashSales;

  const startingCashLocal = toNumber(report.starting_cash);
  const startingGcashLocal = toNumber(report.starting_gcash);
  const bilinLocal = toNumber(report.bilin_amount);

  const paymentRowsHtml = `
    <tr><td>Walk-in Payments</td><td class="num">${peso(walkinPaymentCash)}</td><td class="num">${peso(walkinPaymentGcash)}</td></tr>
    <tr><td>Reservation Payments (Same Day)</td><td class="num">${peso(reservationDownCash)}</td><td class="num">${peso(reservationDownGcash)}</td></tr>
    <tr><td>Reservation Advance Payments</td><td class="num">${peso(reservationAdvanceCash)}</td><td class="num">${peso(reservationAdvanceGcash)}</td></tr>
    <tr><td>Promo Payments (Same Day)</td><td class="num">${peso(promoTodayCash)}</td><td class="num">${peso(promoTodayGcash)}</td></tr>
    <tr><td>Promo Advance Payments</td><td class="num">${peso(promoAdvanceCash)}</td><td class="num">${peso(promoAdvanceGcash)}</td></tr>
    <tr class="grand-row"><td>Total Payment Collections</td><td class="num">${peso(totalPaymentCash)}</td><td class="num">${peso(totalPaymentGcash)}</td></tr>
  `;

  const cashCountRowsHtml = [
    ...cashLines.map(
      (l) => `
      <tr>
        <td>CASH</td>
        <td class="center">${l.denomination}</td>
        <td class="center">${l.qty}</td>
        <td class="num">${peso(l.denomination * l.qty)}</td>
      </tr>`
    ),
    ...coinLines.map(
      (l) => `
      <tr>
        <td>COIN</td>
        <td class="center">${l.denomination}</td>
        <td class="center">${l.qty}</td>
        <td class="num">${peso(l.denomination * l.qty)}</td>
      </tr>`
    ),
  ].join("");

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Metyme LOUNGE Daily Sales Report ${selectedDate}</title>
<style>
  @page {
    size: 8.5in 13in;
    margin: 8mm;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: "Segoe UI", Arial, sans-serif;
    background: #f6f1e7;
    color: #2c2418;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 100%;
  }

  .hero {
    background: linear-gradient(135deg, #6f8f6b, #9bb48f);
    color: white;
    border-radius: 14px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }

  .hero-title {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.2px;
    margin: 0 0 4px;
  }

  .hero-sub {
    font-size: 11px;
    opacity: 0.95;
    margin: 0;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-top: 10px;
  }

  .meta-card {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 10px;
    padding: 8px 10px;
  }

  .meta-label {
    font-size: 9px;
    text-transform: uppercase;
    opacity: 0.85;
    margin-bottom: 2px;
  }

  .meta-value {
    font-size: 11px;
    font-weight: 700;
  }

  .mini-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 10px;
  }

  .mini-box {
    background: #f8f2e6;
    border: 1px solid #e6d8bb;
    border-radius: 10px;
    padding: 8px 10px;
  }

  .mini-label {
    font-size: 9px;
    color: #7a694a;
    margin-bottom: 3px;
    text-transform: uppercase;
  }

  .mini-value {
    font-size: 15px;
    font-weight: 800;
    color: #3d3220;
  }

  .grid {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 10px;
  }

  .card {
    background: #fffaf0;
    border: 1px solid #e5d8bf;
    border-radius: 12px;
    padding: 10px;
    margin-bottom: 10px;
    box-shadow: 0 4px 10px rgba(80, 62, 31, 0.05);
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .card-title {
    font-size: 12px;
    font-weight: 800;
    color: #5a4a2f;
    margin: 0 0 8px;
    padding-bottom: 5px;
    border-bottom: 2px solid #eadfc9;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }

  th {
    background: #efe1c6;
    color: #4c3d25;
    padding: 6px 7px;
    text-align: left;
    border-bottom: 1px solid #d8c7a6;
  }

  td {
    padding: 5px 7px;
    border-bottom: 1px solid #eee3cf;
    vertical-align: middle;
  }

  tr:nth-child(even) td {
    background: #fffdf8;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .center {
    text-align: center;
  }

  .grand-row td {
    background: #e5efd9 !important;
    font-weight: 800;
    color: #314126;
  }

  .summary-list {
    display: grid;
    gap: 6px;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
    background: #fcf7ee;
    border: 1px solid #ebdec6;
    border-radius: 9px;
    font-size: 10px;
  }

  .summary-row b {
    font-size: 11px;
  }

  .footer-note {
    margin-top: 6px;
    text-align: right;
    font-size: 9px;
    color: #7d7059;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div class="hero-title">Metyme LOUNGE Daily Sales Report</div>
      <p class="hero-sub">Clean summary of payments, sales, cash count, and totals</p>

      <div class="meta-grid">
        <div class="meta-card">
          <div class="meta-label">Report Date</div>
          <div class="meta-value">${selectedDate}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Status</div>
          <div class="meta-value">${report.is_submitted ? "SUBMITTED" : "DRAFT"}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Submitted At</div>
          <div class="meta-value">${
            report.submitted_at ? new Date(report.submitted_at).toLocaleString() : "-"
          }</div>
        </div>
      </div>
    </div>

    <div class="mini-grid" style="margin-bottom:14px;">
      <div class="mini-box">
        <div class="mini-label">Actual System</div>
        <div class="mini-value">${peso(actualSystem)}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">Sales Collected</div>
        <div class="mini-value">${peso(salesCollectedDisplay)}</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="card">
          <div class="card-title">Category Summary</div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Cash</th>
                <th>GCash</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Starting Balance</td><td class="num">${peso(startingCashLocal)}</td><td class="num">${peso(startingGcashLocal)}</td></tr>
              <tr><td>COH / Total of the Day</td><td class="num">${peso(cohCashLocal)}</td><td class="num">${peso(cohGcashLocal)}</td></tr>
              <tr><td>Cash Outs</td><td class="num">${peso(cashOutsCash)}</td><td class="num">${peso(cashOutsGcash)}</td></tr>
              ${paymentRowsHtml}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Other Totals</div>
          <div class="summary-list">
            <div class="summary-row"><span>Add-ons (Paid)</span><b>${peso(addonsTotalWithCustomerOrders)}</b></div>
            <div class="summary-row"><span>Discount (Amount)</span><b>${peso(discount)}</b></div>
            <div class="summary-row"><span>Total Time</span><b>${peso(totalTimeAmount)}</b></div>
            <div class="summary-row"><span>Consignment Sales</span><b>${peso(consignment.gross)}</b></div>
            <div class="summary-row"><span>Consignment 15%</span><b>${peso(consignment.fee15)}</b></div>
            <div class="summary-row"><span>Consignment Net</span><b>${peso(consignment.net)}</b></div>
            <div class="summary-row"><span>Inventory Loss</span><b>${peso(inventoryLossAmount)}</b></div>
            <div class="summary-row"><span>Bilin</span><b>${peso(bilinLocal)}</b></div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Cash Count</div>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Denomination</th>
                <th>Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${cashCountRowsHtml}
              <tr class="grand-row">
                <td colspan="3">Total Cash</td>
                <td class="num">${peso(cashTotalLocal)}</td>
              </tr>
              <tr class="grand-row">
                <td colspan="3">Total Coins</td>
                <td class="num">${peso(coinTotalLocal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Sales Snapshot</div>
          <div class="summary-list">
            <div class="summary-row"><span>Cash Sales</span><b>${peso(cashSales)}</b></div>
            <div class="summary-row"><span>GCash Sales</span><b>${peso(gcashSales)}</b></div>
            <div class="summary-row"><span>Sales System / Total Cost</span><b>${peso(salesSystemComputed)}</b></div>
          </div>
        </div>
      </div>
    </div>
<script>
  window.onload = () => { window.print(); };
</script>
</body>
</html>
`;

    const w = window.open("", "_blank");
    if (!w) {
      setToast({
        open: true,
        msg: "Popup blocked. Allow popups then try again.",
        color: "danger",
      });
      return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();

    setToast({ open: true, msg: "Opened print view. Save as PDF.", color: "success" });
  };

  /* =========================
     EXPORT EXCEL
  ========================= */

const exportToExcel = async (): Promise<void> => {
  if (!report || !isYMD(selectedDate)) {
    setToast({ open: true, msg: "Pick a valid date first.", color: "danger" });
    return;
  }

  const cashLines = lines.filter((x) => x.money_kind === "cash");
  const coinLines = lines.filter((x) => x.money_kind === "coin");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Admin Sales Report", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  ws.properties.defaultRowHeight = 22;

  const titleFill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "6F8F6B" },
  };

  const sectionFill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "EADFC9" },
  };

  const totalFill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "E5EFD9" },
  };

  const cardFill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "FCF7EE" },
  };

  const thinBorder = {
    top: { style: "thin" as const, color: { argb: "D8C7A6" } },
    left: { style: "thin" as const, color: { argb: "D8C7A6" } },
    bottom: { style: "thin" as const, color: { argb: "D8C7A6" } },
    right: { style: "thin" as const, color: { argb: "D8C7A6" } },
  };

  ws.columns = [
    { width: 38 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = "Metyme LOUNGE Daily Sales Report";
  ws.getCell("A1").font = { size: 18, bold: true, color: { argb: "FFFFFF" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("A1").fill = titleFill;
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:D2");
  ws.getCell("A2").value = "Daily sales summary, collections, cash count, and totals";
  ws.getCell("A2").font = { size: 11, italic: true, color: { argb: "FFFFFF" } };
  ws.getCell("A2").alignment = { horizontal: "center" };
  ws.getCell("A2").fill = titleFill;

  ws.getCell("A4").value = "Report Date";
  ws.getCell("B4").value = selectedDate;
  ws.getCell("C4").value = "Status";
  ws.getCell("D4").value = report.is_submitted ? "SUBMITTED" : "DRAFT";

  ["A4", "B4", "C4", "D4"].forEach((addr) => {
    const c = ws.getCell(addr);
    c.border = thinBorder;
    c.fill = cardFill;
    c.font = { bold: true };
  });

  let row = 6;

  ws.mergeCells(`A${row}:D${row}`);
  ws.getCell(`A${row}`).value = "CATEGORY SUMMARY";
  ws.getCell(`A${row}`).fill = sectionFill;
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.getCell(`A${row}`).border = thinBorder;
  row++;

  ws.getRow(row).values = ["Category", "Cash", "GCash", ""];
  ws.getRow(row).font = { bold: true };
  ws.getRow(row).fill = sectionFill;
  ws.getRow(row).eachCell((c) => {
    c.border = thinBorder;
    c.alignment = { horizontal: "center" };
  });
  row++;

  const categoryRows: Array<[string, number, number]> = [
    ["Starting Balance", startingCash, startingGcash],
    ["COH / Total of the Day", cashTotal + coinTotal, gcashSales],
    ["Cash Outs", cashOutsCash, cashOutsGcash],
    ["Walk-in Payments", walkinPaymentCash, walkinPaymentGcash],
    ["Reservation Payments (Same Day)", reservationDownCash, reservationDownGcash],
    ["Reservation Advance Payments", reservationAdvanceCash, reservationAdvanceGcash],
    ["Promo Payments (Same Day)", promoTodayCash, promoTodayGcash],
    ["Promo Advance Payments", promoAdvanceCash, promoAdvanceGcash],
    ["Total Payment Collections", totalPaymentCash, totalPaymentGcash],
  ];

  for (const [label, cash, gcash] of categoryRows) {
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`B${row}`).value = cash;
    ws.getCell(`C${row}`).value = gcash;

    ["A", "B", "C"].forEach((col) => {
      ws.getCell(`${col}${row}`).border = thinBorder;
      ws.getCell(`${col}${row}`).fill =
        label === "Total Payment Collections" ? totalFill : cardFill;
    });

    ws.getCell(`B${row}`).numFmt = '₱#,##0.00';
    ws.getCell(`C${row}`).numFmt = '₱#,##0.00';

    if (label === "Total Payment Collections") {
      ws.getRow(row).font = { bold: true };
    }

    row++;
  }

  ws.getCell(`A${row}`).value = "Actual System";
  ws.getCell(`B${row}`).value = actualSystem;
  ws.getCell(`B${row}`).numFmt = '₱#,##0.00';
  ws.getCell(`A${row}`).border = thinBorder;
  ws.getCell(`B${row}`).border = thinBorder;
  ws.getCell(`A${row}`).fill = totalFill;
  ws.getCell(`B${row}`).fill = totalFill;
  ws.getRow(row).font = { bold: true };
  row++;

  ws.getCell(`A${row}`).value = "Sales Collected";
  ws.getCell(`B${row}`).value = salesCollectedDisplay;
  ws.getCell(`B${row}`).numFmt = '₱#,##0.00';
  ws.getCell(`A${row}`).border = thinBorder;
  ws.getCell(`B${row}`).border = thinBorder;
  ws.getCell(`A${row}`).fill = totalFill;
  ws.getCell(`B${row}`).fill = totalFill;
  ws.getRow(row).font = { bold: true };
  row += 2;

  ws.mergeCells(`A${row}:D${row}`);
  ws.getCell(`A${row}`).value = "OTHER TOTALS";
  ws.getCell(`A${row}`).fill = sectionFill;
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.getCell(`A${row}`).border = thinBorder;
  row++;

  const otherRows: Array<[string, number]> = [
    ["Add-ons (Paid)", addonsTotalWithCustomerOrders],
    ["Discount (Amount)", discount],
    ["Total Time", totalTimeAmount],
    ["Consignment Sales", consignment.gross],
    ["Consignment 15%", consignment.fee15],
    ["Consignment Net", consignment.net],
    ["Inventory Loss", inventoryLossAmount],
    ["Bilin", bilin],
    ["Sales System / Total Cost", salesSystemComputed],
  ];

  for (const [label, value] of otherRows) {
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`B${row}`).value = value;
    ws.getCell(`B${row}`).numFmt = '₱#,##0.00';

    ws.getCell(`A${row}`).border = thinBorder;
    ws.getCell(`B${row}`).border = thinBorder;
    ws.getCell(`A${row}`).fill = cardFill;
    ws.getCell(`B${row}`).fill = cardFill;

    if (label === "Sales System / Total Cost") {
      ws.getCell(`A${row}`).fill = totalFill;
      ws.getCell(`B${row}`).fill = totalFill;
      ws.getRow(row).font = { bold: true };
    }

    row++;
  }

  row += 2;

  ws.mergeCells(`A${row}:D${row}`);
  ws.getCell(`A${row}`).value = "CASH COUNT";
  ws.getCell(`A${row}`).fill = sectionFill;
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.getCell(`A${row}`).border = thinBorder;
  row++;

  ws.getRow(row).values = ["Type", "Denomination", "Qty", "Amount"];
  ws.getRow(row).font = { bold: true };
  ws.getRow(row).fill = sectionFill;
  ws.getRow(row).eachCell((c) => {
    c.border = thinBorder;
    c.alignment = { horizontal: "center" };
  });
  row++;

  for (const l of cashLines) {
    ws.addRow(["CASH", l.denomination, l.qty, l.denomination * l.qty]);
    ws.getRow(row).eachCell((c) => {
      c.border = thinBorder;
      c.fill = cardFill;
    });
    ws.getCell(`D${row}`).numFmt = '₱#,##0.00';
    row++;
  }

  for (const l of coinLines) {
    ws.addRow(["COIN", l.denomination, l.qty, l.denomination * l.qty]);
    ws.getRow(row).eachCell((c) => {
      c.border = thinBorder;
      c.fill = cardFill;
    });
    ws.getCell(`D${row}`).numFmt = '₱#,##0.00';
    row++;
  }

  ws.addRow(["Total Cash", "", "", cashTotal]);
  ws.getRow(row).eachCell((c) => {
    c.border = thinBorder;
    c.fill = totalFill;
    c.font = { bold: true };
  });
  ws.getCell(`D${row}`).numFmt = '₱#,##0.00';
  row++;

  ws.addRow(["Total Coins", "", "", coinTotal]);
  ws.getRow(row).eachCell((c) => {
    c.border = thinBorder;
    c.fill = totalFill;
    c.font = { bold: true };
  });
  ws.getCell(`D${row}`).numFmt = '₱#,##0.00';

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `Admin_Daily_Sales_Report_${selectedDate}.xlsx`);

  setToast({ open: true, msg: "Excel exported.", color: "success" });
};

  /* =========================
     LOAD on date change
  ========================= */

  useEffect(() => {
    void loadReport(selectedDate);
    void loadTotals(selectedDate);
    void loadConsignment(selectedDate);
    void loadAddonsPaidBase(selectedDate);
    void loadCustomerOrderPaid(selectedDate);
    void loadReservationPaymentPlacement(selectedDate);
    void loadPromoPaymentPlacement(selectedDate);
    void loadWalkinSystemPaidAndDiscount(selectedDate);
    void loadReservationTimeAndDiscount(selectedDate);
    void loadPromoDiscountAmount(selectedDate);
    void loadCashOutsTotal(selectedDate);
    void loadInventoryLossAmount(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!report) return;
    void loadCashLines(report.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

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

  const submitLabel = report?.is_submitted ? "SAVE / UPDATE" : "SAVE / SUBMIT";

  return (
    <IonPage>
      <IonHeader>{/* optional */}</IonHeader>

      <IonContent className="ion-padding ssr-page">
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((p) => ({ ...p, open: false }))}
        />

        <IonAlert
          isOpen={deleteAlertOpen}
          onDidDismiss={() => setDeleteAlertOpen(false)}
          header="Delete by Date"
          message={`Delete sales report for ${selectedDate}? This will remove the report + cash lines for that date only.`}
          buttons={[
            { text: "Cancel", role: "cancel" },
            { text: "Delete", role: "destructive", handler: () => void deleteByDate() },
          ]}
        />

        <IonCard className="ssr-card">
          <IonCardContent className="ssr-card-body">
            <div className="ssr-topbar">
              <div className="ssr-top-left">
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

                    <IonButton
                      className="ssr-cal-btn"
                      fill="clear"
                      disabled={submitting}
                      onClick={() => setDatePickerOpen(true)}
                    >
                      <IonIcon icon={calendarOutline} />
                    </IonButton>
                  </div>
                </IonItem>

                <div className="ssr-status">
                  Status: <b>{report?.is_submitted ? "SUBMITTED" : "DRAFT"}</b>
                  {report?.submitted_at ? (
                    <span className="ssr-status-sub">
                      (last submit: {new Date(report.submitted_at).toLocaleString()})
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="ssr-actions">
                <IonButton
                  className="ssr-btn ssr-btn--ghost"
                  fill="outline"
                  disabled={submitting || !report}
                  onClick={() => void exportToExcel()}
                >
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export Excel
                </IonButton>

                <IonButton
                  className="ssr-btn ssr-btn--ghost"
                  fill="outline"
                  disabled={submitting || !report}
                  onClick={() => exportToPDF()}
                >
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export PDF
                </IonButton>

                <IonButton
                  className="ssr-btn ssr-btn--danger"
                  fill="outline"
                  disabled={submitting || !isYMD(selectedDate)}
                  onClick={() => setDeleteAlertOpen(true)}
                >
                  <IonIcon slot="start" icon={trashOutline} />
                  Delete
                </IonButton>

                <IonButton
                  className="ssr-btn ssr-btn--primary"
                  strong
                  disabled={submitting || !report}
                  onClick={() => void onSubmitDone()}
                >
                  {submitting ? "Saving..." : submitLabel}
                </IonButton>
              </div>
            </div>
          </IonCardContent>
        </IonCard>

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
                      <IonItem lines="none" className="ssr-input-item ssr-input-item--toplabel">
                        <IonLabel position="stacked" className="ssr-top-input-label">
                          Cash
                        </IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_cash)) : "0"}
                          onIonChange={(ev) =>
                            void updateReportField(
                              "starting_cash",
                              valueToNonNegMoney(getDetailValue(ev))
                            )
                          }
                        />
                      </IonItem>
                    </div>

                    <div className="ssr-left-cell">
                      <IonItem lines="none" className="ssr-input-item ssr-input-item--toplabel">
                        <IonLabel position="stacked" className="ssr-top-input-label">
                          GCash
                        </IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_gcash)) : "0"}
                          onIonChange={(ev) =>
                            void updateReportField(
                              "starting_gcash",
                              valueToNonNegMoney(getDetailValue(ev))
                            )
                          }
                        />
                      </IonItem>
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">COH / Total of the Day</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cohCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(cohGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Cash Outs</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cashOutsCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(cashOutsGcash)}</div>
                  </div>

                  <div className="ssr-left-row ssr-left-row--tint">
                    <div className="ssr-left-label">Walk-in Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(walkinPaymentCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(walkinPaymentGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Reservation Payments (Same Day)</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(reservationDownCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(reservationDownGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Reservation Advance Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(reservationAdvanceCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(reservationAdvanceGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Promo Payments (Same Day)</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(promoTodayCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(promoTodayGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Promo Advance Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(promoAdvanceCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(promoAdvanceGcash)}</div>
                  </div>

                  <div className="ssr-left-row ssr-left-row--tint">
                    <div className="ssr-left-label">Total Payment Collections</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(totalPaymentCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(totalPaymentGcash)}</div>
                  </div>

                  <div className="ssr-system-grid">
                    <div className="ssr-system-box">
                      <div className="ssr-system-label">Actual System</div>
                      <div className="ssr-system-value">{peso(actualSystem)}</div>
                    </div>

                    <div className="ssr-system-box">
                      <div className="ssr-system-label">Sales System / Total Cost</div>
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

                  <div className="ssr-sales-boxes" style={{ marginTop: 10 }}>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment Sales</span>
                      <span className="ssr-sales-box-value">{peso(consignment.gross)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment 15%</span>
                      <span className="ssr-sales-box-value">{peso(consignment.fee15)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment Net</span>
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
                                onIonChange={(ev) =>
                                  void upsertQty(line, valueToNonNegInt(getDetailValue(ev)))
                                }
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
                                onIonChange={(ev) =>
                                  void upsertQty(line, valueToNonNegInt(getDetailValue(ev)))
                                }
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
                        onIonChange={(ev) =>
                          void updateReportField(
                            "bilin_amount",
                            valueToNonNegMoney(getDetailValue(ev))
                          )
                        }
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
                      <b>{peso(addonsTotalWithCustomerOrders)}</b>
                    </div>

                    <div className="ssr-mini-row">
                      <span>Discount (Amount)</span>
                      <b>{peso(discount)}</b>
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

export default AdminSalesReport;