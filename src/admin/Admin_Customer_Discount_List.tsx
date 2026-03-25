// src/pages/Admin_Customer_Discount_List.tsx
// ✅ SAME classnames/layout behavior as Customer_Discount_List.tsx
// ✅ Admin extras kept: Export Excel, Delete by current filtered range, Edit Code Rules
// ✅ strict TS (NO any)
// ✅ Phone # in table + receipt + excel
// ✅ Attendance logs
// ✅ Order list with image + Cancel Item
// ✅ Separate SYSTEM PAYMENT and ORDER PAYMENT
// ✅ Final PAID only when BOTH system + order are fully paid
// ✅ Refresh button
// ✅ Range filter Day / Week / Month uses ACTIVE COVERAGE overlap
// ✅ Area filter + dynamic duration filter
// ✅ Cancel promo requires description and moves to promo_bookings_cancelled
// ✅ Cancelled order items archived then deleted from active order tables

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";
type DiscountKind = "none" | "percent" | "amount";

type AreaFilter = "all" | PackageArea;
type CommonDurationFilter = "all" | "1_day" | "week" | "half_month" | "month";
type ConferenceDurationFilter = "all" | "1_hour" | "3_hours" | "6_hours" | "8_hours";

type OrderKind = "add_on" | "consignment";
type OrderParentSource = "addon_orders" | "consignment_orders";
type RangeMode = "day" | "week" | "month";

type Range = {
  startIso: string;
  endIso: string;
  label: string;
};

type PromoBookingAttendanceRow = {
  id: string;
  created_at: string;
  promo_booking_id: string;
  local_day: string;
  in_at: string;
  out_at: string | null;
  auto_out: boolean;
  note: string | null;
};

interface PromoBookingRow {
  id: string;
  created_at: string;
  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  discount_kind: DiscountKind;
  discount_value: number;
  discount_reason: string | null;

  promo_code: string | null;
  attempts_left: number;
  max_attempts: number;
  validity_end_at: string | null;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

interface PromoBookingDBRow {
  id: string;
  created_at: string;
  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number | string | null;

  gcash_amount: number | string | null;
  cash_amount: number | string | null;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  discount_kind: DiscountKind | string | null;
  discount_value: number | string | null;
  discount_reason: string | null;

  promo_code?: string | null;
  attempts_left?: number | string | null;
  max_attempts?: number | string | null;
  validity_end_at?: string | null;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

interface PromoBookingPaidUpdateRow {
  id: string;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
}

interface PromoOrderItemRow {
  id: string;
  booking_code: string;
  parent_order_id: string;
  kind: OrderKind;
  source_item_id: string;
  created_at: string | null;
  name: string;
  category: string | null;
  size: string | null;
  image_url: string | null;
  quantity: number;
  price: number;
  subtotal: number;
}

interface PromoOrderParentRow {
  id: string;
  booking_code: string;
  source: OrderParentSource;
  total_amount: number;
  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
}

type PromoOrdersMap = Record<string, PromoOrderItemRow[]>;
type PromoOrderParentsMap = Record<string, PromoOrderParentRow[]>;

type AddonOrderItemJoinRow = {
  id: string;
  created_at: string | null;
  add_on_id: string | null;
  quantity: number | string | null;
  price: number | string | null;
  subtotal: number | string | null;
  addon_orders: {
    id: string;
    booking_code: string | null;
  } | null;
  add_ons: {
    name: string | null;
    category: string | null;
    size: string | null;
    image_url: string | null;
  } | null;
};

type ConsignmentOrderItemJoinRow = {
  id: string;
  created_at: string | null;
  consignment_id: string | null;
  quantity: number | string | null;
  price: number | string | null;
  subtotal: number | string | null;
  consignment_orders: {
    id: string;
    booking_code: string | null;
  } | null;
  consignment: {
    item_name: string | null;
    category: string | null;
    size: string | null;
    image_url: string | null;
  } | null;
};

type AddonOrderParentDBRow = {
  id: string;
  booking_code: string | null;
  total_amount: number | string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
};

type ConsignmentOrderParentDBRow = {
  id: string;
  booking_code: string | null;
  total_amount: number | string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
};

type CancelOrderTarget = {
  booking: PromoBookingRow;
  item: PromoOrderItemRow;
};

/* ================= HELPERS ================= */

const toNumber = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number =>
  Number((Number.isFinite(n) ? n : 0).toFixed(2));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const prettyArea = (a: PackageArea): string =>
  a === "conference_room" ? "Conference Room" : "Common Area";

const seatLabel = (r: PromoBookingRow): string =>
  r.area === "conference_room" ? "CONFERENCE ROOM" : r.seat_number || "N/A";

const safePhone = (v: string | null | undefined): string => {
  const p = String(v ?? "").trim();
  return p ? p : "—";
};

const getStatus = (
  startIso: string,
  endIso: string,
  nowMs: number = Date.now()
): "UPCOMING" | "ONGOING" | "FINISHED" => {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "FINISHED";
  if (nowMs < s) return "UPCOMING";
  if (nowMs >= s && nowMs <= e) return "ONGOING";
  return "FINISHED";
};

const formatDuration = (v: number, u: DurationUnit): string => {
  const unit =
    u === "hour"
      ? v === 1
        ? "hour"
        : "hours"
      : u === "day"
      ? v === 1
        ? "day"
        : "days"
      : u === "month"
      ? v === 1
        ? "month"
        : "months"
      : v === 1
      ? "year"
      : "years";
  return `${v} ${unit}`;
};

const normalizeDiscountKind = (v: unknown): DiscountKind => {
  const s = String(v ?? "none").trim().toLowerCase();
  if (s === "percent") return "percent";
  if (s === "amount") return "amount";
  return "none";
};

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

const applyDiscount = (
  baseCost: number,
  kind: DiscountKind,
  value: number
): { discountedCost: number; discountAmount: number } => {
  const cost = Number.isFinite(baseCost) ? Math.max(0, baseCost) : 0;
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (kind === "percent") {
    const pct = clamp(v, 0, 100);
    const disc = round2((cost * pct) / 100);
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  if (kind === "amount") {
    const disc = round2(Math.min(cost, v));
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  return { discountedCost: round2(cost), discountAmount: 0 };
};

const moneyFromStr = (s: string): number =>
  round2(Math.max(0, toNumber(s)));

const isoToLocalDateTimeInput = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const localDateTimeInputToIso = (v: string): string =>
  new Date(v).toISOString();

const isExpired = (validityEndAtIso: string | null): boolean => {
  const iso = String(validityEndAtIso ?? "").trim();
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() > t;
};

const normalizeRow = (row: PromoBookingDBRow): PromoBookingRow => {
  const kind = normalizeDiscountKind(row.discount_kind);
  const value = round2(toNumber(row.discount_value));

  const attempts_left = Math.max(0, Math.floor(toNumber(row.attempts_left ?? 0)));
  const max_attempts = Math.max(0, Math.floor(toNumber(row.max_attempts ?? 0)));
  const validity_end_at = row.validity_end_at ?? null;

  return {
    id: row.id,
    created_at: row.created_at,
    full_name: row.full_name,
    phone_number: row.phone_number ?? null,

    area: row.area,
    seat_number: row.seat_number,
    start_at: row.start_at,
    end_at: row.end_at,
    price: round2(toNumber(row.price)),

    gcash_amount: round2(toNumber(row.gcash_amount)),
    cash_amount: round2(toNumber(row.cash_amount)),
    is_paid: toBool(row.is_paid),
    paid_at: row.paid_at ?? null,

    discount_kind: kind,
    discount_value: value,
    discount_reason: row.discount_reason ?? null,

    promo_code:
      row.promo_code ?? null ? String(row.promo_code ?? "").trim() : null,

    attempts_left,
    max_attempts,
    validity_end_at,

    packages: row.packages ?? null,
    package_options: row.package_options ?? null,
  };
};

const getCommonAreaDurationBucket = (
  r: PromoBookingRow
): CommonDurationFilter | "all" => {
  const optName = String(r.package_options?.option_name ?? "")
    .trim()
    .toLowerCase();
  const v = Number(r.package_options?.duration_value ?? 0);
  const u = String(r.package_options?.duration_unit ?? "")
    .trim()
    .toLowerCase();

  if (u === "day" && v === 1) return "1_day";
  if ((u === "day" && v === 7) || optName.includes("week")) return "week";
  if (
    (u === "day" && v === 15) ||
    optName.includes("half month") ||
    optName.includes("half-month")
  )
    return "half_month";
  if (
    (u === "month" && v === 1) ||
    (u === "day" && (v === 30 || v === 31)) ||
    optName.includes("month")
  )
    return "month";

  return "all";
};

const getConferenceDurationBucket = (
  r: PromoBookingRow
): ConferenceDurationFilter | "all" => {
  const v = Number(r.package_options?.duration_value ?? 0);
  const u = String(r.package_options?.duration_unit ?? "")
    .trim()
    .toLowerCase();

  if (u === "hour" && v === 1) return "1_hour";
  if (u === "hour" && v === 3) return "3_hours";
  if (u === "hour" && v === 6) return "6_hours";
  if (u === "hour" && v === 8) return "8_hours";

  return "all";
};

const attStatus = (r: PromoBookingAttendanceRow): "IN" | "OUT" =>
  r.out_at ? "OUT" : "IN";
const attStamp = (r: PromoBookingAttendanceRow): string =>
  r.out_at ? r.out_at : r.in_at;
const fmtPH = (iso: string): string => new Date(iso).toLocaleString("en-PH");

const startOfLocalDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

const addDaysLocal = (d: Date, days: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);

const startEndIsoLocalDay = (
  yyyyMmDd: string
): { startIso: string; endIso: string } => {
  const [yStr, mStr, dStr] = yyyyMmDd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  const startLocal = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endLocal = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  return { startIso: startLocal.toISOString(), endIso: endLocal.toISOString() };
};

const startOfWeekMondayLocal = (anyDay: Date): Date => {
  const d = startOfLocalDay(anyDay);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  return addDaysLocal(d, -diffToMonday);
};

const rangeFromMode = (mode: RangeMode, dayStr: string, monthStr: string): Range => {
  if (mode === "month") {
    const [yStr, mStr] = monthStr.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const startLocal = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const endLocal = new Date(y, m, 1, 0, 0, 0, 0);
    const label = `${startLocal.toLocaleString("en-PH", {
      month: "long",
    })} ${startLocal.getFullYear()}`;
    return {
      startIso: startLocal.toISOString(),
      endIso: endLocal.toISOString(),
      label,
    };
  }

  if (mode === "week") {
    const [yStr, mStr, dStr] = dayStr.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const picked = new Date(y, m - 1, d, 12, 0, 0, 0);
    const startLocal = startOfWeekMondayLocal(picked);
    const endLocal = addDaysLocal(startLocal, 7);
    const label = `${yyyyMmDdLocal(startLocal)} to ${yyyyMmDdLocal(
      addDaysLocal(endLocal, -1)
    )}`;
    return {
      startIso: startLocal.toISOString(),
      endIso: endLocal.toISOString(),
      label,
    };
  }

  const r = startEndIsoLocalDay(dayStr);
  return { startIso: r.startIso, endIso: r.endIso, label: dayStr };
};

const bookingOverlapsRange = (
  startIso: string,
  endIso: string,
  range: Range
): boolean => {
  const bookingStart = new Date(startIso).getTime();
  const bookingEnd = new Date(endIso).getTime();
  const rangeStart = new Date(range.startIso).getTime();
  const rangeEnd = new Date(range.endIso).getTime();

  if (!Number.isFinite(bookingStart) || !Number.isFinite(bookingEnd)) return false;
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return false;

  return bookingStart < rangeEnd && bookingEnd >= rangeStart;
};

const isLikelyUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\//i.test(v.trim());

const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
};

const fetchBookingById = async (
  id: string,
  selectPromoBookings: string
): Promise<PromoBookingDBRow | null> => {
  const { data, error } = await supabase
    .from("promo_bookings")
    .select(selectPromoBookings)
    .eq("id", id)
    .limit(1);

  if (error) throw new Error(error.message);
  const arr = (data ?? []) as unknown as PromoBookingDBRow[];
  return arr.length ? arr[0] : null;
};

const updateBookingThenFetch = async (
  id: string,
  patch: Record<string, unknown>,
  selectPromoBookings: string
): Promise<PromoBookingDBRow> => {
  const { data: upd, error: updErr } = await supabase
    .from("promo_bookings")
    .update(patch)
    .eq("id", id)
    .select("id")
    .limit(1);

  if (updErr) throw new Error(updErr.message);
  if (!upd || upd.length === 0) {
    throw new Error("No row updated. Possible RLS/permission issue or missing record.");
  }

  const full = await fetchBookingById(id, selectPromoBookings);
  if (!full) throw new Error("Updated but failed to refetch booking.");
  return full;
};

const normalizeOrderParents = (
  rows: AddonOrderParentDBRow[] | ConsignmentOrderParentDBRow[],
  source: OrderParentSource
): PromoOrderParentRow[] => {
  return rows.map((r) => ({
    id: r.id,
    booking_code: String(r.booking_code ?? "").trim(),
    source,
    total_amount: round2(toNumber(r.total_amount)),
    gcash_amount: round2(toNumber(r.gcash_amount)),
    cash_amount: round2(toNumber(r.cash_amount)),
    is_paid: toBool(r.is_paid),
    paid_at: r.paid_at ?? null,
  }));
};

const allocateAmountsAcrossOrders = (
  parents: PromoOrderParentRow[],
  totalGcash: number,
  totalCash: number
): Array<{
  id: string;
  source: OrderParentSource;
  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
}> => {
  const sorted = [...parents].sort((a, b) => a.id.localeCompare(b.id));

  let remainingGcash = round2(Math.max(0, totalGcash));
  let remainingCash = round2(Math.max(0, totalCash));

  const result: Array<{
    id: string;
    source: OrderParentSource;
    gcash_amount: number;
    cash_amount: number;
    is_paid: boolean;
    paid_at: string | null;
  }> = [];

  sorted.forEach((p, idx) => {
    const due = round2(Math.max(0, p.total_amount));
    const notLast = idx < sorted.length - 1;

    let useGcash = 0;
    let useCash = 0;

    if (notLast) {
      useGcash = round2(Math.min(remainingGcash, due));
      const remainDueAfterG = round2(Math.max(0, due - useGcash));
      useCash = round2(Math.min(remainingCash, remainDueAfterG));
    } else {
      useGcash = round2(Math.max(0, remainingGcash));
      useCash = round2(Math.max(0, remainingCash));
    }

    remainingGcash = round2(Math.max(0, remainingGcash - useGcash));
    remainingCash = round2(Math.max(0, remainingCash - useCash));

    const totalPaid = round2(useGcash + useCash);
    const isPaid = due <= 0 ? true : totalPaid >= due;

    result.push({
      id: p.id,
      source: p.source,
      gcash_amount: useGcash,
      cash_amount: useCash,
      is_paid: isPaid,
      paid_at: isPaid ? new Date().toISOString() : null,
    });
  });

  return result;
};

const Admin_Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);
  const [selectedOrderBooking, setSelectedOrderBooking] =
    useState<PromoBookingRow | null>(null);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [selectedDay, setSelectedDay] = useState<string>(yyyyMmDdLocal(new Date()));
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });

  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");
  const [commonDurationFilter, setCommonDurationFilter] =
    useState<CommonDurationFilter>("all");
  const [conferenceDurationFilter, setConferenceDurationFilter] =
    useState<ConferenceDurationFilter>("all");

  const [deletingRangeLabel, setDeletingRangeLabel] = useState<string | null>(null);

  const [attMap, setAttMap] = useState<Record<string, PromoBookingAttendanceRow[]>>(
    {}
  );
  const [attModalTarget, setAttModalTarget] = useState<PromoBookingRow | null>(
    null
  );

  const [ordersMap, setOrdersMap] = useState<PromoOrdersMap>({});
  const [orderParentsMap, setOrderParentsMap] = useState<PromoOrderParentsMap>(
    {}
  );

  const [paymentTarget, setPaymentTarget] = useState<PromoBookingRow | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [orderPaymentTarget, setOrderPaymentTarget] =
    useState<PromoBookingRow | null>(null);
  const [orderGcashInput, setOrderGcashInput] = useState<string>("0");
  const [orderCashInput, setOrderCashInput] = useState<string>("0");
  const [savingOrderPayment, setSavingOrderPayment] = useState<boolean>(false);

  const [discountTarget, setDiscountTarget] = useState<PromoBookingRow | null>(
    null
  );
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValueInput, setDiscountValueInput] = useState<string>("0");
  const [discountReasonInput, setDiscountReasonInput] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<PromoBookingRow | null>(null);
  const [cancelDesc, setCancelDesc] = useState<string>("");
  const [cancelError, setCancelError] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [ruleTarget, setRuleTarget] = useState<PromoBookingRow | null>(null);
  const [ruleAttemptsLeftInput, setRuleAttemptsLeftInput] = useState<string>("0");
  const [ruleMaxAttemptsInput, setRuleMaxAttemptsInput] = useState<string>("0");
  const [ruleValidityInput, setRuleValidityInput] = useState<string>("");
  const [savingRule, setSavingRule] = useState<boolean>(false);

  const [orderCancelTarget, setOrderCancelTarget] =
    useState<CancelOrderTarget | null>(null);
  const [orderCancelNote, setOrderCancelNote] = useState<string>("");
  const [cancellingOrderItemId, setCancellingOrderItemId] = useState<string | null>(
    null
  );

  const localRole = useMemo(
    () => String(localStorage.getItem("role") ?? "").toLowerCase(),
    []
  );
  const canEditRules = useMemo(
    () => localRole === "admin" || localRole === "staff",
    [localRole]
  );

  const selectPromoBookings = `
    id,
    created_at,
    full_name,
    phone_number,
    area,
    seat_number,
    start_at,
    end_at,
    price,
    gcash_amount,
    cash_amount,
    is_paid,
    paid_at,
    discount_kind,
    discount_value,
    discount_reason,
    promo_code,
    attempts_left,
    max_attempts,
    validity_end_at,
    packages:package_id ( title ),
    package_options:package_option_id (
      option_name,
      duration_value,
      duration_unit
    )
  `;

  const fetchAttendanceForBookings = async (bookingIds: string[]): Promise<void> => {
    if (bookingIds.length === 0) {
      setAttMap({});
      return;
    }

    const safeIds = bookingIds.slice(0, 500);

    const { data, error } = await supabase
      .from("promo_booking_attendance")
      .select("id, created_at, promo_booking_id, local_day, in_at, out_at, auto_out, note")
      .in("promo_booking_id", safeIds)
      .order("local_day", { ascending: false })
      .order("in_at", { ascending: false })
      .limit(3000);

    if (error) {
      setAttMap({});
      return;
    }

    const aRows = (data ?? []) as PromoBookingAttendanceRow[];
    const map: Record<string, PromoBookingAttendanceRow[]> = {};

    for (const r of aRows) {
      const k = String(r.promo_booking_id);
      if (!map[k]) map[k] = [];
      map[k].push(r);
    }

    Object.keys(map).forEach((k) => {
      map[k] = map[k].slice(0, 30);
    });

    setAttMap(map);
  };

  const fetchOrdersForPromoCodes = async (codes: string[]): Promise<void> => {
    const cleanCodes = Array.from(
      new Set(
        codes
          .map((c) => String(c ?? "").trim())
          .filter((c) => c.length > 0)
      )
    );

    if (cleanCodes.length === 0) {
      setOrdersMap({});
      setOrderParentsMap({});
      return;
    }

    const [addonParentsRes, consignmentParentsRes, addonItemsRes, consignmentItemsRes] =
      await Promise.all([
        supabase
          .from("addon_orders")
          .select("id, booking_code, total_amount, gcash_amount, cash_amount, is_paid, paid_at")
          .in("booking_code", cleanCodes),

        supabase
          .from("consignment_orders")
          .select("id, booking_code, total_amount, gcash_amount, cash_amount, is_paid, paid_at")
          .in("booking_code", cleanCodes),

        supabase
          .from("addon_order_items")
          .select(`
            id,
            created_at,
            add_on_id,
            quantity,
            price,
            subtotal,
            addon_orders!inner (
              id,
              booking_code
            ),
            add_ons (
              name,
              category,
              size,
              image_url
            )
          `)
          .in("addon_orders.booking_code", cleanCodes),

        supabase
          .from("consignment_order_items")
          .select(`
            id,
            created_at,
            consignment_id,
            quantity,
            price,
            subtotal,
            consignment_orders!inner (
              id,
              booking_code
            ),
            consignment (
              item_name,
              category,
              size,
              image_url
            )
          `)
          .in("consignment_orders.booking_code", cleanCodes),
      ]);

    const parentMap: PromoOrderParentsMap = {};
    const itemMap: PromoOrdersMap = {};

    const addonParents = normalizeOrderParents(
      (addonParentsRes.data ?? []) as AddonOrderParentDBRow[],
      "addon_orders"
    );

    const consignmentParents = normalizeOrderParents(
      (consignmentParentsRes.data ?? []) as ConsignmentOrderParentDBRow[],
      "consignment_orders"
    );

    [...addonParents, ...consignmentParents].forEach((p) => {
      const code = p.booking_code;
      if (!code) return;
      if (!parentMap[code]) parentMap[code] = [];
      parentMap[code].push(p);
    });

    const addonItems = (addonItemsRes.data ?? []) as unknown as AddonOrderItemJoinRow[];
    addonItems.forEach((r) => {
      const code = String(r.addon_orders?.booking_code ?? "").trim();
      const parentId = String(r.addon_orders?.id ?? "").trim();
      if (!code || !parentId) return;

      if (!itemMap[code]) itemMap[code] = [];

      itemMap[code].push({
        id: r.id,
        booking_code: code,
        parent_order_id: parentId,
        kind: "add_on",
        source_item_id: String(r.add_on_id ?? "").trim(),
        created_at: r.created_at ?? null,
        name: String(r.add_ons?.name ?? "").trim() || "Add-on Item",
        category: r.add_ons?.category ?? null,
        size: r.add_ons?.size ?? null,
        image_url: r.add_ons?.image_url ?? null,
        quantity: Math.max(0, Math.floor(toNumber(r.quantity))),
        price: round2(toNumber(r.price)),
        subtotal: round2(
          toNumber(
            r.subtotal == null ? toNumber(r.price) * toNumber(r.quantity) : r.subtotal
          )
        ),
      });
    });

    const consignmentItems = (consignmentItemsRes.data ?? []) as unknown as ConsignmentOrderItemJoinRow[];
    consignmentItems.forEach((r) => {
      const code = String(r.consignment_orders?.booking_code ?? "").trim();
      const parentId = String(r.consignment_orders?.id ?? "").trim();
      if (!code || !parentId) return;

      if (!itemMap[code]) itemMap[code] = [];

      itemMap[code].push({
        id: r.id,
        booking_code: code,
        parent_order_id: parentId,
        kind: "consignment",
        source_item_id: String(r.consignment_id ?? "").trim(),
        created_at: r.created_at ?? null,
        name: String(r.consignment?.item_name ?? "").trim() || "Consignment Item",
        category: r.consignment?.category ?? null,
        size: r.consignment?.size ?? null,
        image_url: r.consignment?.image_url ?? null,
        quantity: Math.max(0, Math.floor(toNumber(r.quantity))),
        price: round2(toNumber(r.price)),
        subtotal: round2(
          toNumber(
            r.subtotal == null ? toNumber(r.price) * toNumber(r.quantity) : r.subtotal
          )
        ),
      });
    });

    Object.keys(itemMap).forEach((code) => {
      itemMap[code] = itemMap[code].sort((a, b) => a.name.localeCompare(b.name));
    });

    setOrdersMap(itemMap);
    setOrderParentsMap(parentMap);
  };

  const fetchPromoBookings = async (): Promise<PromoBookingRow[]> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("promo_bookings")
      .select(selectPromoBookings)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      alert(`Load error: ${error.message}`);
      setRows([]);
      setAttMap({});
      setOrdersMap({});
      setOrderParentsMap({});
      setLoading(false);
      return [];
    }

    const dbRows = (data ?? []) as unknown as PromoBookingDBRow[];
    const normalized = dbRows.map(normalizeRow);

    setRows(normalized);
    setLoading(false);

    const ids = normalized.map((r) => r.id);
    void fetchAttendanceForBookings(ids);

    const codes = normalized.map((r) => String(r.promo_code ?? ""));
    void fetchOrdersForPromoCodes(codes);

    return normalized;
  };

  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await fetchPromoBookings();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchPromoBookings();
  }, []);

  useEffect(() => {
    setCommonDurationFilter("all");
    setConferenceDurationFilter("all");
  }, [areaFilter]);

  const activeRange = useMemo(
    () => rangeFromMode(rangeMode, selectedDay, selectedMonth),
    [rangeMode, selectedDay, selectedMonth]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!bookingOverlapsRange(r.start_at, r.end_at, activeRange)) return false;

      if (areaFilter !== "all" && r.area !== areaFilter) return false;

      if (areaFilter === "common_area" && commonDurationFilter !== "all") {
        const bucket = getCommonAreaDurationBucket(r);
        if (bucket !== commonDurationFilter) return false;
      }

      if (
        areaFilter === "conference_room" &&
        conferenceDurationFilter !== "all"
      ) {
        const bucket = getConferenceDurationBucket(r);
        if (bucket !== conferenceDurationFilter) return false;
      }

      return true;
    });
  }, [
    rows,
    activeRange,
    areaFilter,
    commonDurationFilter,
    conferenceDurationFilter,
  ]);

  const logsFor = (bookingId: string): PromoBookingAttendanceRow[] =>
    attMap[bookingId] ?? [];
  const lastLogFor = (bookingId: string): PromoBookingAttendanceRow | null => {
    const logs = logsFor(bookingId);
    return logs.length ? logs[0] : null;
  };

  const getOrderItems = (code: string | null): PromoOrderItemRow[] => {
    if (!code) return [];
    return ordersMap[code] ?? [];
  };

  const getOrderParents = (code: string | null): PromoOrderParentRow[] => {
    if (!code) return [];
    return orderParentsMap[code] ?? [];
  };

  const hasOrder = (code: string | null): boolean => {
    return getOrderItems(code).length > 0 || getOrderParents(code).length > 0;
  };

  const getOrderDue = (code: string | null): number => {
    const parentTotal = round2(
      getOrderParents(code).reduce(
        (sum, r) => sum + round2(Math.max(0, r.total_amount)),
        0
      )
    );

    const itemsTotal = round2(
      getOrderItems(code).reduce(
        (sum, item) => sum + round2(Math.max(0, item.subtotal)),
        0
      )
    );

    if (itemsTotal > 0) return itemsTotal;
    return parentTotal;
  };

  const getOrderPaidInfo = (
    code: string | null
  ): { gcash: number; cash: number; totalPaid: number } => {
    const parents = getOrderParents(code);
    const gcash = round2(
      parents.reduce((sum, r) => sum + round2(Math.max(0, r.gcash_amount)), 0)
    );
    const cash = round2(
      parents.reduce((sum, r) => sum + round2(Math.max(0, r.cash_amount)), 0)
    );
    return { gcash, cash, totalPaid: round2(gcash + cash) };
  };

  const getSystemDue = (r: PromoBookingRow): number => {
    const base = round2(Math.max(0, toNumber(r.price)));
    return round2(
      applyDiscount(base, r.discount_kind, r.discount_value).discountedCost
    );
  };

  const getSystemPaidInfo = (
    r: PromoBookingRow
  ): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    return { gcash, cash, totalPaid: round2(gcash + cash) };
  };

  const getSystemRemainingInfo = (
    r: PromoBookingRow
  ): { remaining: number; change: number; label: "Remaining" | "Change" } => {
    const due = getSystemDue(r);
    const paid = getSystemPaidInfo(r).totalPaid;
    const diff = round2(due - paid);

    if (diff > 0) return { remaining: diff, change: 0, label: "Remaining" };
    return { remaining: 0, change: round2(Math.abs(diff)), label: "Change" };
  };

  const getOrderRemainingInfo = (
    code: string | null
  ): { remaining: number; change: number; label: "Remaining" | "Change" } => {
    const due = getOrderDue(code);
    const paid = getOrderPaidInfo(code).totalPaid;
    const diff = round2(due - paid);

    if (diff > 0) return { remaining: diff, change: 0, label: "Remaining" };
    return { remaining: 0, change: round2(Math.abs(diff)), label: "Change" };
  };

  const getGrandDue = (r: PromoBookingRow): number =>
    round2(getSystemDue(r) + getOrderDue(r.promo_code));

  const getGrandPaid = (r: PromoBookingRow): number =>
    round2(getSystemPaidInfo(r).totalPaid + getOrderPaidInfo(r.promo_code).totalPaid);

  const getGrandBalanceInfo = (
    r: PromoBookingRow
  ): {
    remaining: number;
    change: number;
    label: "Overall Remaining" | "Overall Change";
  } => {
    const due = getGrandDue(r);
    const paid = getGrandPaid(r);
    const diff = round2(due - paid);

    if (diff > 0) {
      return { remaining: diff, change: 0, label: "Overall Remaining" };
    }

    return {
      remaining: 0,
      change: round2(Math.abs(diff)),
      label: "Overall Change",
    };
  };

    const totals = useMemo(() => {
    const nowMs = tick;
    const total = filteredRows.reduce((sum, r) => sum + getGrandDue(r), 0);

    let upcoming = 0;
    let ongoing = 0;
    let finished = 0;

    for (const r of filteredRows) {
      const st = getStatus(r.start_at, r.end_at, nowMs);
      if (st === "UPCOMING") upcoming += 1;
      else if (st === "ONGOING") ongoing += 1;
      else finished += 1;
    }

    return { total: round2(total), upcoming, ongoing, finished };
  }, [filteredRows, tick, ordersMap, orderParentsMap]);

  const isFinalPaidRow = (r: PromoBookingRow): boolean => {
    const systemDue = getSystemDue(r);
    const systemPaid = getSystemPaidInfo(r).totalPaid;
    const systemOk = systemDue <= 0 ? true : systemPaid >= systemDue;

    if (!hasOrder(r.promo_code)) return systemOk;

    const orderDue = getOrderDue(r.promo_code);
    const orderPaid = getOrderPaidInfo(r.promo_code).totalPaid;
    const orderOk = orderDue <= 0 ? true : orderPaid >= orderDue;

    return systemOk && orderOk;
  };

  const syncPromoFinalPaid = async (promoId: string): Promise<void> => {
    const row = rows.find((r) => r.id === promoId);
    if (!row) return;

    const systemDue = getSystemDue(row);
    const systemPaid = getSystemPaidInfo(row).totalPaid;
    const systemOk = systemDue <= 0 ? true : systemPaid >= systemDue;

    const orderDue = getOrderDue(row.promo_code);
    const orderPaid = getOrderPaidInfo(row.promo_code).totalPaid;
    const hasAnyOrder = hasOrder(row.promo_code);

    const finalPaid = hasAnyOrder
      ? systemOk && (orderDue <= 0 ? true : orderPaid >= orderDue)
      : systemOk;

    const nextPaidAt = finalPaid ? new Date().toISOString() : null;

    const { error } = await supabase
      .from("promo_bookings")
      .update({
        is_paid: finalPaid,
        paid_at: nextPaidAt,
      })
      .eq("id", promoId);

    if (error) {
      console.warn("syncPromoFinalPaid error:", error.message);
      return;
    }

    setRows((prev) =>
      prev.map((x) =>
        x.id === promoId
          ? {
              ...x,
              is_paid: finalPaid,
              paid_at: nextPaidAt,
            }
          : x
      )
    );

    setSelected((prev) =>
      prev?.id === promoId
        ? {
            ...prev,
            is_paid: finalPaid,
            paid_at: nextPaidAt,
          }
        : prev
    );

    setSelectedOrderBooking((prev) =>
      prev?.id === promoId
        ? {
            ...prev,
            is_paid: finalPaid,
            paid_at: nextPaidAt,
          }
        : prev
    );
  };

  const recalcAddonParentAfterDelete = async (parentOrderId: string): Promise<void> => {
    const { data: remainingItems, error: remErr } = await supabase
      .from("addon_order_items")
      .select("subtotal, price, quantity")
      .eq("addon_order_id", parentOrderId);

    if (remErr) throw remErr;

    const rows = (remainingItems ?? []) as Array<{
      subtotal?: number | string | null;
      price?: number | string | null;
      quantity?: number | string | null;
    }>;

    if (rows.length === 0) {
      const { error: delParentErr } = await supabase
        .from("addon_orders")
        .delete()
        .eq("id", parentOrderId);

      if (delParentErr) throw delParentErr;
      return;
    }

    const newTotal = round2(
      rows.reduce((sum, r) => {
        const subtotal = toNumber(
          r.subtotal ?? toNumber(r.price) * toNumber(r.quantity)
        );
        return sum + subtotal;
      }, 0)
    );

    const { error: updParentErr } = await supabase
      .from("addon_orders")
      .update({ total_amount: newTotal })
      .eq("id", parentOrderId);

    if (updParentErr) throw updParentErr;
  };

  const recalcConsignmentParentAfterDelete = async (
    parentOrderId: string
  ): Promise<void> => {
    const { data: remainingItems, error: remErr } = await supabase
      .from("consignment_order_items")
      .select("subtotal, price, quantity")
      .eq("consignment_order_id", parentOrderId);

    if (remErr) throw remErr;

    const rows = (remainingItems ?? []) as Array<{
      subtotal?: number | string | null;
      price?: number | string | null;
      quantity?: number | string | null;
    }>;

    if (rows.length === 0) {
      const { error: delParentErr } = await supabase
        .from("consignment_orders")
        .delete()
        .eq("id", parentOrderId);

      if (delParentErr) throw delParentErr;
      return;
    }

    const newTotal = round2(
      rows.reduce((sum, r) => {
        const subtotal = toNumber(
          r.subtotal ?? toNumber(r.price) * toNumber(r.quantity)
        );
        return sum + subtotal;
      }, 0)
    );

    const { error: updParentErr } = await supabase
      .from("consignment_orders")
      .update({ total_amount: newTotal })
      .eq("id", parentOrderId);

    if (updParentErr) throw updParentErr;
  };

  const refreshDataAfterOrderCancel = async (
    booking: PromoBookingRow
  ): Promise<void> => {
    const freshRows = await fetchPromoBookings();
    const fresh = freshRows.find((r) => r.id === booking.id) ?? null;

    if (selected && selected.id === booking.id) setSelected(fresh);
    if (selectedOrderBooking && selectedOrderBooking.id === booking.id) {
      setSelectedOrderBooking(fresh);
    }

    if (fresh) {
      await syncPromoFinalPaid(fresh.id);
    }
  };

  const openOrderCancelModal = (booking: PromoBookingRow, item: PromoOrderItemRow): void => {
    setOrderCancelTarget({ booking, item });
    setOrderCancelNote("");
  };

  const submitOrderItemCancel = async (): Promise<void> => {
    if (!orderCancelTarget) return;

    const note = orderCancelNote.trim();
    if (!note) {
      alert("Cancel note is required.");
      return;
    }

    const { booking, item } = orderCancelTarget;

    try {
      setCancellingOrderItemId(item.id);

      if (item.kind === "add_on") {
        const systemPay = getSystemPaidInfo(booking);

        const cancelPayload = {
          original_id: item.id,
          created_at: item.created_at,
          add_on_id: item.source_item_id || null,
          quantity: item.quantity,
          price: item.price,
          full_name: booking.full_name,
          seat_number: seatLabel(booking),
          gcash_amount: systemPay.gcash,
          cash_amount: systemPay.cash,
          is_paid: toBool(booking.is_paid),
          paid_at: booking.paid_at ?? null,
          description: note,
        };

        const { error: insertErr } = await supabase
          .from("customer_session_add_ons_cancelled")
          .insert(cancelPayload);

        if (insertErr) {
          alert(`Cancel add-on failed: ${insertErr.message}`);
          return;
        }

        const { error: deleteErr } = await supabase
          .from("addon_order_items")
          .delete()
          .eq("id", item.id);

        if (deleteErr) {
          alert(`Cancelled copy saved, but item delete failed: ${deleteErr.message}`);
          return;
        }

        if (item.source_item_id) {
          const { data: addonRow, error: addonFetchErr } = await supabase
            .from("add_ons")
            .select("sold")
            .eq("id", item.source_item_id)
            .maybeSingle();

          if (!addonFetchErr && addonRow) {
            const nextSold = Math.max(
              0,
              round2(
                toNumber((addonRow as { sold?: number | string | null }).sold) -
                  item.quantity
              )
            );
            await supabase
              .from("add_ons")
              .update({ sold: nextSold })
              .eq("id", item.source_item_id);
          }
        }

        await recalcAddonParentAfterDelete(item.parent_order_id);
      } else {
        const systemPay = getSystemPaidInfo(booking);

        const consignmentPayload = {
          original_id: item.id,
          original_created_at: item.created_at,
          consignment_id: item.source_item_id || null,
          quantity: item.quantity,
          price: item.price,
          total: item.subtotal,
          full_name: booking.full_name,
          seat_number: seatLabel(booking),
          gcash_amount: systemPay.gcash,
          cash_amount: systemPay.cash,
          is_paid: toBool(booking.is_paid),
          paid_at: booking.paid_at ?? null,
          was_voided: false,
          voided_at: null,
          void_note: null,
          item_name: item.name,
          category: item.category,
          size: item.size,
          image_url: item.image_url,
          cancel_note: note,
          stock_returned: true,
        };

        const { error: insertErr } = await supabase
          .from("consignment_cancelled")
          .insert(consignmentPayload);

        if (insertErr) {
          alert(`Cancel consignment failed: ${insertErr.message}`);
          return;
        }

        const { error: deleteErr } = await supabase
          .from("consignment_order_items")
          .delete()
          .eq("id", item.id);

        if (deleteErr) {
          alert(`Cancelled copy saved, but item delete failed: ${deleteErr.message}`);
          return;
        }

        if (item.source_item_id) {
          const { data: conRow, error: conFetchErr } = await supabase
            .from("consignment")
            .select("sold")
            .eq("id", item.source_item_id)
            .maybeSingle();

          if (!conFetchErr && conRow) {
            const nextSold = Math.max(
              0,
              round2(
                toNumber((conRow as { sold?: number | string | null }).sold) -
                  item.quantity
              )
            );
            await supabase
              .from("consignment")
              .update({ sold: nextSold })
              .eq("id", item.source_item_id);
          }
        }

        await recalcConsignmentParentAfterDelete(item.parent_order_id);
      }

      await refreshDataAfterOrderCancel(booking);
      setOrderCancelTarget(null);
      setOrderCancelNote("");
      alert("Order item cancelled successfully.");
    } catch (e) {
      console.error(e);
      alert("Order item cancel failed.");
    } finally {
      setCancellingOrderItemId(null);
    }
  };

  const openPaymentModal = (r: PromoBookingRow): void => {
    setPaymentTarget(r);
    setGcashInput(String(round2(Math.max(0, toNumber(r.gcash_amount)))));
    setCashInput(String(round2(Math.max(0, toNumber(r.cash_amount)))));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = getSystemDue(paymentTarget);
    const g = moneyFromStr(gcashInput);
    const c = moneyFromStr(cashInput);
    const totalPaid = round2(g + c);
    const systemPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const dbRow = await updateBookingThenFetch(
        paymentTarget.id,
        {
          gcash_amount: g,
          cash_amount: c,
          is_paid: false,
          paid_at:
            systemPaidAuto && !hasOrder(paymentTarget.promo_code)
              ? new Date().toISOString()
              : null,
        },
        selectPromoBookings
      );

      const updated = normalizeRow(dbRow);
      setRows((prev) => prev.map((x) => (x.id === paymentTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === paymentTarget.id ? updated : prev));
      setSelectedOrderBooking((prev) =>
        prev?.id === paymentTarget.id ? updated : prev
      );
      setPaymentTarget(null);

      await syncPromoFinalPaid(updated.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save payment failed.";
      alert(`Save payment error: ${msg}`);
    } finally {
      setSavingPayment(false);
    }
  };

  const openOrderPaymentModal = (r: PromoBookingRow): void => {
    const pi = getOrderPaidInfo(r.promo_code);
    setOrderPaymentTarget(r);
    setOrderGcashInput(String(pi.gcash));
    setOrderCashInput(String(pi.cash));
  };

  const saveOrderPayment = async (): Promise<void> => {
    if (!orderPaymentTarget) return;

    const code = orderPaymentTarget.promo_code;
    if (!code) {
      alert("Promo code not found.");
      return;
    }

    const parents = getOrderParents(code);
    if (parents.length === 0) {
      alert("No order found for this promo code.");
      return;
    }

    const g = moneyFromStr(orderGcashInput);
    const c = moneyFromStr(orderCashInput);

    try {
      setSavingOrderPayment(true);

      const allocations = allocateAmountsAcrossOrders(parents, g, c);

      for (const alloc of allocations) {
        const tableName =
          alloc.source === "addon_orders" ? "addon_orders" : "consignment_orders";

        const { error } = await supabase
          .from(tableName)
          .update({
            gcash_amount: alloc.gcash_amount,
            cash_amount: alloc.cash_amount,
            is_paid: alloc.is_paid,
            paid_at: alloc.paid_at,
          })
          .eq("id", alloc.id);

        if (error) {
          alert(`Save order payment error: ${error.message}`);
          return;
        }
      }

      const nextParents: PromoOrderParentRow[] = parents.map((p) => {
        const found = allocations.find(
          (a) => a.id === p.id && a.source === p.source
        );
        if (!found) return p;
        return {
          ...p,
          gcash_amount: found.gcash_amount,
          cash_amount: found.cash_amount,
          is_paid: found.is_paid,
          paid_at: found.paid_at,
        };
      });

      setOrderParentsMap((prev) => ({
        ...prev,
        [code]: nextParents,
      }));

      setOrderPaymentTarget(null);

      await fetchOrdersForPromoCodes(rows.map((r) => String(r.promo_code ?? "")));
      await syncPromoFinalPaid(orderPaymentTarget.id);
    } catch (e) {
      console.error(e);
      alert("Save order payment failed.");
    } finally {
      setSavingOrderPayment(false);
    }
  };

  const openDiscountModal = (r: PromoBookingRow): void => {
    setDiscountTarget(r);
    setDiscountKind(r.discount_kind ?? "none");
    setDiscountValueInput(String(round2(toNumber(r.discount_value))));
    setDiscountReasonInput(String(r.discount_reason ?? ""));
    setGcashInput(String(round2(Math.max(0, toNumber(r.gcash_amount)))));
    setCashInput(String(round2(Math.max(0, toNumber(r.cash_amount)))));
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const base = round2(Math.max(0, toNumber(discountTarget.price)));
    const rawVal = toNumber(discountValueInput);
    const cleanVal = round2(Math.max(0, rawVal));
    const finalVal = discountKind === "percent" ? clamp(cleanVal, 0, 100) : cleanVal;

    const calc = applyDiscount(base, discountKind, finalVal);
    const newDue = round2(calc.discountedCost);

    const g = moneyFromStr(gcashInput);
    const c = moneyFromStr(cashInput);
    const totalPaid = round2(g + c);
    const systemPaidAuto = newDue <= 0 ? true : totalPaid >= newDue;

    try {
      setSavingDiscount(true);

      const dbRow = await updateBookingThenFetch(
        discountTarget.id,
        {
          discount_kind: discountKind,
          discount_value: finalVal,
          discount_reason: discountReasonInput.trim() || null,
          gcash_amount: g,
          cash_amount: c,
          is_paid: false,
          paid_at:
            systemPaidAuto && !hasOrder(discountTarget.promo_code)
              ? new Date().toISOString()
              : null,
        },
        selectPromoBookings
      );

      const updated = normalizeRow(dbRow);
      setRows((prev) => prev.map((x) => (x.id === discountTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === discountTarget.id ? updated : prev));
      setSelectedOrderBooking((prev) =>
        prev?.id === discountTarget.id ? updated : prev
      );
      setDiscountTarget(null);

      await syncPromoFinalPaid(updated.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save discount failed.";
      alert(`Save discount error: ${msg}`);
    } finally {
      setSavingDiscount(false);
    }
  };

  const togglePaid = async (r: PromoBookingRow): Promise<void> => {
    try {
      setTogglingPaidId(r.id);

      const current = toBool(r.is_paid);
      const nextPaid = !current;

      if (nextPaid && !isFinalPaidRow(r)) {
        alert(
          "Cannot set PAID yet. Both System Payment and Order Payment must be fully paid first."
        );
        return;
      }

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .eq("id", r.id)
        .select("id, is_paid, paid_at, gcash_amount, cash_amount")
        .limit(1);

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      const u = (((data ?? []) as unknown as PromoBookingPaidUpdateRow[])[0] ?? null);
      if (!u) {
        alert("Toggle paid error: updated row not returned (RLS/permission?)");
        return;
      }

      setRows((prev) =>
        prev.map((x) =>
          x.id === r.id
            ? {
                ...x,
                is_paid: toBool(u.is_paid),
                paid_at: u.paid_at ?? null,
                gcash_amount: round2(toNumber(u.gcash_amount)),
                cash_amount: round2(toNumber(u.cash_amount)),
              }
            : x
        )
      );

      setSelected((prev) =>
        prev?.id === r.id
          ? {
              ...prev,
              is_paid: toBool(u.is_paid),
              paid_at: u.paid_at ?? null,
              gcash_amount: round2(toNumber(u.gcash_amount)),
              cash_amount: round2(toNumber(u.cash_amount)),
            }
          : prev
      );

      setSelectedOrderBooking((prev) =>
        prev?.id === r.id
          ? {
              ...prev,
              is_paid: toBool(u.is_paid),
              paid_at: u.paid_at ?? null,
              gcash_amount: round2(toNumber(u.gcash_amount)),
              cash_amount: round2(toNumber(u.cash_amount)),
            }
          : prev
      );
    } catch (e) {
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const openCancelModal = (r: PromoBookingRow): void => {
    setCancelTarget(r);
    setCancelDesc("");
    setCancelError("");
  };

  const runCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const desc = cancelDesc.trim();
    if (!desc) {
      setCancelError("Description / reason is required.");
      return;
    }

    try {
      setCancelling(true);
      setCancellingId(cancelTarget.id);
      setCancelError("");

      const { data, error } = await supabase
        .from("promo_bookings")
        .select(`
          id,
          created_at,
          user_id,
          full_name,
          phone_number,
          area,
          package_id,
          package_option_id,
          seat_number,
          start_at,
          end_at,
          price,
          status,
          gcash_amount,
          cash_amount,
          is_paid,
          paid_at,
          discount_reason,
          discount_kind,
          discount_value,
          promo_code,
          attempts_left,
          max_attempts,
          validity_end_at
        `)
        .eq("id", cancelTarget.id)
        .limit(1);

      if (error) {
        setCancelError(`Failed to load booking: ${error.message}`);
        return;
      }

      const fullRow = ((data ?? []) as unknown as Array<Record<string, unknown>>)[0] ?? null;
      if (!fullRow) {
        setCancelError("Failed to load booking: record not found.");
        return;
      }

      const { error: insErr } = await supabase.from("promo_bookings_cancelled").insert({
        original_id: String(fullRow.id),
        description: desc,

        created_at: fullRow.created_at,
        user_id: (fullRow.user_id as string | null | undefined) ?? null,
        full_name: String(fullRow.full_name ?? ""),
        phone_number: (fullRow.phone_number as string | null | undefined) ?? null,

        area: fullRow.area,
        package_id: fullRow.package_id,
        package_option_id: fullRow.package_option_id,

        seat_number: (fullRow.seat_number as string | null | undefined) ?? null,
        start_at: fullRow.start_at,
        end_at: fullRow.end_at,

        price: fullRow.price ?? 0,
        status: (fullRow.status as string | null | undefined) ?? "pending",

        gcash_amount: fullRow.gcash_amount ?? 0,
        cash_amount: fullRow.cash_amount ?? 0,
        is_paid: Boolean(fullRow.is_paid),
        paid_at: (fullRow.paid_at as string | null | undefined) ?? null,

        discount_reason:
          (fullRow.discount_reason as string | null | undefined) ?? null,
        discount_kind: String(fullRow.discount_kind ?? "none"),
        discount_value: fullRow.discount_value ?? 0,

        promo_code: (fullRow.promo_code as string | null | undefined) ?? null,
        attempts_left: Number(fullRow.attempts_left ?? 0) || 0,
        max_attempts: Number(fullRow.max_attempts ?? 0) || 0,
        validity_end_at:
          (fullRow.validity_end_at as string | null | undefined) ?? null,
      });

      if (insErr) {
        setCancelError(`Cancel save failed: ${insErr.message}`);
        return;
      }

      const { error: delErr } = await supabase
        .from("promo_bookings")
        .delete()
        .eq("id", cancelTarget.id);

      if (delErr) {
        setCancelError(
          `Inserted to cancelled, but delete failed: ${delErr.message}.`
        );
        return;
      }

      setRows((prev) => prev.filter((x) => x.id !== cancelTarget.id));
      setSelected((prev) => (prev?.id === cancelTarget.id ? null : prev));
      setSelectedOrderBooking((prev) =>
        prev?.id === cancelTarget.id ? null : prev
      );
      setCancelTarget(null);

      setAttMap((prev) => {
        const next = { ...prev };
        delete next[cancelTarget.id];
        return next;
      });

      if (cancelTarget.promo_code) {
        setOrdersMap((prev) => {
          const next = { ...prev };
          delete next[cancelTarget.promo_code as string];
          return next;
        });
        setOrderParentsMap((prev) => {
          const next = { ...prev };
          delete next[cancelTarget.promo_code as string];
          return next;
        });
      }
    } catch {
      setCancelError("Cancel failed (unexpected error).");
    } finally {
      setCancelling(false);
      setCancellingId(null);
    }
  };

  const deleteByRange = async (): Promise<void> => {
    if (filteredRows.length === 0) {
      alert("No records to delete for selected filter/range.");
      return;
    }

    const count = filteredRows.length;
    const label = `${rangeMode.toUpperCase()} • ${activeRange.label}`;
    const ok = window.confirm(
      `Delete ALL currently filtered promo records for:\n${label}\n\nArea: ${areaFilter}\nCommon Duration: ${commonDurationFilter}\nConference Duration: ${conferenceDurationFilter}\n\nThis will delete ${count} record(s).`
    );
    if (!ok) return;

    try {
      setDeletingRangeLabel(label);

      const ids = filteredRows.map((r) => r.id);
      const chunkSize = 200;

      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize);
        const { error } = await supabase.from("promo_bookings").delete().in("id", slice);
        if (error) {
          alert(`Delete error: ${error.message}`);
          return;
        }
      }

      setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelected((prev) => (prev && ids.includes(prev.id) ? null : prev));
      setSelectedOrderBooking((prev) =>
        prev && ids.includes(prev.id) ? null : prev
      );

      setAttMap((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    } catch {
      alert("Delete failed.");
    } finally {
      setDeletingRangeLabel(null);
    }
  };

  const openRuleModal = (r: PromoBookingRow): void => {
    if (!canEditRules) return;
    setRuleTarget(r);
    setRuleAttemptsLeftInput(String(Math.max(0, Math.floor(toNumber(r.attempts_left)))));
    setRuleMaxAttemptsInput(String(Math.max(0, Math.floor(toNumber(r.max_attempts)))));
    setRuleValidityInput(r.validity_end_at ? isoToLocalDateTimeInput(r.validity_end_at) : "");
  };

  const saveRule = async (): Promise<void> => {
    if (!ruleTarget) return;
    if (!canEditRules) {
      alert("Only staff/admin can edit attempts/validity.");
      return;
    }

    const attemptsLeft = Math.max(0, Math.floor(toNumber(ruleAttemptsLeftInput)));
    const maxAttempts = Math.max(0, Math.floor(toNumber(ruleMaxAttemptsInput)));

    const fixedMax = maxAttempts;
    const fixedLeft = fixedMax > 0 ? Math.min(attemptsLeft, fixedMax) : attemptsLeft;

    const validityIso = ruleValidityInput.trim()
      ? localDateTimeInputToIso(ruleValidityInput.trim())
      : null;

    try {
      setSavingRule(true);

      const dbRow = await updateBookingThenFetch(
        ruleTarget.id,
        {
          attempts_left: fixedLeft,
          max_attempts: fixedMax,
          validity_end_at: validityIso,
        },
        selectPromoBookings
      );

      const updated = normalizeRow(dbRow);
      setRows((prev) => prev.map((x) => (x.id === ruleTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === ruleTarget.id ? updated : prev));
      setSelectedOrderBooking((prev) =>
        prev?.id === ruleTarget.id ? updated : prev
      );
      setRuleTarget(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save rule failed.";
      alert(`Save rule error: ${msg}`);
    } finally {
      setSavingRule(false);
    }
  };

  const exportToExcel = async (): Promise<void> => {
    if (filteredRows.length === 0) {
      alert("No records for selected filter/range.");
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Me Tyme Lounge";
    wb.created = new Date();

    const ws = wb.addWorksheet("Promo Discounts", {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    ws.columns = [
      { header: "Created At", key: "created_at", width: 20 },
      { header: "Customer", key: "customer", width: 26 },
      { header: "Phone #", key: "phone", width: 16 },
      { header: "Area", key: "area", width: 16 },
      { header: "Seat", key: "seat", width: 16 },
      { header: "Package", key: "pkg", width: 20 },
      { header: "Option", key: "opt", width: 28 },
      { header: "Start", key: "start", width: 20 },
      { header: "End", key: "end", width: 20 },
      { header: "System Cost", key: "system_due", width: 12 },
      { header: "Order Total", key: "order_due", width: 12 },
      { header: "Grand Total", key: "grand_total", width: 12 },
      { header: "System Paid", key: "system_paid", width: 12 },
      { header: "Order Paid", key: "order_paid", width: 12 },
      { header: "Overall Paid", key: "overall_paid", width: 12 },
      { header: "Paid?", key: "paid_status", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Promo Code", key: "code", width: 14 },
      { header: "Attempts Left", key: "attempts_left", width: 12 },
      { header: "Max Attempts", key: "max_attempts", width: 12 },
      { header: "Validity End", key: "validity", width: 20 },
      { header: "Last Attendance", key: "att_last", width: 22 },
    ];

    ws.mergeCells("A1", "V1");
    ws.getCell("A1").value = "ME TYME LOUNGE — ADMIN PROMO REPORT";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(1).height = 26;

    ws.mergeCells("A2", "V2");
    ws.getCell("A2").value =
      `Range: ${rangeMode.toUpperCase()} • ${activeRange.label} | Area: ${areaFilter} | Common Duration: ${commonDurationFilter} | Conference Duration: ${conferenceDurationFilter}`;
    ws.getCell("A2").font = { size: 11 };
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

    ws.getRow(5).height = 6;

    if (isLikelyUrl(logo)) {
      const ab = await fetchAsArrayBuffer(logo);
      if (ab) {
        const ext =
          logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg")
            ? "jpeg"
            : "png";
        const imgId = wb.addImage({ buffer: ab, extension: ext });
        ws.addImage(imgId, { tl: { col: 17.5, row: 0.2 }, ext: { width: 170, height: 60 } });
      }
    }

    const headerRowIndex = 6;
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.values = ws.columns.map((c) => String(c.header ?? ""));
    headerRow.height = 20;

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.border = {
        top: { style: "thin", color: { argb: "FF9CA3AF" } },
        left: { style: "thin", color: { argb: "FF9CA3AF" } },
        bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
        right: { style: "thin", color: { argb: "FF9CA3AF" } },
      };
    });

    filteredRows.forEach((r, idx) => {
      const opt = r.package_options;
      const optionText =
        opt?.option_name && opt?.duration_value && opt?.duration_unit
          ? `${opt.option_name} • ${formatDuration(Number(opt.duration_value), opt.duration_unit)}`
          : opt?.option_name || "—";

      const systemDue = getSystemDue(r);
      const orderDue = getOrderDue(r.promo_code);
      const grandDue = getGrandDue(r);
      const systemPaid = getSystemPaidInfo(r).totalPaid;
      const orderPaid = getOrderPaidInfo(r.promo_code).totalPaid;
      const overallPaid = getGrandPaid(r);

      const lastAtt = (attMap[r.id] ?? [])[0] ?? null;
      const attText = lastAtt
        ? `${attStatus(lastAtt)} • ${new Date(attStamp(lastAtt)).toLocaleString("en-PH")}`
        : "—";

      const row = ws.addRow({
        created_at: new Date(r.created_at).toLocaleString("en-PH"),
        customer: r.full_name,
        phone: safePhone(r.phone_number),
        area: prettyArea(r.area),
        seat: seatLabel(r),
        pkg: r.packages?.title || "—",
        opt: optionText,
        start: new Date(r.start_at).toLocaleString("en-PH"),
        end: new Date(r.end_at).toLocaleString("en-PH"),
        system_due: systemDue,
        order_due: orderDue,
        grand_total: grandDue,
        system_paid: systemPaid,
        order_paid: orderPaid,
        overall_paid: overallPaid,
        paid_status: toBool(r.is_paid) ? "PAID" : "UNPAID",
        status: getStatus(r.start_at, r.end_at, tick),
        code: r.promo_code || "—",
        attempts_left: r.attempts_left,
        max_attempts: r.max_attempts,
        validity: r.validity_end_at ? new Date(r.validity_end_at).toLocaleString("en-PH") : "—",
        att_last: attText,
      });

      const rowIndex = row.number;
      ws.getRow(rowIndex).height = 18;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    });

    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: ws.columns.length },
    };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const safeLabel = `${rangeMode}_${activeRange.label}_${areaFilter}_${commonDurationFilter}_${conferenceDurationFilter}`
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 80);

    saveAs(blob, `admin_promo_records_${safeLabel}.xlsx`);
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Discount / Promo Records</h2>
              <div className="customer-subtext">
                Showing active records for:{" "}
                <strong>
                  {rangeMode.toUpperCase()} • {activeRange.label}
                </strong>
              </div>

              <div className="customer-subtext" style={{ marginTop: 6 }}>
                Total: <strong>₱{round2(totals.total).toFixed(2)}</strong> • Upcoming:{" "}
                <strong>{totals.upcoming}</strong> • Ongoing:{" "}
                <strong>{totals.ongoing}</strong> • Finished:{" "}
                <strong>{totals.finished}</strong>
              </div>

              <div className="customer-subtext" style={{ marginTop: 4, opacity: 0.85 }}>
                Area: <strong>{areaFilter}</strong> • Common Duration:{" "}
                <strong>{commonDurationFilter}</strong> • Conference Duration:{" "}
                <strong>{conferenceDurationFilter}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <label className="date-pill">
                  <span className="date-pill-label">Mode</span>
                  <select
                    className="date-pill-input"
                    value={rangeMode}
                    onChange={(e) =>
                      setRangeMode((e.currentTarget.value as RangeMode) || "day")
                    }
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                  <span className="date-pill-icon" aria-hidden="true">
                    🧭
                  </span>
                </label>

                {rangeMode === "month" ? (
                  <label className="date-pill">
                    <span className="date-pill-label">Month</span>
                    <input
                      className="date-pill-input"
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(String(e.currentTarget.value ?? ""))}
                    />
                    <span className="date-pill-icon" aria-hidden="true">
                      🗓️
                    </span>
                  </label>
                ) : (
                  <label className="date-pill">
                    <span className="date-pill-label">
                      {rangeMode === "week" ? "Week of" : "Date"}
                    </span>
                    <input
                      className="date-pill-input"
                      type="date"
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(String(e.currentTarget.value ?? ""))}
                    />
                    <span className="date-pill-icon" aria-hidden="true">
                      📅
                    </span>
                  </label>
                )}

                <label className="date-pill">
                  <span className="date-pill-label">Area</span>
                  <select
                    className="date-pill-input"
                    value={areaFilter}
                    onChange={(e) => setAreaFilter(e.currentTarget.value as AreaFilter)}
                  >
                    <option value="all">All</option>
                    <option value="common_area">Common Area</option>
                    <option value="conference_room">Conference Room</option>
                  </select>
                </label>

                {areaFilter === "common_area" && (
                  <label className="date-pill">
                    <span className="date-pill-label">Duration</span>
                    <select
                      className="date-pill-input"
                      value={commonDurationFilter}
                      onChange={(e) =>
                        setCommonDurationFilter(
                          e.currentTarget.value as CommonDurationFilter
                        )
                      }
                    >
                      <option value="all">All</option>
                      <option value="1_day">1 Day</option>
                      <option value="week">Week</option>
                      <option value="half_month">Half Month</option>
                      <option value="month">Month</option>
                    </select>
                  </label>
                )}

                {areaFilter === "conference_room" && (
                  <label className="date-pill">
                    <span className="date-pill-label">Duration</span>
                    <select
                      className="date-pill-input"
                      value={conferenceDurationFilter}
                      onChange={(e) =>
                        setConferenceDurationFilter(
                          e.currentTarget.value as ConferenceDurationFilter
                        )
                      }
                    >
                      <option value="all">All</option>
                      <option value="1_hour">1 Hour</option>
                      <option value="3_hours">3 Hours</option>
                      <option value="6_hours">6 Hours</option>
                      <option value="8_hours">8 Hours</option>
                    </select>
                  </label>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                  marginTop: 10,
                }}
              >
                <button
                  className="receipt-btn"
                  onClick={() => void refreshAll()}
                  disabled={loading || refreshing}
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>

                <button
                  className="receipt-btn"
                  onClick={() => void exportToExcel()}
                  disabled={filteredRows.length === 0}
                >
                  Export ({rangeMode.toUpperCase()})
                </button>

                <button
                  className="receipt-btn"
                  onClick={() => void deleteByRange()}
                  disabled={Boolean(deletingRangeLabel) || filteredRows.length === 0}
                  title={`Deletes currently filtered promo_bookings for the selected ${rangeMode}.`}
                >
                  {deletingRangeLabel ? "Deleting..." : `Delete (${rangeMode.toUpperCase()})`}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredRows.length === 0 ? (
            <p className="customer-note">No promo records found for this filter/range</p>
          ) : (
            <div
              className="customer-table-wrap"
              key={`${rangeMode}-${activeRange.startIso}-${areaFilter}-${commonDurationFilter}-${conferenceDurationFilter}`}
              style={{
                maxHeight: "560px",
                overflowY: "auto",
                overflowX: "auto",
              }}
            >
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Area</th>
                    <th>Seat</th>
                    <th>Package</th>
                    <th>Option</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>System Cost</th>
                    <th>Order</th>
                    <th>Discount</th>
                    <th>Status</th>
                    <th>Paid?</th>
                    <th>System Payment</th>
                    <th>Order Payment</th>
                    <th>Code / Rules</th>
                    <th>Attendance</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => {
                    const opt = r.package_options;

                    const optionText =
                      opt?.option_name && opt?.duration_value && opt?.duration_unit
                        ? `${opt.option_name} • ${formatDuration(
                            Number(opt.duration_value),
                            opt.duration_unit
                          )}`
                        : opt?.option_name || "—";

                    const finalPaid = toBool(r.is_paid);

                    const systemDue = getSystemDue(r);
                    const systemPi = getSystemPaidInfo(r);
                    const systemBalance = getSystemRemainingInfo(r);

                    const orderItems = getOrderItems(r.promo_code);
                    const orderDue = getOrderDue(r.promo_code);
                    const orderPi = getOrderPaidInfo(r.promo_code);
                    const orderBalance = getOrderRemainingInfo(r.promo_code);

                    const last = lastLogFor(r.id);
                    const lastState = last ? attStatus(last) : null;
                    const lastTime = last ? fmtPH(attStamp(last)) : "No logs";
                    const showOrderPayment = hasOrder(r.promo_code);

                    return (
                      <tr key={r.id}>
                        <td>{new Date(r.created_at).toLocaleString("en-PH")}</td>
                        <td>{r.full_name}</td>
                        <td>{safePhone(r.phone_number)}</td>
                        <td>{prettyArea(r.area)}</td>
                        <td>{seatLabel(r)}</td>
                        <td>{r.packages?.title || "—"}</td>
                        <td>{optionText}</td>
                        <td>{new Date(r.start_at).toLocaleString("en-PH")}</td>
                        <td>{new Date(r.end_at).toLocaleString("en-PH")}</td>

                        <td>₱{systemDue.toFixed(2)}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{orderDue.toFixed(2)}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {orderItems.length} item{orderItems.length !== 1 ? "s" : ""}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => setSelectedOrderBooking(r)}
                              type="button"
                            >
                              View Order
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              {getDiscountTextFrom(r.discount_kind, r.discount_value)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openDiscountModal(r)}
                              type="button"
                            >
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <strong>{getStatus(r.start_at, r.end_at, tick)}</strong>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${
                              finalPaid ? "pay-badge--paid" : "pay-badge--unpaid"
                            }`}
                            onClick={() => void togglePaid(r)}
                            disabled={togglingPaidId === r.id}
                            title={finalPaid ? "Tap to set UNPAID" : "Tap to set PAID"}
                            type="button"
                          >
                            {togglingPaidId === r.id
                              ? "Updating..."
                              : finalPaid
                              ? "PAID"
                              : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{systemPi.gcash.toFixed(2)} / Cash ₱{systemPi.cash.toFixed(2)}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {systemBalance.label} ₱
                              {(systemBalance.label === "Remaining"
                                ? systemBalance.remaining
                                : systemBalance.change
                              ).toFixed(2)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(r)}
                              disabled={systemDue <= 0}
                              type="button"
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          {showOrderPayment ? (
                            <div className="cell-stack cell-center">
                              <span className="cell-strong">
                                GCash ₱{orderPi.gcash.toFixed(2)} / Cash ₱{orderPi.cash.toFixed(2)}
                              </span>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                {orderBalance.label} ₱
                                {(orderBalance.label === "Remaining"
                                  ? orderBalance.remaining
                                  : orderBalance.change
                                ).toFixed(2)}
                              </span>
                              <button
                                className="receipt-btn"
                                onClick={() => openOrderPaymentModal(r)}
                                type="button"
                              >
                                Order Payment
                              </button>
                            </div>
                          ) : (
                            <span style={{ opacity: 0.75 }}>No Order</span>
                          )}
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{r.promo_code || "—"}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              Attempts Left: <b>{r.attempts_left}</b> / Max: <b>{r.max_attempts}</b>
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              Validity:{" "}
                              <b>
                                {r.validity_end_at
                                  ? new Date(r.validity_end_at).toLocaleString("en-PH")
                                  : "—"}
                              </b>
                              {r.validity_end_at && isExpired(r.validity_end_at) ? (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: "#b00020",
                                    fontWeight: 900,
                                  }}
                                >
                                  EXPIRED
                                </span>
                              ) : null}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openRuleModal(r)}
                              disabled={!canEditRules}
                              type="button"
                            >
                              Edit
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{lastState ? lastState : "—"}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>{lastTime}</span>
                            <button
                              className="receipt-btn"
                              onClick={() => setAttModalTarget(r)}
                              type="button"
                            >
                              Attendance
                            </button>
                          </div>
                        </td>

                        <td>{(r.discount_reason ?? "").trim() || "—"}</td>

                        <td>
                          <div className="action-stack">
                            <button
                              className="receipt-btn"
                              onClick={() => setSelected(r)}
                              type="button"
                            >
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn"
                              disabled={cancelling || cancellingId === r.id}
                              onClick={() => openCancelModal(r)}
                              type="button"
                            >
                              {cancellingId === r.id ? "Cancelling..." : "Cancel"}
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

          {selectedOrderBooking && (
            <div className="receipt-overlay" onClick={() => setSelectedOrderBooking(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ORDER LIST</h3>
                <p className="receipt-subtitle">
                  {selectedOrderBooking.full_name} • Code:{" "}
                  <b>{selectedOrderBooking.promo_code || "—"}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Area</span>
                  <span>{prettyArea(selectedOrderBooking.area)}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{seatLabel(selectedOrderBooking)}</span>
                </div>

                {(() => {
                  const orderDue = getOrderDue(selectedOrderBooking.promo_code);
                  const orderPaid = getOrderPaidInfo(selectedOrderBooking.promo_code);
                  const orderBalance = getOrderRemainingInfo(selectedOrderBooking.promo_code);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Order Total</span>
                        <span>₱{orderDue.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{orderPaid.totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{orderBalance.label}</span>
                        <span>
                          ₱
                          {(orderBalance.label === "Remaining"
                            ? orderBalance.remaining
                            : orderBalance.change
                          ).toFixed(2)}
                        </span>
                      </div>
                    </>
                  );
                })()}

                <hr />

                {getOrderItems(selectedOrderBooking.promo_code).length === 0 ? (
                  <div style={{ textAlign: "center", opacity: 0.7, padding: "12px 0" }}>
                    No order items found.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      maxHeight: 420,
                      overflowY: "auto",
                      paddingRight: 4,
                    }}
                  >
                    {getOrderItems(selectedOrderBooking.promo_code).map((item) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                        style={{
                                                    display: "grid",
                          gridTemplateColumns: "72px 1fr",
                          gap: 12,
                          alignItems: "start",
                          padding: 10,
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.55)",
                        }}
                      >
                        <div
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: 12,
                            overflow: "hidden",
                            background: "#e9e9e9",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                          }}
                        >
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <span>No Image</span>
                          )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>{item.name}</div>
                          <div style={{ opacity: 0.8, fontSize: 13, marginTop: 2 }}>
                            {item.category || (item.kind === "add_on" ? "Add-on" : "Consignment")}
                            {String(item.size ?? "").trim() ? ` • ${item.size}` : ""}
                            {item.kind === "consignment" ? " • Consignment" : " • Add-On"}
                          </div>

                          <div
                            style={{
                              marginTop: 8,
                              display: "grid",
                              gap: 3,
                              fontSize: 13,
                            }}
                          >
                            <div>
                              Qty: <strong>{item.quantity}</strong>
                            </div>
                            <div>
                              Price: <strong>₱{item.price.toFixed(2)}</strong>
                            </div>
                            <div>
                              Subtotal: <strong>₱{item.subtotal.toFixed(2)}</strong>
                            </div>
                          </div>

                          <div style={{ marginTop: 10 }}>
                            <button
                              className="receipt-btn admin-danger"
                              onClick={() => openOrderCancelModal(selectedOrderBooking, item)}
                              disabled={cancellingOrderItemId === item.id}
                              type="button"
                            >
                              Cancel Item
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button
                    className="close-btn"
                    onClick={() => setSelectedOrderBooking(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {orderCancelTarget && (
            <div
              className="receipt-overlay"
              onClick={() =>
                cancellingOrderItemId ? null : setOrderCancelTarget(null)
              }
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL ORDER ITEM</h3>
                <p className="receipt-subtitle">{orderCancelTarget.item.name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{orderCancelTarget.booking.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{seatLabel(orderCancelTarget.booking)}</span>
                </div>

                <div className="receipt-row">
                  <span>Type</span>
                  <span>
                    {orderCancelTarget.item.kind === "add_on" ? "Add-On" : "Consignment"}
                  </span>
                </div>

                <div className="receipt-row">
                  <span>Qty</span>
                  <span>{orderCancelTarget.item.quantity}</span>
                </div>

                <div className="receipt-row">
                  <span>Subtotal</span>
                  <span>₱{orderCancelTarget.item.subtotal.toFixed(2)}</span>
                </div>

                <hr />

                <div className="receipt-row" style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontWeight: 800 }}>Cancel Note (required)</span>
                  <textarea
                    className="reason-input"
                    value={orderCancelNote}
                    onChange={(e) => setOrderCancelNote(e.currentTarget.value)}
                    placeholder="e.g. Customer removed item / wrong item / out of stock..."
                    rows={4}
                    style={{ width: "100%", resize: "vertical" }}
                    disabled={Boolean(cancellingOrderItemId)}
                  />
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    This cancelled item will be archived in{" "}
                    <strong>
                      {orderCancelTarget.item.kind === "add_on"
                        ? "customer_session_add_ons_cancelled"
                        : "consignment_cancelled"}
                    </strong>
                    .
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    className="receipt-btn"
                    onClick={() => setOrderCancelTarget(null)}
                    disabled={Boolean(cancellingOrderItemId)}
                    type="button"
                  >
                    Back
                  </button>

                  <button
                    className="receipt-btn"
                    onClick={() => void submitOrderItemCancel()}
                    disabled={
                      Boolean(cancellingOrderItemId) ||
                      orderCancelNote.trim().length === 0
                    }
                    type="button"
                  >
                    {cancellingOrderItemId ? "Cancelling..." : "Submit Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {attModalTarget && (
            <div className="receipt-overlay" onClick={() => setAttModalTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ATTENDANCE LOGS</h3>
                <p className="receipt-subtitle">
                  {attModalTarget.full_name} • Code: <b>{attModalTarget.promo_code || "—"}</b>
                </p>

                <hr />

                <div style={{ fontWeight: 900, marginBottom: 10 }}>Recent Days</div>

                {logsFor(attModalTarget.id).length === 0 ? (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>No attendance logs.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {logsFor(attModalTarget.id).map((h) => {
                      const status = attStatus(h);
                      return (
                        <div
                          key={h.id}
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            padding: 10,
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div style={{ fontWeight: 1000 }}>
                              {status} • {h.local_day}
                            </div>
                            <div
                              style={{
                                fontWeight: 900,
                                opacity: 0.8,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h.auto_out ? "AUTO OUT" : "—"}
                            </div>
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            <b>IN:</b> {fmtPH(h.in_at)}
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            <b>OUT:</b> {h.out_at ? fmtPH(h.out_at) : "—"}
                          </div>

                          {h.note ? (
                            <div style={{ fontSize: 12, opacity: 0.85 }}>{h.note}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button
                    className="receipt-btn"
                    onClick={() => setAttModalTarget(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {ruleTarget && (
            <div
              className="receipt-overlay"
              onClick={() => (savingRule ? null : setRuleTarget(null))}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">EDIT CODE RULES</h3>
                <p className="receipt-subtitle">
                  {ruleTarget.full_name} • Code: <b>{ruleTarget.promo_code || "—"}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Attempts Left</span>
                  <input
                    className="money-input"
                    type="number"
                    min="0"
                    step="1"
                    value={ruleAttemptsLeftInput}
                    onChange={(e) => setRuleAttemptsLeftInput(e.currentTarget.value)}
                    disabled={savingRule}
                    placeholder="0"
                  />
                </div>

                <div className="receipt-row" style={{ marginTop: 10 }}>
                  <span>Max Attempts</span>
                  <input
                    className="money-input"
                    type="number"
                    min="0"
                    step="1"
                    value={ruleMaxAttemptsInput}
                    onChange={(e) => setRuleMaxAttemptsInput(e.currentTarget.value)}
                    disabled={savingRule}
                    placeholder="0"
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  If max = 0, it will be treated as "no limit".
                </div>

                <div className="receipt-row" style={{ marginTop: 10 }}>
                  <span>Validity End</span>
                  <input
                    className="money-input"
                    type="datetime-local"
                    value={ruleValidityInput}
                    onChange={(e) => setRuleValidityInput(e.currentTarget.value)}
                    disabled={savingRule}
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  If blank = no expiry.
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button
                    className="receipt-btn"
                    onClick={() => setRuleTarget(null)}
                    disabled={savingRule}
                    type="button"
                  >
                    Close
                  </button>
                  <button
                    className="receipt-btn"
                    onClick={() => void saveRule()}
                    disabled={savingRule}
                    type="button"
                  >
                    {savingRule ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {cancelTarget && (
            <div
              className="receipt-overlay"
              onClick={() => (cancelling ? null : setCancelTarget(null))}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL PROMO</h3>
                <p className="receipt-subtitle">
                  {cancelTarget.full_name} • {safePhone(cancelTarget.phone_number)}
                </p>

                <hr />

                <div className="receipt-row" style={{ alignItems: "flex-start" }}>
                  <span style={{ paddingTop: 6 }}>Description</span>
                  <div style={{ width: "100%" }}>
                    <textarea
                      className="reason-input"
                      style={{ width: "100%", minHeight: 90, resize: "vertical" }}
                      value={cancelDesc}
                      onChange={(e) => setCancelDesc(e.currentTarget.value)}
                      placeholder="Required: reason / description for cancellation..."
                      disabled={cancelling}
                    />
                    {cancelError ? (
                      <div style={{ marginTop: 8, color: "#b00020", fontSize: 12 }}>
                        {cancelError}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    className="receipt-btn"
                    onClick={() => setCancelTarget(null)}
                    disabled={cancelling}
                    type="button"
                  >
                    Close
                  </button>
                  <button
                    className="receipt-btn"
                    onClick={() => void runCancel()}
                    disabled={cancelling}
                    type="button"
                  >
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">SYSTEM PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} • {safePhone(paymentTarget.phone_number)}
                </p>

                <hr />

                {(() => {
                  const due = getSystemDue(paymentTarget);
                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willSystemPaid = due <= 0 ? true : totalPaid >= due;
                  const orderOk = !hasOrder(paymentTarget.promo_code)
                    ? true
                    : (() => {
                        const od = getOrderDue(paymentTarget.promo_code);
                        const op = getOrderPaidInfo(paymentTarget.promo_code).totalPaid;
                        return od <= 0 ? true : op >= od;
                      })();

                  const finalAutoPaid = willSystemPaid && orderOk;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>System Due</span>
                        <span>₱{due.toFixed(2)}</span>
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
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{isChange ? "Change" : "Remaining"}</span>
                        <span>₱{remainingAbs.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Paid</span>
                        <span className="receipt-status">
                          {willSystemPaid ? "YES" : "NO"}
                        </span>
                      </div>

                      <div className="receipt-row">
                        <span>Final Promo Paid</span>
                        <span className="receipt-status">
                          {finalAutoPaid ? "PAID" : "UNPAID"}
                        </span>
                      </div>

                      <div className="modal-actions">
                        <button
                          className="receipt-btn"
                          onClick={() => setPaymentTarget(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="receipt-btn"
                          onClick={() => void savePayment()}
                          disabled={savingPayment}
                          type="button"
                        >
                          {savingPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {orderPaymentTarget && (
            <div
              className="receipt-overlay"
              onClick={() => setOrderPaymentTarget(null)}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ORDER PAYMENT</h3>
                <p className="receipt-subtitle">
                  {orderPaymentTarget.full_name} • Code:{" "}
                  {orderPaymentTarget.promo_code || "—"}
                </p>

                <hr />

                {(() => {
                  const due = getOrderDue(orderPaymentTarget.promo_code);
                  const currentPaid = getOrderPaidInfo(orderPaymentTarget.promo_code);

                  const g = moneyFromStr(orderGcashInput);
                  const c = moneyFromStr(orderCashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willOrderPaid = due <= 0 ? true : totalPaid >= due;
                  const systemOk = (() => {
                    const sd = getSystemDue(orderPaymentTarget);
                    const sp = getSystemPaidInfo(orderPaymentTarget).totalPaid;
                    return sd <= 0 ? true : sp >= sd;
                  })();

                  const finalAutoPaid = systemOk && willOrderPaid;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Order Due</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={orderGcashInput}
                          onChange={(e) => setOrderGcashInput(e.currentTarget.value)}
                        />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={orderCashInput}
                          onChange={(e) => setOrderCashInput(e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Current Saved Paid</span>
                        <span>₱{currentPaid.totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{isChange ? "Change" : "Remaining"}</span>
                        <span>₱{remainingAbs.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Order Paid</span>
                        <span className="receipt-status">
                          {willOrderPaid ? "YES" : "NO"}
                        </span>
                      </div>

                      <div className="receipt-row">
                        <span>Final Promo Paid</span>
                        <span className="receipt-status">
                          {finalAutoPaid ? "PAID" : "UNPAID"}
                        </span>
                      </div>

                      <div className="modal-actions">
                        <button
                          className="receipt-btn"
                          onClick={() => setOrderPaymentTarget(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="receipt-btn"
                          onClick={() => void saveOrderPayment()}
                          disabled={savingOrderPayment}
                          type="button"
                        >
                          {savingOrderPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {discountTarget && (
            <div className="receipt-overlay" onClick={() => setDiscountTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DISCOUNT</h3>
                <p className="receipt-subtitle">
                  {discountTarget.full_name} • {safePhone(discountTarget.phone_number)}
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Discount Type</span>
                  <select
                    value={discountKind}
                    onChange={(e) =>
                      setDiscountKind((e.currentTarget.value as DiscountKind) || "none")
                    }
                  >
                    <option value="none">None</option>
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Peso (₱)</option>
                  </select>
                </div>

                <div className="receipt-row">
                  <span>Value</span>
                  <div className="inline-input">
                    <span className="inline-input-prefix">
                      {discountKind === "percent"
                        ? "%"
                        : discountKind === "amount"
                        ? "₱"
                        : ""}
                    </span>
                    <input
                      className="small-input"
                      type="number"
                      min="0"
                      step={discountKind === "percent" ? "1" : "0.01"}
                      value={discountValueInput}
                      onChange={(e) => setDiscountValueInput(e.currentTarget.value)}
                      disabled={discountKind === "none"}
                    />
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Reason</span>
                  <input
                    className="reason-input"
                    type="text"
                    value={discountReasonInput}
                    onChange={(e) => setDiscountReasonInput(e.currentTarget.value)}
                    placeholder="e.g. loyalty card"
                  />
                </div>

                {(() => {
                  const base = round2(Math.max(0, toNumber(discountTarget.price)));
                  const rawVal = toNumber(discountValueInput);
                  const val =
                    discountKind === "percent"
                      ? clamp(Math.max(0, rawVal), 0, 100)
                      : Math.max(0, rawVal);

                  const { discountedCost, discountAmount } = applyDiscount(
                    base,
                    discountKind,
                    val
                  );
                  const due = round2(discountedCost);

                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willSystemPaid = due <= 0 ? true : totalPaid >= due;
                  const orderOk = !hasOrder(discountTarget.promo_code)
                    ? true
                    : (() => {
                        const od = getOrderDue(discountTarget.promo_code);
                        const op = getOrderPaidInfo(discountTarget.promo_code).totalPaid;
                        return od <= 0 ? true : op >= od;
                      })();

                  const finalAutoPaid = willSystemPaid && orderOk;

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, val)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW SYSTEM BALANCE</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current Payment</span>
                        <span>
                          GCash ₱{g.toFixed(2)} / Cash ₱{c.toFixed(2)}
                        </span>
                      </div>

                      <div className="receipt-row">
                        <span>{isChange ? "Change" : "Remaining"}</span>
                        <span>₱{remainingAbs.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final Promo Paid</span>
                        <span className="receipt-status">
                          {finalAutoPaid ? "PAID" : "UNPAID"}
                        </span>
                      </div>

                      <div className="modal-actions">
                        <button
                          className="receipt-btn"
                          onClick={() => setDiscountTarget(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="receipt-btn"
                          onClick={() => void saveDiscount()}
                          disabled={savingDiscount}
                          type="button"
                        >
                          {savingDiscount ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {selected && (
            <div className="receipt-overlay" onClick={() => setSelected(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} className="receipt-logo" alt="logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">PROMO RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Status</span>
                  <span>{getStatus(selected.start_at, selected.end_at, tick)}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer Name</span>
                  <span>{selected.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Phone #</span>
                  <span>{safePhone(selected.phone_number)}</span>
                </div>

                <div className="receipt-row">
                  <span>Promo Code</span>
                  <span style={{ fontWeight: 900 }}>{selected.promo_code || "—"}</span>
                </div>

                <div className="receipt-row">
                  <span>Attempts Left</span>
                  <span>
                    {selected.attempts_left} / {selected.max_attempts}
                  </span>
                </div>

                <div className="receipt-row">
                  <span>Validity End</span>
                  <span>
                    {selected.validity_end_at
                      ? new Date(selected.validity_end_at).toLocaleString("en-PH")
                      : "—"}
                    {selected.validity_end_at && isExpired(selected.validity_end_at) ? (
                      <span style={{ marginLeft: 8, color: "#b00020", fontWeight: 900 }}>
                        EXPIRED
                      </span>
                    ) : null}
                  </span>
                </div>

                <hr />

                <div style={{ fontWeight: 900, marginBottom: 8 }}>Attendance Logs</div>

                {logsFor(selected.id).length === 0 ? (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>No attendance logs.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {logsFor(selected.id)
                      .slice(0, 10)
                      .map((h) => (
                        <div
                          key={h.id}
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            padding: 10,
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div style={{ fontWeight: 1000 }}>
                            {attStatus(h)} • {h.local_day} {h.auto_out ? "• AUTO OUT" : ""}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            <b>IN:</b> {fmtPH(h.in_at)}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            <b>OUT:</b> {h.out_at ? fmtPH(h.out_at) : "—"}
                          </div>
                          {h.note ? (
                            <div style={{ fontSize: 12, opacity: 0.85 }}>{h.note}</div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                )}

                <hr />

                <div className="receipt-row">
                  <span>Area</span>
                  <span>{prettyArea(selected.area)}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{seatLabel(selected)}</span>
                </div>

                <hr />

                <div className="receipt-row">
                  <span>Package</span>
                  <span>{selected.packages?.title || "—"}</span>
                </div>

                <div className="receipt-row">
                  <span>Option</span>
                  <span>{selected.package_options?.option_name || "—"}</span>
                </div>

                {selected.package_options?.duration_value &&
                selected.package_options?.duration_unit ? (
                  <div className="receipt-row">
                    <span>Duration</span>
                    <span>
                      {formatDuration(
                        Number(selected.package_options.duration_value),
                        selected.package_options.duration_unit
                      )}
                    </span>
                  </div>
                ) : null}

                <hr />

                <div className="receipt-row">
                  <span>Start</span>
                  <span>{new Date(selected.start_at).toLocaleString("en-PH")}</span>
                </div>

                <div className="receipt-row">
                  <span>End</span>
                  <span>{new Date(selected.end_at).toLocaleString("en-PH")}</span>
                </div>

                <hr />

                {(() => {
                  const base = round2(Math.max(0, toNumber(selected.price)));
                  const { discountedCost, discountAmount } = applyDiscount(
                    base,
                    selected.discount_kind,
                    selected.discount_value
                  );
                  const systemDue = round2(discountedCost);

                  const systemPi = getSystemPaidInfo(selected);
                  const systemRemainingSigned = round2(systemDue - systemPi.totalPaid);
                  const systemIsChange = systemRemainingSigned < 0;
                  const systemRemainingAbs = round2(Math.abs(systemRemainingSigned));

                  const orderItems = getOrderItems(selected.promo_code);
                  const showOrderSection = hasOrder(selected.promo_code);
                  const orderDue = getOrderDue(selected.promo_code);
                  const orderPi = getOrderPaidInfo(selected.promo_code);

                  const orderBalance = getOrderRemainingInfo(selected.promo_code);
                  const finalPaid = toBool(selected.is_paid);

                  return (
                    <>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>
                        System Cost Payment
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>
                          {getDiscountTextFrom(
                            selected.discount_kind,
                            selected.discount_value
                          )}
                        </span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost</span>
                        <span>₱{systemDue.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>₱{systemPi.gcash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>₱{systemPi.cash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{systemPi.totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{systemIsChange ? "Change" : "Remaining"}</span>
                        <span>₱{systemRemainingAbs.toFixed(2)}</span>
                      </div>

                      {showOrderSection ? (
                        <>
                          <hr />
                          <div style={{ fontWeight: 900, marginBottom: 8 }}>Orders</div>

                          {orderItems.length === 0 ? (
                            <div style={{ opacity: 0.8, fontSize: 13, marginBottom: 8 }}>
                              No order items found.
                            </div>
                          ) : (
                            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                              {orderItems.map((it) => (
                                <div
                                  key={`${it.kind}-${it.id}`}
                                  style={{
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    borderRadius: 12,
                                    padding: 10,
                                    display: "grid",
                                    gap: 6,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "60px 1fr",
                                      gap: 10,
                                      alignItems: "start",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 60,
                                        height: 60,
                                        borderRadius: 10,
                                        overflow: "hidden",
                                        background: "#e9e9e9",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 11,
                                      }}
                                    >
                                      {it.image_url ? (
                                        <img
                                          src={it.image_url}
                                          alt={it.name}
                                          style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                          }}
                                        />
                                      ) : (
                                        <span>No Image</span>
                                      )}
                                    </div>

                                    <div>
                                      <div style={{ fontWeight: 900 }}>
                                        {it.name} {it.size ? `(${it.size})` : ""}
                                      </div>
                                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                                        {it.kind === "add_on" ? "Add-on" : "Consignment"}
                                        {it.category ? ` • ${it.category}` : ""}
                                      </div>
                                      <div style={{ fontSize: 12, opacity: 0.9 }}>
                                        Qty: <b>{it.quantity}</b> • Price:{" "}
                                        <b>₱{it.price.toFixed(2)}</b> • Subtotal:{" "}
                                        <b>₱{it.subtotal.toFixed(2)}</b>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ fontWeight: 900, marginBottom: 8 }}>Order Payment</div>

                          <div className="receipt-row">
                            <span>Order Total</span>
                            <span>₱{orderDue.toFixed(2)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>GCash</span>
                            <span>₱{orderPi.gcash.toFixed(2)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Cash</span>
                            <span>₱{orderPi.cash.toFixed(2)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Total Paid</span>
                            <span>₱{orderPi.totalPaid.toFixed(2)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>{orderBalance.label}</span>
                            <span>
                              ₱
                              {(orderBalance.label === "Remaining"
                                ? orderBalance.remaining
                                : orderBalance.change
                              ).toFixed(2)}
                            </span>
                          </div>
                        </>
                      ) : null}

                      <hr />

                      <div className="receipt-row">
                        <span>Paid Status</span>
                        <span className="receipt-status">
                          {finalPaid ? "PAID" : "UNPAID"}
                        </span>
                      </div>

                      <div className="receipt-total">
                        <span>TOTAL SYSTEM COST</span>
                        <span>₱{systemDue.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total" style={{ marginTop: 8 }}>
                        <span>TOTAL ORDER</span>
                        <span>₱{orderDue.toFixed(2)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Overall Paid</span>
                        <span>₱{getGrandPaid(selected).toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{getGrandBalanceInfo(selected).label}</span>
                        <span>
                          ₱
                          {(
                            getGrandBalanceInfo(selected).label === "Overall Remaining"
                              ? getGrandBalanceInfo(selected).remaining
                              : getGrandBalanceInfo(selected).change
                          ).toFixed(2)}
                        </span>
                      </div>

                      <div className="receipt-total" style={{ marginTop: 8 }}>
                        <span>GRAND TOTAL</span>
                        <span>₱{getGrandDue(selected).toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}

                <button
                  className="close-btn"
                  onClick={() => setSelected(null)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Customer_Discount_List;