// src/pages/Customer_Reservations.tsx
// ✅ SAME STYLE/CLASSNAMES as Customer_Lists.tsx
// ✅ Shows ONLY RESERVATION records (reservation = "yes")
// ✅ Seat column INCLUDED
// ✅ Booking Code INCLUDED
// ✅ Order INCLUDED
// ✅ System Payment + Order Payment INCLUDED
// ✅ Receipt layout now matches Customer_Lists style
// ✅ Discount UI same as Customer_Lists (breakdown)
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Payment is based on TIME CONSUMED (System Cost after discount) — ❌ DOES NOT deduct Down Payment
// ✅ Down Payment column between Discount and Payment
// ✅ Down Payment is EDITABLE (modal) and saved to DB: customer_sessions.down_payment
// ✅ Receipt auto-updates balance/change after DP edit
// ✅ Phone # column beside Full Name
// ✅ View to Customer is REALTIME using SINGLE ROW customer_view_state (id=1)
// ✅ Search bar (Full Name only)
// ✅ Stop Time for OPEN sessions (also releases seat_blocked_times end_at = now)
// ✅ CANCEL SAME AS Customer_Lists (ID-BASED, NO RPC)
// ✅ Payment modal FREE INPUTS (NO LIMIT) — Cash & GCash can exceed due
// ✅ REFRESH button beside DATE FILTER
// ✅ No "any"
// ✅ ALL MONEY VALUES are WHOLE NUMBERS ONLY
// ✅ If value has decimal, ALWAYS ROUND UP
// ✅ REMOVED FROM UI: customer_field, id_number, Field column, Specific ID column
// ✅ SORT BY TIME IN ASCENDING (earliest first)
// ✅ NEW FILTER LOGIC:
// - Search by Full Name
// - ONE date input only
// - ONE dropdown to choose date basis:
//    1) Reserved On  -> created_at
//    2) Start Date   -> reservation_date
// ✅ AREA FILTER REMOVED

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;
const VIEW_ROW_ID = 1;

type CustomerViewRow = {
  id: number;
  session_id: string | null;
  enabled: boolean;
  updated_at: string | null;
};

type DiscountKind = "none" | "percent" | "amount";
type DateFilterMode = "reserved_on" | "start_date";

interface CustomerSession {
  id: string;
  created_at?: string | null;
  staff_id?: string | null;
  date: string;
  full_name: string;
  phone_number?: string | null;
  customer_type: string;
  customer_field?: string | null;
  has_id: boolean;
  hour_avail: string;
  time_started: string;
  time_ended: string;
  total_time: number;
  total_amount: number;
  reservation: string;
  reservation_date: string | null;
  reservation_end_date?: string | null;
  id_number?: string | null;
  seat_number: string;
  promo_booking_id?: string | null;
  booking_code?: string | null;
  discount_kind?: DiscountKind;
  discount_value?: number | string;
  discount_reason?: string | null;
  gcash_amount?: number | string;
  cash_amount?: number | string;
  is_paid?: boolean | number | string | null;
  paid_at?: string | null;
  down_payment?: number | string | null;
  expected_end_at?: string | null;
}

type CustomerOrderPayment = {
  id: string;
  booking_code: string;
  full_name: string;
  seat_number: string;
  order_total: number | string;
  gcash_amount: number | string;
  cash_amount: number | string;
  is_paid: boolean | number | string | null;
  paid_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AddonCatalogMini = {
  id: string;
  name: string;
  category: string | null;
  size: string | null;
  image_url: string | null;
};

type ConsignmentCatalogMini = {
  id: string;
  item_name: string;
  category: string | null;
  size: string | null;
  image_url: string | null;
};

type AddonOrderItemRow = {
  id: string;
  created_at?: string | null;
  add_on_id: string;
  item_name: string;
  price: number | string;
  quantity: number | string;
  subtotal?: number | string | null;
  add_ons?: AddonCatalogMini | null;
};

type AddonOrderRow = {
  id: string;
  booking_code: string;
  full_name: string;
  seat_number: string;
  total_amount: number | string;
  addon_order_items?: AddonOrderItemRow[] | null;
};

type ConsignmentOrderItemRow = {
  id: string;
  created_at?: string | null;
  consignment_id: string;
  item_name: string;
  price: number | string;
  quantity: number | string;
  subtotal?: number | string | null;
  consignment?: ConsignmentCatalogMini | null;
};

type ConsignmentOrderRow = {
  id: string;
  booking_code: string;
  full_name: string;
  seat_number: string;
  total_amount: number | string;
  consignment_order_items?: ConsignmentOrderItemRow[] | null;
};

type OrderItemView = {
  id: string;
  parent_order_id: string;
  source: "addon" | "consignment";
  source_item_id: string;
  name: string;
  category: string;
  size: string | null;
  qty: number;
  price: number;
  subtotal: number;
  image_url: string | null;
  created_at: string | null;
};

type SessionOrdersMap = Record<
  string,
  {
    addonOrders: AddonOrderRow[];
    consignmentOrders: ConsignmentOrderRow[];
    items: OrderItemView[];
    total: number;
  }
>;

type CancelOrderTarget = {
  session: CustomerSession;
  item: OrderItemView;
};

type SeatBlockedRow = {
  id: string;
  seat_number: string;
  start_at: string;
  end_at: string;
  source: string;
  note: string | null;
};

type AttendanceLogRow = {
  id: string;
  session_id: string;
  booking_code: string;
  attendance_date: string;
  in_at: string;
  out_at: string | null;
  note: string | null;
  auto_closed: boolean;
  created_at: string;
};

type AttendanceStateMap = Record<
  string,
  {
    openLog: AttendanceLogRow | null;
  }
>;
/* ---------- raw select row types for strict TS ---------- */

type RawAddonCatalogMini = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  size?: unknown;
  image_url?: unknown;
};

type RawConsignmentCatalogMini = {
  id?: unknown;
  item_name?: unknown;
  category?: unknown;
  size?: unknown;
  image_url?: unknown;
};

type RawAddonOrderItemRow = {
  id?: unknown;
  created_at?: unknown;
  add_on_id?: unknown;
  item_name?: unknown;
  price?: unknown;
  quantity?: unknown;
  subtotal?: unknown;
  add_ons?: RawAddonCatalogMini | RawAddonCatalogMini[] | null;
};

type RawAddonOrderRow = {
  id?: unknown;
  booking_code?: unknown;
  full_name?: unknown;
  seat_number?: unknown;
  total_amount?: unknown;
  addon_order_items?: RawAddonOrderItemRow[] | null;
};

type RawConsignmentOrderItemRow = {
  id?: unknown;
  created_at?: unknown;
  consignment_id?: unknown;
  item_name?: unknown;
  price?: unknown;
  quantity?: unknown;
  subtotal?: unknown;
  consignment?: RawConsignmentCatalogMini | RawConsignmentCatalogMini[] | null;
};

type RawConsignmentOrderRow = {
  id?: unknown;
  booking_code?: unknown;
  full_name?: unknown;
  seat_number?: unknown;
  total_amount?: unknown;
  consignment_order_items?: RawConsignmentOrderItemRow[] | null;
};

/* ---------- helpers ---------- */


const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const rangeDatesInclusive = (startYmd: string, endYmd: string): string[] => {
  const start = new Date(`${startYmd}T00:00:00`);
  const end = new Date(`${endYmd}T00:00:00`);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const cur = new Date(start);

  while (cur.getTime() <= end.getTime()) {
    out.push(yyyyMmDdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }

  return out;
};

const getClockFromIso = (iso: string): { hours: number; minutes: number } => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { hours: 0, minutes: 0 };
  return {
    hours: d.getHours(),
    minutes: d.getMinutes(),
  };
};



const endOfLocalDayIso = (yyyyMmDd: string): string => {
  const m = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString();

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  return new Date(y, mo, d, 23, 59, 59, 999).toISOString();
};

const addDurationToIso = (startIso: string, durationHHMM: string): string => {
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return startIso;

  const [hRaw, mRaw] = durationHHMM.split(":");
  const dh = Number(hRaw);
  const dm = Number(mRaw);

  if (!Number.isFinite(dh) || !Number.isFinite(dm)) return startIso;

  return new Date(start.getTime() + (dh * 60 + dm) * 60_000).toISOString();
};

const clampToReservationDay = (endIso: string, reservationDate?: string | null): string => {
  if (!reservationDate) return endIso;

  const eod = endOfLocalDayIso(reservationDate);
  const endMs = new Date(endIso).getTime();
  const eodMs = new Date(eod).getTime();

  if (!Number.isFinite(endMs) || !Number.isFinite(eodMs)) return endIso;
  return endMs > eodMs ? eod : endIso;
};

const buildReservationSeatWindowsFromSession = (
  session: CustomerSession
): Array<{ date: string; startIso: string; endIso: string }> => {
  const startDate = String(session.reservation_date ?? "").trim();
  const endDate = String(session.reservation_end_date ?? "").trim() || startDate;

  if (!startDate || !endDate) return [];

  const days = rangeDatesInclusive(startDate, endDate);
  if (days.length === 0) return [];

  const { hours, minutes } = getClockFromIso(session.time_started);
  const openTime = String(session.hour_avail ?? "").trim().toUpperCase() === "OPEN";

  return days.map((day) => {
    const [y, m, d] = day.split("-").map(Number);
    const startIso = new Date(y, (m ?? 1) - 1, d ?? 1, hours, minutes, 0, 0).toISOString();

    if (openTime) {
      return {
        date: day,
        startIso,
        endIso: endOfLocalDayIso(day),
      };
    }

    const endIso = clampToReservationDay(
      addDurationToIso(startIso, String(session.hour_avail ?? "00:00")),
      day
    );

    return {
      date: day,
      startIso,
      endIso,
    };
  });
};

const formatDateDisplay = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-GB");
};

const getReservationEndDate = (s: CustomerSession): string | null => {
  const end = String(s.reservation_end_date ?? "").trim();
  if (end) return end;

  const start = String(s.reservation_date ?? "").trim();
  return start || null;
};

const isDateWithinReservationRange = (
  filterYmd: string,
  startYmd: string | null | undefined,
  endYmd: string | null | undefined
): boolean => {
  const start = String(startYmd ?? "").trim();
  const end = String(endYmd ?? "").trim() || start;
  const target = String(filterYmd ?? "").trim();

  if (!target || !start) return false;
  return target >= start && target <= end;
};

const formatReservationRange = (s: CustomerSession): string => {
  const start = String(s.reservation_date ?? "").trim();
  const end = String(s.reservation_end_date ?? "").trim();

  if (!start && !end) return "—";
  if (start && end && start !== end) {
    return `${formatDateDisplay(start)} → ${formatDateDisplay(end)}`;
  }

  return formatDateDisplay(start || end);
};

const formatTimeText = (iso: string): string => {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const wholePeso = (n: number): number =>
  Math.ceil(Math.max(0, Number.isFinite(n) ? n : 0));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const toText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};

const normalizeSingleRelation = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const toAddonCatalogMini = (raw: RawAddonCatalogMini | null | undefined): AddonCatalogMini | null => {
  if (!raw) return null;
  return {
    id: toText(raw.id),
    name: toText(raw.name),
    category: toText(raw.category) || null,
    size: toText(raw.size) || null,
    image_url: toText(raw.image_url) || null,
  };
};

const toConsignmentCatalogMini = (
  raw: RawConsignmentCatalogMini | null | undefined
): ConsignmentCatalogMini | null => {
  if (!raw) return null;
  return {
    id: toText(raw.id),
    item_name: toText(raw.item_name),
    category: toText(raw.category) || null,
    size: toText(raw.size) || null,
    image_url: toText(raw.image_url) || null,
  };
};

const toAddonOrderItemRow = (raw: RawAddonOrderItemRow): AddonOrderItemRow => {
  const catalog = normalizeSingleRelation(raw.add_ons);
  return {
    id: toText(raw.id),
    created_at: toText(raw.created_at) || null,
    add_on_id: toText(raw.add_on_id),
    item_name: toText(raw.item_name),
    price: toMoney(raw.price),
    quantity: toMoney(raw.quantity),
    subtotal: raw.subtotal == null ? null : toMoney(raw.subtotal),
    add_ons: toAddonCatalogMini(catalog),
  };
};

const toConsignmentOrderItemRow = (raw: RawConsignmentOrderItemRow): ConsignmentOrderItemRow => {
  const catalog = normalizeSingleRelation(raw.consignment);
  return {
    id: toText(raw.id),
    created_at: toText(raw.created_at) || null,
    consignment_id: toText(raw.consignment_id),
    item_name: toText(raw.item_name),
    price: toMoney(raw.price),
    quantity: toMoney(raw.quantity),
    subtotal: raw.subtotal == null ? null : toMoney(raw.subtotal),
    consignment: toConsignmentCatalogMini(catalog),
  };
};

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${wholePeso(v)}`;
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
    const discRaw = (cost * pct) / 100;
    const finalRaw = Math.max(0, cost - discRaw);
    return {
      discountedCost: wholePeso(finalRaw),
      discountAmount: wholePeso(discRaw),
    };
  }

  if (kind === "amount") {
    const discRaw = Math.min(cost, v);
    const finalRaw = Math.max(0, cost - discRaw);
    return {
      discountedCost: wholePeso(finalRaw),
      discountAmount: wholePeso(discRaw),
    };
  }

  return {
    discountedCost: wholePeso(cost),
    discountAmount: 0,
  };
};

const setCustomerViewState = async (
  enabled: boolean,
  sessionId: string | null
): Promise<void> => {
  const payload: CustomerViewRow = {
    id: VIEW_ROW_ID,
    enabled,
    session_id: enabled ? sessionId : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("customer_view_state")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
};

const isCustomerViewOnForSession = (
  active: CustomerViewRow | null,
  sessionId: string
): boolean => {
  if (!active) return false;
  if (!active.enabled) return false;
  return String(active.session_id ?? "") === String(sessionId);
};

const splitSeats = (seatStr: string): string[] => {
  return String(seatStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toUpperCase() !== "N/A");
};

const getLocalDateFromIso = (iso: string | null | undefined): string => {
  const d = new Date(String(iso ?? ""));
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const Customer_Reservations: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

    const getAttendanceOpenLog = (s: CustomerSession): AttendanceLogRow | null => {
    return attendanceState[s.id]?.openLog ?? null;
  };

  const getReservationLiveMinutesFromAttendance = (s: CustomerSession): number => {
    const openLog = getAttendanceOpenLog(s);
    if (!openLog) return 0;

    const start = new Date(openLog.in_at).getTime();
    const now = Date.now();

    if (!Number.isFinite(start) || now <= start) return 0;
    return Math.floor((now - start) / (1000 * 60));
  };

  const getClosedMinutesFromSession = (s: CustomerSession): number => {
    return Math.max(0, Math.floor(toMoney(s.total_time) * 60));
  };

  const getReservationTotalUsedMinutes = (s: CustomerSession): number => {
    const closedMinutes = getClosedMinutesFromSession(s);
    const liveMinutes = getReservationLiveMinutesFromAttendance(s);
    return closedMinutes + liveMinutes;
  };

  const getReservationLiveCostFromAttendance = (s: CustomerSession): number => {
    const liveMinutes = getReservationLiveMinutesFromAttendance(s);
    const chargeMinutes = Math.max(0, liveMinutes - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return wholePeso(chargeMinutes * perMinute);
  };

  const getReservationAccumulatedCost = (s: CustomerSession): number => {
    return wholePeso(Math.max(0, toMoney(s.total_amount)));
  };

  const isReservationCurrentlyIn = (s: CustomerSession): boolean => {
    return getAttendanceOpenLog(s) !== null;
  };

  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [selectedOrderSession, setSelectedOrderSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<CustomerViewRow | null>(null);
  const [viewBusy, setViewBusy] = useState<boolean>(false);

  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>("start_date");
  const [filterDate, setFilterDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [searchName, setSearchName] = useState<string>("");

  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  // SYSTEM PAYMENT
  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // ORDER PAYMENT
  const [orderPaymentTarget, setOrderPaymentTarget] = useState<CustomerSession | null>(null);
  const [orderGcashInput, setOrderGcashInput] = useState<string>("0");
  const [orderCashInput, setOrderCashInput] = useState<string>("0");
  const [savingOrderPayment, setSavingOrderPayment] = useState<boolean>(false);

  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [cancelTarget, setCancelTarget] = useState<CustomerSession | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancellingBusy, setCancellingBusy] = useState<boolean>(false);

  const [orderCancelTarget, setOrderCancelTarget] = useState<CancelOrderTarget | null>(null);
  const [orderCancelNote, setOrderCancelNote] = useState<string>("");
  const [cancellingOrderItemId, setCancellingOrderItemId] = useState<string | null>(null);

  const [sessionOrders, setSessionOrders] = useState<SessionOrdersMap>({});
  const [orderPayments, setOrderPayments] = useState<Record<string, CustomerOrderPayment>>({});
  const [attendanceState, setAttendanceState] = useState<AttendanceStateMap>({});

  useEffect(() => {
    void initLoad();
    void readActiveCustomerView();
    const unsub = subscribeCustomerViewRealtime();

    return () => {
      try {
        if (typeof unsub === "function") unsub();
      } catch {
        //
      }
    };
  }, []);

  useEffect(() => {
  const hasOpenAttendance = sessions.some(
    (s) => String(s.reservation).toLowerCase() === "yes" && isReservationCurrentlyIn(s)
  );

  if (!hasOpenAttendance) return;

  const timer = window.setInterval(() => {
    setSessions((prev) => [...prev]);
  }, 30000);

  return () => window.clearInterval(timer);
}, [sessions, attendanceState]);

const initLoad = async (): Promise<void> => {
  setLoading(true);
  try {
    const loadedSessions = await fetchReservationSessions();
    await fetchOrdersForSessions(loadedSessions);
    await fetchOrderPayments(loadedSessions);
    await fetchAttendanceStateForSessions(loadedSessions);
    await syncSessionPaidStates(loadedSessions);
  } finally {
    setLoading(false);
  }
};

const filteredSessions = useMemo(() => {
  const q = searchName.trim().toLowerCase();

  return sessions
    .filter((s) => {
      if (filterDate) {
        if (dateFilterMode === "reserved_on") {
          const createdLocalDate = getLocalDateFromIso(s.created_at ?? "");
          if (createdLocalDate !== filterDate) return false;
        } else {
          const startDate = String(s.reservation_date ?? "").trim();
          const endDate = getReservationEndDate(s);
          if (!isDateWithinReservationRange(filterDate, startDate, endDate)) {
            return false;
          }
        }
      }

      if (!q) return true;
      const name = String(s.full_name ?? "").toLowerCase();
      return name.includes(q);
    })
    .sort((a, b) => {
      const aTime = new Date(a.time_started).getTime();
      const bTime = new Date(b.time_started).getTime();

      const aValid = Number.isFinite(aTime);
      const bValid = Number.isFinite(bTime);

      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;

      return aTime - bTime;
    });
}, [sessions, filterDate, dateFilterMode, searchName]);

  const fetchReservationSessions = async (): Promise<CustomerSession[]> => {
    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "yes")
      .order("reservation_date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading reservations");
      setSessions([]);
      return [];
    }

    const rows = ((data ?? []) as CustomerSession[]) || [];
    setSessions(rows);
    return rows;
  };

  const fetchOrdersForSessions = async (rows: CustomerSession[]): Promise<void> => {
    const codes = Array.from(
      new Set(
        rows
          .map((s) => String(s.booking_code ?? "").trim().toUpperCase())
          .filter((x) => x.length > 0)
      )
    );

    if (codes.length === 0) {
      setSessionOrders({});
      return;
    }

    const [addonRes, consignmentRes] = await Promise.all([
      supabase
        .from("addon_orders")
        .select(`
          id,
          booking_code,
          full_name,
          seat_number,
          total_amount,
          addon_order_items (
            id,
            created_at,
            add_on_id,
            item_name,
            price,
            quantity,
            subtotal,
            add_ons (
              id,
              name,
              category,
              size,
              image_url
            )
          )
        `)
        .in("booking_code", codes),

      supabase
        .from("consignment_orders")
        .select(`
          id,
          booking_code,
          full_name,
          seat_number,
          total_amount,
          consignment_order_items (
            id,
            created_at,
            consignment_id,
            item_name,
            price,
            quantity,
            subtotal,
            consignment (
              id,
              item_name,
              category,
              size,
              image_url
            )
          )
        `)
        .in("booking_code", codes),
    ]);

    if (addonRes.error) {
      console.error("addon_orders fetch error:", addonRes.error);
    }

    if (consignmentRes.error) {
      console.error("consignment_orders fetch error:", consignmentRes.error);
    }

    const addonOrders: AddonOrderRow[] = ((addonRes.data ?? []) as RawAddonOrderRow[]).map((raw) => ({
      id: toText(raw.id),
      booking_code: toText(raw.booking_code).trim().toUpperCase(),
      full_name: toText(raw.full_name),
      seat_number: toText(raw.seat_number),
      total_amount: toMoney(raw.total_amount),
      addon_order_items: Array.isArray(raw.addon_order_items)
        ? raw.addon_order_items.map(toAddonOrderItemRow)
        : [],
    }));

    const consignmentOrders: ConsignmentOrderRow[] = ((consignmentRes.data ?? []) as RawConsignmentOrderRow[]).map(
      (raw) => ({
        id: toText(raw.id),
        booking_code: toText(raw.booking_code).trim().toUpperCase(),
        full_name: toText(raw.full_name),
        seat_number: toText(raw.seat_number),
        total_amount: toMoney(raw.total_amount),
        consignment_order_items: Array.isArray(raw.consignment_order_items)
          ? raw.consignment_order_items.map(toConsignmentOrderItemRow)
          : [],
      })
    );

    const nextMap: SessionOrdersMap = {};

    for (const code of codes) {
      const aOrders = addonOrders.filter((o) => o.booking_code === code);
      const cOrders = consignmentOrders.filter((o) => o.booking_code === code);

      const items: OrderItemView[] = [];

      for (const o of aOrders) {
        for (const item of o.addon_order_items ?? []) {
          const qty = wholePeso(toMoney(item.quantity));
          const price = wholePeso(toMoney(item.price));
          const subtotal = wholePeso(toMoney(item.subtotal ?? qty * price));

          items.push({
            id: item.id,
            parent_order_id: o.id,
            source: "addon",
            source_item_id: item.add_on_id,
            name: String(item.item_name ?? item.add_ons?.name ?? "").trim() || "-",
            category: String(item.add_ons?.category ?? "").trim() || "Add-On",
            size: item.add_ons?.size ?? null,
            qty,
            price,
            subtotal,
            image_url: item.add_ons?.image_url ?? null,
            created_at: item.created_at ?? null,
          });
        }
      }

      for (const o of cOrders) {
        for (const item of o.consignment_order_items ?? []) {
          const qty = wholePeso(toMoney(item.quantity));
          const price = wholePeso(toMoney(item.price));
          const subtotal = wholePeso(toMoney(item.subtotal ?? qty * price));

          items.push({
            id: item.id,
            parent_order_id: o.id,
            source: "consignment",
            source_item_id: item.consignment_id,
            name: String(item.item_name ?? item.consignment?.item_name ?? "").trim() || "-",
            category: String(item.consignment?.category ?? "").trim() || "Consignment",
            size: item.consignment?.size ?? null,
            qty,
            price,
            subtotal,
            image_url: item.consignment?.image_url ?? null,
            created_at: item.created_at ?? null,
          });
        }
      }

      const totalAddon = aOrders.reduce((sum, o) => sum + wholePeso(toMoney(o.total_amount)), 0);
      const totalConsignment = cOrders.reduce((sum, o) => sum + wholePeso(toMoney(o.total_amount)), 0);

      nextMap[code] = {
        addonOrders: aOrders,
        consignmentOrders: cOrders,
        items,
        total: wholePeso(totalAddon + totalConsignment),
      };
    }

    setSessionOrders(nextMap);
  };

    const fetchOrderPayments = async (rows: CustomerSession[]): Promise<void> => {
      const codes = Array.from(
        new Set(
          rows
            .map((s) => String(s.booking_code ?? "").trim().toUpperCase())
            .filter(Boolean)
        )
      );

      if (codes.length === 0) {
        setOrderPayments({});
        return;
      }

      const { data, error } = await supabase
        .from("customer_order_payments")
        .select("*")
        .in("booking_code", codes);

      if (error) {
        console.error("customer_order_payments fetch error:", error);
        setOrderPayments({});
        return;
      }

      const map: Record<string, CustomerOrderPayment> = {};

      for (const row of (data ?? []) as CustomerOrderPayment[]) {
        const code = String(row.booking_code ?? "").trim().toUpperCase();
        if (!code) continue;
        map[code] = row;
      }

      setOrderPayments(map);
    };

    const fetchAttendanceStateForSessions = async (
    rows: CustomerSession[]
  ): Promise<void> => {
    const sessionIds = Array.from(
      new Set(rows.map((s) => String(s.id)).filter((x) => x.length > 0))
    );

    if (sessionIds.length === 0) {
      setAttendanceState({});
      return;
    }

    const { data, error } = await supabase
      .from("customer_session_attendance")
      .select("*")
      .in("session_id", sessionIds)
      .order("in_at", { ascending: false });

    if (error) {
      console.error("customer_session_attendance fetch error:", error);
      setAttendanceState({});
      return;
    }

    const logs = (data ?? []) as AttendanceLogRow[];
    const nextMap: AttendanceStateMap = {};

    for (const s of rows) {
      const sessionLogs = logs.filter((log) => log.session_id === s.id);
      const openLog = sessionLogs.find((log) => !log.out_at) ?? null;

      nextMap[s.id] = {
        openLog,
      };
    }

    setAttendanceState(nextMap);
  };

  const readActiveCustomerView = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("customer_view_state")
      .select("id, session_id, enabled, updated_at")
      .eq("id", VIEW_ROW_ID)
      .maybeSingle();

    if (error) {
      console.error("readActiveCustomerView error:", error);
      setActiveView(null);
      return;
    }

    if (!data) {
      try {
        await setCustomerViewState(false, null);

        const retry = await supabase
          .from("customer_view_state")
          .select("id, session_id, enabled, updated_at")
          .eq("id", VIEW_ROW_ID)
          .maybeSingle();

        if (!retry.error) {
          setActiveView((retry.data ?? null) as CustomerViewRow | null);
        }
      } catch (e) {
        console.error("ensure view row failed:", e);
      }
      return;
    }

    setActiveView((data ?? null) as CustomerViewRow | null);
  };

  const subscribeCustomerViewRealtime = (): (() => void) => {
    const channel = supabase
      .channel("customer_view_state_changes_customer_reservations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_view_state" },
        () => {
          void readActiveCustomerView();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  };

const refreshAll = async (): Promise<void> => {
  try {
    setRefreshing(true);
    const loadedSessions = await fetchReservationSessions();
    await Promise.all([
      fetchOrdersForSessions(loadedSessions),
      fetchOrderPayments(loadedSessions),
      fetchAttendanceStateForSessions(loadedSessions),
      readActiveCustomerView(),
    ]);
    await syncSessionPaidStates(loadedSessions);
  } finally {
    setRefreshing(false);
  }
};

  const clearFilters = (): void => {
    setDateFilterMode("start_date");
    setFilterDate(yyyyMmDdLocal(new Date()));
    setSearchName("");
  };

  const phoneText = (s: CustomerSession): string => {
    const p = String(s.phone_number ?? "").trim();
    return p || "N/A";
  };

  const getDownPayment = (s: CustomerSession): number =>
    wholePeso(Math.max(0, toMoney(s.down_payment ?? 0)));

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999;
  };

  const diffMinutes = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.floor((end - start) / (1000 * 60));
  };

  const computeHours = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    const hours = (end - start) / (1000 * 60 * 60);
    return Number(hours.toFixed(2));
  };

  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return wholePeso(chargeMinutes * perMinute);
  };

  const getLiveTotalCost = (s: CustomerSession): number => {
    const nowIso = new Date().toISOString();
    return computeCostWithFreeMinutes(s.time_started, nowIso);
  };

const getBaseSystemCost = (s: CustomerSession): number => {
  if (String(s.reservation).toLowerCase() === "yes") {
    const accumulated = getReservationAccumulatedCost(s);
    const live = getReservationLiveCostFromAttendance(s);
    return wholePeso(accumulated + live);
  }

  return isOpenTimeSession(s) ? getLiveTotalCost(s) : wholePeso(toMoney(s.total_amount));
};

  const getDiscountInfo = (
    s: CustomerSession
  ): { kind: DiscountKind; value: number; reason: string } => {
    const kind = (s.discount_kind ?? "none") as DiscountKind;
    const value = toMoney(s.discount_value ?? 0);
    const reason = String(s.discount_reason ?? "").trim();
    return { kind, value, reason };
  };

  const getDiscountText = (s: CustomerSession): string => {
    const di = getDiscountInfo(s);
    return getDiscountTextFrom(di.kind, di.value);
  };

  const getSessionSystemCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return wholePeso(applyDiscount(base, di.kind, di.value).discountedCost);
  };

  const getOrderBundle = (s: CustomerSession) => {
    const code = String(s.booking_code ?? "").trim().toUpperCase();
    return (
      sessionOrders[code] ?? {
        addonOrders: [],
        consignmentOrders: [],
        items: [],
        total: 0,
      }
    );
  };

  const getOrdersTotal = (s: CustomerSession): number => {
    return wholePeso(getOrderBundle(s).total);
  };

  const hasOrders = (s: CustomerSession): boolean => getOrdersTotal(s) > 0;

  const getSystemPaymentInfo = (
    s: CustomerSession
  ): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = wholePeso(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = wholePeso(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = wholePeso(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const getOrderPaymentRow = (s: CustomerSession): CustomerOrderPayment | null => {
    const code = String(s.booking_code ?? "").trim().toUpperCase();
    if (!code) return null;
    return orderPayments[code] ?? null;
  };

  const getOrderPaymentInfo = (
    s: CustomerSession
  ): { gcash: number; cash: number; totalPaid: number; isPaid: boolean } => {
    const row = getOrderPaymentRow(s);
    const gcash = wholePeso(Math.max(0, toMoney(row?.gcash_amount ?? 0)));
    const cash = wholePeso(Math.max(0, toMoney(row?.cash_amount ?? 0)));
    const totalPaid = wholePeso(gcash + cash);
    const isPaid = toBool(row?.is_paid ?? false);
    return { gcash, cash, totalPaid, isPaid };
  };

  const getSystemDue = (s: CustomerSession): number => {
    return wholePeso(Math.max(0, getSessionSystemCost(s)));
  };

  const getOrderDue = (s: CustomerSession): number => {
    return wholePeso(Math.max(0, getOrdersTotal(s)));
  };

  const getGrandDue = (s: CustomerSession): number => {
    const systemCost = getSystemDue(s);
    const ordersTotal = getOrderDue(s);
    return wholePeso(systemCost + ordersTotal);
  };

  const getSystemRemaining = (s: CustomerSession): number => {
    const due = getSystemDue(s);
    const paid = getSystemPaymentInfo(s).totalPaid;
    return wholePeso(Math.max(0, due - paid));
  };

  const getOrderRemaining = (s: CustomerSession): number => {
    const due = getOrderDue(s);
    const paid = getOrderPaymentInfo(s).totalPaid;
    return wholePeso(Math.max(0, due - paid));
  };

  const getSessionBalanceAfterDP = (s: CustomerSession): number => {
    const grandDue = getGrandDue(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, grandDue - dp));
  };

  const getSessionChangeAfterDP = (s: CustomerSession): number => {
    const grandDue = getGrandDue(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, dp - grandDue));
  };

  const getDisplayAmount = (
    s: CustomerSession
  ): { label: "Total Balance" | "Total Change"; value: number } => {
    const balance = getSessionBalanceAfterDP(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getSystemIsPaid = (s: CustomerSession): boolean => {
    const due = getSystemDue(s);
    const paid = getSystemPaymentInfo(s).totalPaid;
    return due <= 0 ? true : paid >= due;
  };

  const getOrderIsPaid = (s: CustomerSession): boolean => {
    const due = getOrderDue(s);
    if (due <= 0) return true;
    const paid = getOrderPaymentInfo(s).totalPaid;
    return paid >= due;
  };

  const getFinalPaidStatus = (s: CustomerSession): boolean => {
    const systemPaid = getSystemIsPaid(s);
    const orderPaid = hasOrders(s) ? getOrderIsPaid(s) : true;
    return systemPaid && orderPaid;
  };

  const syncSingleSessionPaidState = async (s: CustomerSession): Promise<void> => {
    const finalPaid = getFinalPaidStatus(s);

    if (toBool(s.is_paid) === finalPaid) return;

    const { data, error } = await supabase
      .from("customer_sessions")
      .update({
        is_paid: finalPaid,
        paid_at: finalPaid ? new Date().toISOString() : null,
      })
      .eq("id", s.id)
      .select("*")
      .single();

    if (!error && data) {
      const updated = data as CustomerSession;
      setSessions((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSelectedSession((prev) => (prev?.id === updated.id ? updated : prev));
      setSelectedOrderSession((prev) => (prev?.id === updated.id ? updated : prev));
    }
  };

  const syncSessionPaidStates = async (rows: CustomerSession[]): Promise<void> => {
    for (const s of rows) {
      try {
        await syncSingleSessionPaidState(s);
      } catch (e) {
        console.error("syncSingleSessionPaidState error:", e);
      }
    }
  };

const releaseSeatBlocksNow = async (
  session: CustomerSession,
  nowIso: string,
  mode: "stop" | "cancel" = "stop"
): Promise<void> => {
  const seats = splitSeats(session.seat_number);
  if (seats.length === 0) return;

  const windows = buildReservationSeatWindowsFromSession(session);

  if (windows.length === 0) {
    console.warn("releaseSeatBlocksNow: no reservation windows built");
    return;
  }

  const firstStart = windows[0].startIso;
  const lastEnd = windows[windows.length - 1].endIso;

  const { data, error } = await supabase
    .from("seat_blocked_times")
    .select("id, seat_number, start_at, end_at, source, note")
    .in("seat_number", seats)
    .eq("source", "reserved")
    .gte("start_at", firstStart)
    .lte("end_at", lastEnd);

  if (error) {
    console.warn("releaseSeatBlocksNow select:", error.message);
    return;
  }

  const rows = (data ?? []) as SeatBlockedRow[];

  const expectedKeys = new Set<string>();
  windows.forEach((w) => {
    seats.forEach((seat) => {
      expectedKeys.add(`${seat}__${w.startIso}__${w.endIso}`);
    });
  });

  const matchedRows = rows.filter((r) =>
    expectedKeys.has(`${String(r.seat_number).trim()}__${r.start_at}__${r.end_at}`)
  );

  if (matchedRows.length > 0) {
    const ids = matchedRows.map((r) => r.id);

    if (mode === "cancel") {
      const { error: delErr } = await supabase
        .from("seat_blocked_times")
        .delete()
        .in("id", ids);

      if (delErr) {
        console.warn("releaseSeatBlocksNow delete:", delErr.message);
      }
    } else {
      const { error: upErr } = await supabase
        .from("seat_blocked_times")
        .update({ end_at: nowIso, note: "stopped/cancelled" })
        .in("id", ids)
        .gt("end_at", nowIso);

      if (upErr) {
        console.warn("releaseSeatBlocksNow update:", upErr.message);
      }
    }

    return;
  }

  // fallback only if exact rows were not found
  if (mode === "cancel") {
    const { error: fallbackDelErr } = await supabase
      .from("seat_blocked_times")
      .delete()
      .in("seat_number", seats)
      .eq("source", "reserved")
      .gte("start_at", firstStart)
      .lte("end_at", lastEnd);

    if (fallbackDelErr) {
      console.warn("releaseSeatBlocksNow fallback delete:", fallbackDelErr.message);
    }
  } else {
    const { error: fallbackUpErr } = await supabase
      .from("seat_blocked_times")
      .update({ end_at: nowIso, note: "stopped/cancelled (fallback)" })
      .in("seat_number", seats)
      .eq("source", "reserved")
      .gte("start_at", firstStart)
      .lte("end_at", lastEnd)
      .gt("end_at", nowIso);

    if (fallbackUpErr) {
      console.warn("releaseSeatBlocksNow fallback update:", fallbackUpErr.message);
    }
  }
};

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalHours = computeHours(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalHours,
          total_amount: totalCost,
          hour_avail: "CLOSED",
        })
        .eq("id", session.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      await releaseSeatBlocksNow(session, nowIso);

      const updatedRow = updated as CustomerSession;
      setSessions((prev) => prev.map((s) => (s.id === session.id ? updatedRow : s)));
      setSelectedSession((prev) => (prev?.id === session.id ? updatedRow : prev));
      await syncSingleSessionPaidState(updatedRow);
    } catch (e) {
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "OPEN";
    const t = formatTimeText(s.time_ended);
    return t || "—";
  };

const renderStatus = (s: CustomerSession): string => {
  if (String(s.reservation).toLowerCase() === "yes") {
    return isReservationCurrentlyIn(s) ? "IN" : "OUT";
  }

  if (isOpenTimeSession(s)) return "Ongoing";
  const end = new Date(s.time_ended);
  if (!Number.isFinite(end.getTime())) return "Finished";
  return new Date() > end ? "Finished" : "Ongoing";
};

const getUsedMinutesForReceipt = (s: CustomerSession): number => {
  if (String(s.reservation).toLowerCase() === "yes") {
    return getReservationTotalUsedMinutes(s);
  }

  if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date().toISOString());
  return diffMinutes(s.time_started, s.time_ended);
};

  const getChargeMinutesForReceipt = (s: CustomerSession): number => {
    const used = getUsedMinutesForReceipt(s);
    return Math.max(0, used - FREE_MINUTES);
  };

  const openDiscountModal = (s: CustomerSession): void => {
    const di = getDiscountInfo(s);
    setDiscountTarget(s);
    setDiscountKind(di.kind);
    setDiscountInput(String(Number.isFinite(di.value) ? di.value : 0));
    setDiscountReason(di.reason);
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const raw = Number(discountInput);
    const clean = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const finalValue = discountKind === "percent" ? clamp(clean, 0, 100) : clean;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),
        })
        .eq("id", discountTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save discount error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updatedRow = updated as CustomerSession;
      setSessions((prev) => prev.map((s) => (s.id === discountTarget.id ? updatedRow : s)));
      setSelectedSession((prev) => (prev?.id === discountTarget.id ? updatedRow : prev));
      setDiscountTarget(null);
      await syncSingleSessionPaidState(updatedRow);
    } catch (e) {
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  const openDpModal = (s: CustomerSession): void => {
    setDpTarget(s);
    setDpInput(String(getDownPayment(s)));
  };

  const saveDownPayment = async (): Promise<void> => {
    if (!dpTarget) return;

    const raw = Number(dpInput);
    const dp = wholePeso(Math.max(0, Number.isFinite(raw) ? raw : 0));

    try {
      setSavingDp(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({ down_payment: dp })
        .eq("id", dpTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save down payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updatedRow = updated as CustomerSession;
      setSessions((prev) => prev.map((s) => (s.id === dpTarget.id ? updatedRow : s)));
      setSelectedSession((prev) => (prev?.id === dpTarget.id ? updatedRow : prev));
      setDpTarget(null);
      await syncSingleSessionPaidState(updatedRow);
    } catch (e) {
      console.error(e);
      alert("Save down payment failed.");
    } finally {
      setSavingDp(false);
    }
  };

  const openPaymentModal = (s: CustomerSession): void => {
    const pi = getSystemPaymentInfo(s);
    setPaymentTarget(s);
    setGcashInput(String(pi.gcash));
    setCashInput(String(pi.cash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const g = wholePeso(Math.max(0, toMoney(gcashInput)));
    const c = wholePeso(Math.max(0, toMoney(cashInput)));
    const totalPaid = wholePeso(g + c);
    const due = getSystemDue(paymentTarget);
    const systemPaid = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const currentFinal = getFinalPaidStatus(paymentTarget);
      const orderPaid = hasOrders(paymentTarget) ? getOrderIsPaid(paymentTarget) : true;
      const nextFinalPaid = systemPaid && orderPaid;

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          gcash_amount: g,
          cash_amount: c,
          is_paid: nextFinalPaid,
          paid_at: nextFinalPaid ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updatedRow = updated as CustomerSession;
      setSessions((prev) => prev.map((s) => (s.id === paymentTarget.id ? updatedRow : s)));
      setSelectedSession((prev) => (prev?.id === paymentTarget.id ? updatedRow : prev));
      setPaymentTarget(null);

      if (currentFinal !== nextFinalPaid) {
        await syncSingleSessionPaidState(updatedRow);
      }
    } catch (e) {
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  const ensureOrderPaymentRow = async (
    session: CustomerSession
  ): Promise<CustomerOrderPayment | null> => {
    const bookingCode = String(session.booking_code ?? "").trim().toUpperCase();
    if (!bookingCode) {
      alert("No booking code found for this customer.");
      return null;
    }

    const orderTotal = getOrderDue(session);

    const payload = {
      booking_code: bookingCode,
      full_name: session.full_name,
      seat_number: session.seat_number || "N/A",
      order_total: orderTotal,
    };

    const { error } = await supabase
      .from("customer_order_payments")
      .upsert(payload, { onConflict: "booking_code" });

    if (error) {
      console.error(error);
      alert(`Failed to prepare order payment row: ${error.message}`);
      return null;
    }

    const { data, error: fetchErr } = await supabase
      .from("customer_order_payments")
      .select("*")
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (fetchErr || !data) {
      alert(`Failed to read order payment row: ${fetchErr?.message ?? "Not found"}`);
      return null;
    }

    const row = data as CustomerOrderPayment;
    setOrderPayments((prev) => ({
      ...prev,
      [bookingCode]: row,
    }));

    return row;
  };

  const openOrderPaymentModal = async (s: CustomerSession): Promise<void> => {
    if (!hasOrders(s)) return;

    const row = await ensureOrderPaymentRow(s);
    if (!row) return;

    setOrderPaymentTarget(s);
    setOrderGcashInput(String(wholePeso(Math.max(0, toMoney(row.gcash_amount ?? 0)))));
    setOrderCashInput(String(wholePeso(Math.max(0, toMoney(row.cash_amount ?? 0)))));
  };

  const saveOrderPayment = async (): Promise<void> => {
    if (!orderPaymentTarget) return;

    const bookingCode = String(orderPaymentTarget.booking_code ?? "").trim().toUpperCase();
    if (!bookingCode) {
      alert("Missing booking code.");
      return;
    }

    const due = getOrderDue(orderPaymentTarget);
    const gcash = wholePeso(Math.max(0, toMoney(orderGcashInput)));
    const cash = wholePeso(Math.max(0, toMoney(orderCashInput)));
    const totalPaid = wholePeso(gcash + cash);
    const orderPaid = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingOrderPayment(true);

      const { data: paymentRow, error: payErr } = await supabase
        .from("customer_order_payments")
        .upsert(
          {
            booking_code: bookingCode,
            full_name: orderPaymentTarget.full_name,
            seat_number: orderPaymentTarget.seat_number || "N/A",
            order_total: due,
            gcash_amount: gcash,
            cash_amount: cash,
            is_paid: orderPaid,
            paid_at: orderPaid ? new Date().toISOString() : null,
          },
          { onConflict: "booking_code" }
        )
        .select("*")
        .single();

      if (payErr || !paymentRow) {
        alert(`Save order payment error: ${payErr?.message ?? "Unknown error"}`);
        return;
      }

      setOrderPayments((prev) => ({
        ...prev,
        [bookingCode]: paymentRow as CustomerOrderPayment,
      }));

      const systemPaid = getSystemIsPaid(orderPaymentTarget);
      const nextFinalPaid = systemPaid && orderPaid;

      const { data: updatedSession, error: updErr } = await supabase
        .from("customer_sessions")
        .update({
          is_paid: nextFinalPaid,
          paid_at: nextFinalPaid ? new Date().toISOString() : null,
        })
        .eq("id", orderPaymentTarget.id)
        .select("*")
        .single();

      if (updErr || !updatedSession) {
        alert(`Order payment saved, but session paid sync failed: ${updErr?.message ?? "Unknown error"}`);
        return;
      }

      const updatedRow = updatedSession as CustomerSession;
      setSessions((prev) => prev.map((s) => (s.id === updatedRow.id ? updatedRow : s)));
      setSelectedSession((prev) => (prev?.id === updatedRow.id ? updatedRow : prev));
      setSelectedOrderSession((prev) => (prev?.id === updatedRow.id ? updatedRow : prev));
      setOrderPaymentTarget(null);
    } catch (e) {
      console.error(e);
      alert("Save order payment failed.");
    } finally {
      setSavingOrderPayment(false);
    }
  };

  const togglePaid = async (s: CustomerSession): Promise<void> => {
    try {
      setTogglingPaidId(s.id);

      const currentPaid = toBool(s.is_paid);
      const nextPaid = !currentPaid;

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .eq("id", s.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Toggle paid error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updatedRow = updated as CustomerSession;
      setSessions((prev) => prev.map((x) => (x.id === s.id ? updatedRow : x)));
      setSelectedSession((prev) => (prev?.id === s.id ? updatedRow : prev));
    } catch (e) {
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const openCancelModal = (s: CustomerSession): void => {
    setCancelTarget(s);
    setCancelReason("");
  };

  const openOrderCancelModal = (session: CustomerSession, item: OrderItemView): void => {
    setOrderCancelTarget({ session, item });
    setOrderCancelNote("");
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

    const newTotal = wholePeso(
      rows.reduce((sum, r) => {
        const subtotal = toMoney(r.subtotal ?? toMoney(r.price) * toMoney(r.quantity));
        return sum + subtotal;
      }, 0)
    );

    const { error: updParentErr } = await supabase
      .from("addon_orders")
      .update({ total_amount: newTotal })
      .eq("id", parentOrderId);

    if (updParentErr) throw updParentErr;
  };

  const recalcConsignmentParentAfterDelete = async (parentOrderId: string): Promise<void> => {
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

    const newTotal = wholePeso(
      rows.reduce((sum, r) => {
        const subtotal = toMoney(r.subtotal ?? toMoney(r.price) * toMoney(r.quantity));
        return sum + subtotal;
      }, 0)
    );

    const { error: updParentErr } = await supabase
      .from("consignment_orders")
      .update({ total_amount: newTotal })
      .eq("id", parentOrderId);

    if (updParentErr) throw updParentErr;
  };

  const refreshOrderPaymentTotalForSession = async (session: CustomerSession): Promise<void> => {
    const bookingCode = String(session.booking_code ?? "").trim().toUpperCase();
    if (!bookingCode) return;

    const newOrderTotal = getOrderDue(session);

    const existing = getOrderPaymentRow(session);
    if (!existing && newOrderTotal <= 0) return;

    const gcash = wholePeso(Math.max(0, toMoney(existing?.gcash_amount ?? 0)));
    const cash = wholePeso(Math.max(0, toMoney(existing?.cash_amount ?? 0)));
    const totalPaid = wholePeso(gcash + cash);
    const isPaid = newOrderTotal <= 0 ? true : totalPaid >= newOrderTotal;

    const { data, error } = await supabase
      .from("customer_order_payments")
      .upsert(
        {
          booking_code: bookingCode,
          full_name: session.full_name,
          seat_number: session.seat_number || "N/A",
          order_total: newOrderTotal,
          gcash_amount: gcash,
          cash_amount: cash,
          is_paid: isPaid,
          paid_at: isPaid ? new Date().toISOString() : null,
        },
        { onConflict: "booking_code" }
      )
      .select("*")
      .single();

    if (!error && data) {
      setOrderPayments((prev) => ({
        ...prev,
        [bookingCode]: data as CustomerOrderPayment,
      }));
    }
  };

  const submitOrderItemCancel = async (): Promise<void> => {
    if (!orderCancelTarget) return;

    const note = orderCancelNote.trim();
    if (!note) {
      alert("Cancel note is required.");
      return;
    }

    const { session, item } = orderCancelTarget;

    try {
      setCancellingOrderItemId(item.id);

      if (item.source === "addon") {
        const systemPaid = getSystemPaymentInfo(session);

        const cancelPayload = {
          original_id: item.id,
          created_at: item.created_at,
          add_on_id: item.source_item_id,
          quantity: item.qty,
          price: item.price,
          full_name: session.full_name,
          seat_number: session.seat_number,
          gcash_amount: systemPaid.gcash,
          cash_amount: systemPaid.cash,
          is_paid: toBool(session.is_paid),
          paid_at: session.paid_at ?? null,
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

        const { data: addonRow, error: addonFetchErr } = await supabase
          .from("add_ons")
          .select("sold")
          .eq("id", item.source_item_id)
          .maybeSingle();

        if (!addonFetchErr && addonRow) {
          const nextSold = Math.max(
            0,
            wholePeso(toMoney((addonRow as { sold?: number | string | null }).sold) - item.qty)
          );
          await supabase.from("add_ons").update({ sold: nextSold }).eq("id", item.source_item_id);
        }

        await recalcAddonParentAfterDelete(item.parent_order_id);
      } else {
        const systemPaid = getSystemPaymentInfo(session);

        const consignmentPayload = {
          original_id: item.id,
          original_created_at: item.created_at,
          consignment_id: item.source_item_id,
          quantity: item.qty,
          price: item.price,
          total: item.subtotal,
          full_name: session.full_name,
          seat_number: session.seat_number,
          gcash_amount: systemPaid.gcash,
          cash_amount: systemPaid.cash,
          is_paid: toBool(session.is_paid),
          paid_at: session.paid_at ?? null,
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

        const { data: conRow, error: conFetchErr } = await supabase
          .from("consignment")
          .select("sold")
          .eq("id", item.source_item_id)
          .maybeSingle();

        if (!conFetchErr && conRow) {
          const nextSold = Math.max(
            0,
            wholePeso(toMoney((conRow as { sold?: number | string | null }).sold) - item.qty)
          );
          await supabase.from("consignment").update({ sold: nextSold }).eq("id", item.source_item_id);
        }

        await recalcConsignmentParentAfterDelete(item.parent_order_id);
      }

      const updatedSessions = await fetchReservationSessions();
      await fetchOrdersForSessions(updatedSessions);
      await fetchOrderPayments(updatedSessions);
      await fetchAttendanceStateForSessions(updatedSessions);

      const freshSession = updatedSessions.find((s) => s.id === session.id) ?? session;
      await refreshOrderPaymentTotalForSession(freshSession);
      await syncSingleSessionPaidState(freshSession);

      setOrderCancelTarget(null);
      setOrderCancelNote("");

      if (selectedOrderSession) {
        const freshOrderSession =
          updatedSessions.find((s) => s.id === selectedOrderSession.id) ?? null;
        setSelectedOrderSession(freshOrderSession);
      }

      if (selectedSession) {
        const freshReceiptSession =
          updatedSessions.find((s) => s.id === selectedSession.id) ?? null;
        setSelectedSession(freshReceiptSession);
      }

      alert("Order item cancelled successfully.");
    } catch (e) {
      console.error(e);
      alert("Order item cancel failed.");
    } finally {
      setCancellingOrderItemId(null);
    }
  };

  const submitCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const reason = cancelReason.trim();
    if (!reason) {
      alert("Cancel reason is required.");
      return;
    }

    try {
      setCancellingBusy(true);

      const { data: freshRow, error: fetchErr } = await supabase
        .from("customer_sessions")
        .select("*")
        .eq("id", cancelTarget.id)
        .single();

      if (fetchErr || !freshRow) {
        alert(`Cancel failed: ${fetchErr?.message ?? "Session not found."}`);
        return;
      }

      const row = freshRow as CustomerSession;

      if (isCustomerViewOnForSession(activeView, row.id)) {
        try {
          await setCustomerViewState(false, null);
          await readActiveCustomerView();
        } catch {
          //
        }
      }

      const cancelPayload = {
        id: row.id,
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,

        created_at: row.created_at ?? null,
        staff_id: row.staff_id ?? null,

        date: row.date,
        full_name: row.full_name,
        customer_type: row.customer_type,
        customer_field: row.customer_field ?? null,
        has_id: row.has_id,
        hour_avail: row.hour_avail,
        time_started: row.time_started,
        time_ended: row.time_ended ?? row.time_started,

        total_time: toMoney(row.total_time),
        total_amount: toMoney(row.total_amount),

        reservation: row.reservation ?? "yes",
        reservation_date: row.reservation_date ?? null,
        reservation_end_date: row.reservation_end_date ?? null,

        id_number: row.id_number ?? null,
        seat_number: String(row.seat_number ?? "").trim() || "N/A",

        promo_booking_id: row.promo_booking_id ?? null,
        booking_code: row.booking_code ?? null,

        discount_kind: row.discount_kind ?? "none",
        discount_value: Math.max(0, toMoney(row.discount_value ?? 0)),
        discount_reason: row.discount_reason ?? null,

        gcash_amount: Math.max(0, toMoney(row.gcash_amount ?? 0)),
        cash_amount: Math.max(0, toMoney(row.cash_amount ?? 0)),
        is_paid: toBool(row.is_paid),
        paid_at: row.paid_at ?? null,

        phone_number: row.phone_number ?? null,
        down_payment:
          row.down_payment == null ? null : wholePeso(toMoney(row.down_payment)),
      };

      const { error: insertErr } = await supabase
        .from("customer_sessions_cancelled")
        .insert(cancelPayload);

      if (insertErr) {
        alert(`Cancel failed: ${insertErr.message}`);
        return;
      }

      const bookingCode = String(row.booking_code ?? "").trim().toUpperCase();
      if (bookingCode) {
        await supabase
          .from("customer_order_payments")
          .delete()
          .eq("booking_code", bookingCode);
      }

    const nowIso = new Date().toISOString();
    await releaseSeatBlocksNow(row, nowIso, "cancel");

      const { error: deleteErr } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("id", row.id);

      if (deleteErr) {
        alert(`Cancelled copy saved, but delete failed: ${deleteErr.message}`);
        return;
      }

      setSessions((prev) => prev.filter((x) => x.id !== row.id));
      setSelectedSession((prev) => (prev?.id === row.id ? null : prev));
      setSelectedOrderSession((prev) => (prev?.id === row.id ? null : prev));

      const code = String(row.booking_code ?? "").trim().toUpperCase();
      if (code) {
        setSessionOrders((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });

        setOrderPayments((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });
      }

      setCancelTarget(null);
      setCancelReason("");
      alert("Reservation cancelled successfully.");
    } catch (e) {
      console.error(e);
      alert("Cancel failed.");
    } finally {
      setCancellingBusy(false);
    }
  };

  const toggleCustomerViewForSession = async (
    session: CustomerSession
  ): Promise<void> => {
    const currentlyOn = isCustomerViewOnForSession(activeView, session.id);

    try {
      setViewBusy(true);

      if (currentlyOn) {
        await setCustomerViewState(false, null);
      } else {
        await setCustomerViewState(true, session.id);
      }

      await readActiveCustomerView();
    } catch (e) {
      console.error(e);
      alert("Failed to update View to Customer.");
    } finally {
      setViewBusy(false);
    }
  };

  const closeReceipt = async (): Promise<void> => {
    if (selectedSession && isCustomerViewOnForSession(activeView, selectedSession.id)) {
      try {
        setViewBusy(true);
        await setCustomerViewState(false, null);
        await readActiveCustomerView();
      } catch (e) {
        console.error(e);
      } finally {
        setViewBusy(false);
      }
    }
    setSelectedSession(null);
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Reservations</h2>

              <div className="customer-subtext">
                Filter By:{" "}
                <strong>
                  {dateFilterMode === "reserved_on" ? "Reserved On" : "Start Date"}
                </strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Date: <strong>{filterDate || "All"}</strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Customer View:{" "}
                <strong>
                  {activeView?.enabled
                    ? `ON (${String(activeView.session_id ?? "").slice(0, 8)}...)`
                    : "OFF"}
                </strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>
                  <input
                    className="customer-search-input"
                    type="text"
                    value={searchName}
                    onChange={(e) => setSearchName(e.currentTarget.value)}
                    placeholder="Search by Full Name..."
                  />
                  {searchName.trim() && (
                    <button
                      className="customer-search-clear"
                      onClick={() => setSearchName("")}
                      type="button"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <label className="date-pill">
                  <span className="date-pill-label">Filter By</span>
                  <select
                    className="date-pill-input"
                    value={dateFilterMode}
                    onChange={(e) =>
                      setDateFilterMode(e.currentTarget.value as DateFilterMode)
                    }
                  >
                    <option value="reserved_on">Reserved On</option>
                    <option value="start_date">Start Date</option>
                  </select>
                </label>

                <label className="date-pill">
                  <span className="date-pill-label">Date</span>
                  <input
                    className="date-pill-input"
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(String(e.currentTarget.value ?? ""))}
                  />
                  <span className="date-pill-icon" aria-hidden="true">
                    📅
                  </span>
                </label>

                {(searchName.trim() || filterDate || dateFilterMode !== "start_date") && (
                  <button
                    className="receipt-btn"
                    type="button"
                    onClick={clearFilters}
                    title="Clear filters"
                  >
                    Clear Filters
                  </button>
                )}

                <button
                  className="receipt-btn"
                  onClick={() => void refreshAll()}
                  disabled={loading || refreshing}
                  title="Refresh list"
                  type="button"
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No reservation data found for this filter/date</p>
          ) : (
            <div
              className="customer-table-wrap"
              key={`${dateFilterMode}-${filterDate}`}
              style={{
                maxHeight: "560px",
                overflowY: "auto",
                overflowX: "auto",
              }}
            >
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Reserved On</th>
                    <th>Reservation Date</th>
                    <th>Full Name</th>
                    <th>Booking Code</th>
                    <th>Phone #</th>
                    <th>Type</th>
                    <th>Has ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Hours</th>
                    <th>Order</th>
                    <th>Total Balance / Change</th>
                    <th>Discount</th>
                    <th>Down Payment</th>
                    <th>System Payment</th>
                    <th>Order Payment</th>
                    <th>Paid?</th>
                    <th>Seat</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSessions.map((session) => {
                    const open = isOpenTimeSession(session);
                    const disp = getDisplayAmount(session);

                    const systemCost = wholePeso(Math.max(0, getSystemDue(session)));
                    const ordersTotal = wholePeso(Math.max(0, getOrderDue(session)));

                    const systemPay = getSystemPaymentInfo(session);
                    const orderPay = getOrderPaymentInfo(session);

                    const systemRemaining = getSystemRemaining(session);
                    const orderRemaining = getOrderRemaining(session);

                    const dp = getDownPayment(session);
                    const orderBundle = getOrderBundle(session);

                    return (
                      <tr key={session.id}>
                        <td>
                          {session.created_at
                            ? new Date(session.created_at).toLocaleString("en-PH")
                            : "—"}
                        </td>
                        <td>{formatReservationRange(session)}</td>
                        <td>{session.full_name}</td>
                        <td>{session.booking_code ?? "—"}</td>
                        <td>{phoneText(session)}</td>
                        <td>{session.customer_type}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{open ? "OPEN" : renderTimeOut(session)}</td>
                        <td>{session.total_time}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{ordersTotal}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {orderBundle.items.length} item
                              {orderBundle.items.length !== 1 ? "s" : ""}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => setSelectedOrderSession(session)}
                              type="button"
                            >
                              View Order
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value}</span>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountText(session)}</span>
                            <button
                              className="receipt-btn"
                              onClick={() => openDiscountModal(session)}
                              type="button"
                            >
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{dp}</span>
                            <button
                              className="receipt-btn"
                              onClick={() => openDpModal(session)}
                              type="button"
                            >
                              Edit DP
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{systemPay.gcash} / Cash ₱{systemPay.cash}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {systemRemaining > 0
                                ? `Remaining ₱${systemRemaining}`
                                : "Paid"}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={systemCost <= 0}
                              type="button"
                            >
                              System Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          {hasOrders(session) ? (
                            <div className="cell-stack cell-center">
                              <span className="cell-strong">
                                GCash ₱{orderPay.gcash} / Cash ₱{orderPay.cash}
                              </span>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                {orderRemaining > 0
                                  ? `Remaining ₱${orderRemaining}`
                                  : "Paid"}
                              </span>

                              <button
                                className="receipt-btn"
                                onClick={() => void openOrderPaymentModal(session)}
                                type="button"
                              >
                                Order Payment
                              </button>
                            </div>
                          ) : (
                            <div className="cell-stack cell-center">
                              <span style={{ opacity: 0.5 }}>No order</span>
                            </div>
                          )}
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${
                              toBool(session.is_paid)
                                ? "pay-badge--paid"
                                : "pay-badge--unpaid"
                            }`}
                            onClick={() => void togglePaid(session)}
                            disabled={togglingPaidId === session.id}
                            title={
                              toBool(session.is_paid)
                                ? "Tap to set UNPAID"
                                : "Tap to set PAID"
                            }
                            type="button"
                          >
                            {togglingPaidId === session.id
                              ? "Updating..."
                              : toBool(session.is_paid)
                              ? "PAID"
                              : "UNPAID"}
                          </button>
                        </td>

                        <td>{session.seat_number}</td>
                        <td>{renderStatus(session)}</td>

                        <td>
                          <div className="action-stack">
                            {open && (
                              <button
                                className="receipt-btn"
                                disabled={stoppingId === session.id}
                                onClick={() => void stopOpenTime(session)}
                                type="button"
                              >
                                {stoppingId === session.id ? "Stopping..." : "Stop Time"}
                              </button>
                            )}

                            <button
                              className="receipt-btn"
                              onClick={() => setSelectedSession(session)}
                              type="button"
                            >
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn admin-danger"
                              onClick={() => openCancelModal(session)}
                              title="Cancel requires description"
                              type="button"
                            >
                              Cancel
                            </button>

                            {isCustomerViewOnForSession(activeView, session.id) ? (
                              <span style={{ fontSize: 11, opacity: 0.85 }}>👁 Viewing</span>
                            ) : (
                              <span style={{ fontSize: 11, opacity: 0.45 }}>—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedOrderSession && (
            <div
              className="receipt-overlay"
              onClick={() => setSelectedOrderSession(null)}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ORDER LIST</h3>
                <p className="receipt-subtitle">{selectedOrderSession.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Booking Code</span>
                  <span>{selectedOrderSession.booking_code ?? "—"}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{selectedOrderSession.seat_number}</span>
                </div>

                <div className="receipt-row">
                  <span>Order Total</span>
                  <span>₱{wholePeso(getOrderDue(selectedOrderSession))}</span>
                </div>

                <div className="receipt-row">
                  <span>Order Paid</span>
                  <span>₱{wholePeso(getOrderPaymentInfo(selectedOrderSession).totalPaid)}</span>
                </div>

                <div className="receipt-row">
                  <span>Order Remaining</span>
                  <span>₱{wholePeso(getOrderRemaining(selectedOrderSession))}</span>
                </div>

                <hr />

                {getOrderBundle(selectedOrderSession).items.length === 0 ? (
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
                    {getOrderBundle(selectedOrderSession).items.map((item) => (
                      <div
                        key={`${item.source}-${item.id}`}
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
                            {item.category}
                            {String(item.size ?? "").trim() ? ` • ${item.size}` : ""}
                            {item.source === "consignment"
                              ? " • Consignment"
                              : " • Add-On"}
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
                              Qty: <strong>{item.qty}</strong>
                            </div>
                            <div>
                              Price: <strong>₱{item.price}</strong>
                            </div>
                            <div>
                              Subtotal: <strong>₱{item.subtotal}</strong>
                            </div>
                          </div>

                          <div style={{ marginTop: 10 }}>
                            <button
                              className="receipt-btn admin-danger"
                              onClick={() =>
                                openOrderCancelModal(selectedOrderSession, item)
                              }
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
                    onClick={() => setSelectedOrderSession(null)}
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
              onClick={() => (cancellingOrderItemId ? null : setOrderCancelTarget(null))}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL ORDER ITEM</h3>
                <p className="receipt-subtitle">{orderCancelTarget.item.name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{orderCancelTarget.session.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{orderCancelTarget.session.seat_number}</span>
                </div>

                <div className="receipt-row">
                  <span>Type</span>
                  <span>
                    {orderCancelTarget.item.source === "addon"
                      ? "Add-On"
                      : "Consignment"}
                  </span>
                </div>

                <div className="receipt-row">
                  <span>Qty</span>
                  <span>{orderCancelTarget.item.qty}</span>
                </div>

                <div className="receipt-row">
                  <span>Subtotal</span>
                  <span>₱{orderCancelTarget.item.subtotal}</span>
                </div>

                <hr />

                <div className="receipt-row" style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontWeight: 800 }}>Cancel Note (required)</span>
                  <textarea
                    className="reason-input"
                    value={orderCancelNote}
                    onChange={(e) => setOrderCancelNote(e.currentTarget.value)}
                    placeholder="e.g. Customer removed item / out of stock / wrong item..."
                    rows={4}
                    style={{ width: "100%", resize: "vertical" }}
                    disabled={Boolean(cancellingOrderItemId)}
                  />
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    This cancelled item will be archived in{" "}
                    <strong>
                      {orderCancelTarget.item.source === "addon"
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
                    className="receipt-btn admin-danger"
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

          {cancelTarget && (
            <div
              className="receipt-overlay"
              onClick={() => (cancellingBusy ? null : setCancelTarget(null))}
            >
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL RESERVATION</h3>
                <p className="receipt-subtitle">{cancelTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Reserved On</span>
                  <span>
                    {cancelTarget.created_at
                      ? new Date(cancelTarget.created_at).toLocaleString("en-PH")
                      : "N/A"}
                  </span>
                </div>

                <div className="receipt-row">
                  <span>Reservation Range</span>
                  <span>{formatReservationRange(cancelTarget)}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{cancelTarget.seat_number}</span>
                </div>

                <hr />

                <div className="receipt-row" style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontWeight: 800 }}>Description / Reason (required)</span>
                  <textarea
                    className="reason-input"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.currentTarget.value)}
                    placeholder="e.g. Customer changed mind, wrong input, staff mistake..."
                    rows={4}
                    style={{ width: "100%", resize: "vertical" }}
                    disabled={cancellingBusy}
                  />
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    ⚠️ This record will be moved to{" "}
                    <strong>customer_sessions_cancelled</strong>.
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    className="receipt-btn"
                    onClick={() => {
                      if (cancelTarget?.booking_code) {
                        navigator.clipboard.writeText(cancelTarget.booking_code);
                        alert("Booking code copied!");
                      }
                    }}
                    type="button"
                  >
                    Copy Code
                  </button>

                  <button
                    className="receipt-btn"
                    onClick={() => setCancelTarget(null)}
                    disabled={cancellingBusy}
                    type="button"
                  >
                    Back
                  </button>

                  <button
                    className="receipt-btn admin-danger"
                    onClick={() => void submitCancel()}
                    disabled={cancellingBusy || cancelReason.trim().length === 0}
                    title={
                      cancelReason.trim().length === 0
                        ? "Reason required"
                        : "Submit cancel"
                    }
                    type="button"
                  >
                    {cancellingBusy ? "Cancelling..." : "Submit Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {dpTarget && (
            <div className="receipt-overlay" onClick={() => setDpTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DOWN PAYMENT</h3>
                <p className="receipt-subtitle">{dpTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Down Payment (₱)</span>
                  <input
                    className="money-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={dpInput}
                    onChange={(e) => setDpInput(e.currentTarget.value)}
                  />
                </div>

                <div className="modal-actions">
                  <button
                    className="receipt-btn"
                    onClick={() => setDpTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="receipt-btn"
                    onClick={() => void saveDownPayment()}
                    disabled={savingDp}
                    type="button"
                  >
                    {savingDp ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {discountTarget && (
            <div className="receipt-overlay" onClick={() => setDiscountTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DISCOUNT</h3>
                <p className="receipt-subtitle">{discountTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Discount Type</span>
                  <select
                    value={discountKind}
                    onChange={(e) =>
                      setDiscountKind(e.currentTarget.value as DiscountKind)
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
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.currentTarget.value)}
                      disabled={discountKind === "none"}
                    />
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Reason</span>
                  <input
                    className="reason-input"
                    type="text"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.currentTarget.value)}
                    placeholder="e.g. Student discount / Promo / Goodwill"
                  />
                </div>

                {(() => {
                  const base = getBaseSystemCost(discountTarget);
                  const val = toMoney(discountInput);
                  const appliedVal =
                    discountKind === "percent"
                      ? clamp(Math.max(0, val), 0, 100)
                      : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(
                    base,
                    discountKind,
                    appliedVal
                  );
                  const orderTotal = getOrderDue(discountTarget);
                  const dueForPayment = wholePeso(
                    Math.max(0, discountedCost + orderTotal)
                  );
                  const prevPay = getSystemPaymentInfo(discountTarget);

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{wholePeso(base)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, appliedVal)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{wholePeso(discountAmount)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (After Discount)</span>
                        <span>₱{wholePeso(discountedCost)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Order Total</span>
                        <span>₱{wholePeso(orderTotal)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW GRAND TOTAL</span>
                        <span>₱{wholePeso(dueForPayment)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current System Payment</span>
                        <span>
                          GCash ₱{prevPay.gcash} / Cash ₱{prevPay.cash}
                        </span>
                      </div>
                    </>
                  );
                })()}

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
              </div>
            </div>
          )}

          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">SYSTEM PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = wholePeso(Math.max(0, getSystemDue(paymentTarget)));

                  const g = wholePeso(Math.max(0, toMoney(gcashInput)));
                  const c = wholePeso(Math.max(0, toMoney(cashInput)));
                  const totalPaid = wholePeso(g + c);

                  const diff = totalPaid - due;
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>System Cost Due</span>
                        <span>₱{due}</span>
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
                        <span>₱{totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>₱{wholePeso(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Status</span>
                        <span className="receipt-status">
                          {isPaidAuto ? "PAID" : "UNPAID"}
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
            <div className="receipt-overlay" onClick={() => setOrderPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ORDER PAYMENT</h3>
                <p className="receipt-subtitle">{orderPaymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = wholePeso(Math.max(0, getOrderDue(orderPaymentTarget)));

                  const g = wholePeso(Math.max(0, toMoney(orderGcashInput)));
                  const c = wholePeso(Math.max(0, toMoney(orderCashInput)));
                  const totalPaid = wholePeso(g + c);

                  const diff = totalPaid - due;
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Order Due</span>
                        <span>₱{due}</span>
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
                        <span>Total Paid</span>
                        <span>₱{totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>₱{wholePeso(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Order Status</span>
                        <span className="receipt-status">
                          {isPaidAuto ? "PAID" : "UNPAID"}
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

          {selectedSession && (
            <div className="receipt-overlay" onClick={() => void closeReceipt()}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Reserved On</span>
                  <span>
                    {selectedSession.created_at
                      ? new Date(selectedSession.created_at).toLocaleString("en-PH")
                      : "N/A"}
                  </span>
                </div>

                <div className="receipt-row">
                  <span>Reservation Range</span>
                  <span>{formatReservationRange(selectedSession)}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedSession.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Booking Code</span>
                  <span>{selectedSession.booking_code ?? "—"}</span>
                </div>

                <div className="receipt-row">
                  <span>Phone</span>
                  <span>{phoneText(selectedSession)}</span>
                </div>

                <div className="receipt-row">
                  <span>Type</span>
                  <span>{selectedSession.customer_type}</span>
                </div>

                <div className="receipt-row">
                  <span>Has ID</span>
                  <span>{selectedSession.has_id ? "Yes" : "No"}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{selectedSession.seat_number}</span>
                  {String(selectedSession.reservation).toLowerCase() === "yes" && (
                    <div className="receipt-row">
                      <span>Attendance</span>
                      <span>{isReservationCurrentlyIn(selectedSession) ? "IN" : "OUT"}</span>
                    </div>
                  )}
                </div> 

                <hr />

                <div className="receipt-row">
                  <span>Time In</span>
                  <span>{formatTimeText(selectedSession.time_started)}</span>
                </div>

                <div className="receipt-row">
                  <span>Time Out</span>
                  <span>{renderTimeOut(selectedSession)}</span>
                </div>

                <div className="receipt-row">
                  <span>Minutes Used</span>
                  <span>{getUsedMinutesForReceipt(selectedSession)} min</span>
                </div>

                <div className="receipt-row">
                  <span>Charge Minutes</span>
                  <span>{getChargeMinutesForReceipt(selectedSession)} min</span>
                </div>

                {isOpenTimeSession(selectedSession) && (
                  <div className="block-top">
                    <button
                      className="receipt-btn btn-full"
                      disabled={stoppingId === selectedSession.id}
                      onClick={() => void stopOpenTime(selectedSession)}
                      type="button"
                    >
                      {stoppingId === selectedSession.id
                        ? "Stopping..."
                        : "Stop Time (Set Time Out Now)"}
                    </button>
                  </div>
                )}

                <hr />

                {(() => {
                  const dp = getDownPayment(selectedSession);

                  const baseCost = getBaseSystemCost(selectedSession);
                  const di = getDiscountInfo(selectedSession);
                  const discountCalc = applyDiscount(baseCost, di.kind, di.value);

                  const systemDue = wholePeso(Math.max(0, discountCalc.discountedCost));
                  const orderBundle = getOrderBundle(selectedSession);
                  const ordersTotal = wholePeso(orderBundle.total);
                  const grandDue = wholePeso(systemDue + ordersTotal);

                  const systemPay = getSystemPaymentInfo(selectedSession);
                  const orderPay = getOrderPaymentInfo(selectedSession);

                  const dpBalance = wholePeso(Math.max(0, grandDue - dp));
                  const dpChange = wholePeso(Math.max(0, dp - grandDue));

                  const dpDisp =
                    dpBalance > 0
                      ? ({ label: "Total Balance", value: dpBalance } as const)
                      : ({ label: "Total Change", value: dpChange } as const);

                  const bottomLabel = dpBalance > 0 ? "PAYMENT DUE" : "TOTAL CHANGE";
                  const bottomValue = dpBalance > 0 ? dpBalance : dpChange;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>{dpDisp.label}</span>
                        <span>₱{dpDisp.value}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(di.kind, di.value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{wholePeso(discountCalc.discountAmount)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost</span>
                        <span>₱{wholePeso(systemDue)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Order Total</span>
                        <span>₱{ordersTotal}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Grand Total</span>
                        <span>₱{grandDue}</span>
                      </div>

                      {orderBundle.items.length > 0 && (
                        <>
                          <hr />
                          <div style={{ fontWeight: 800, marginBottom: 8 }}>ORDER LIST</div>

                          {orderBundle.items.map((item, idx) => (
                            <div
                              className="receipt-row"
                              key={`${item.source}-${item.name}-${idx}`}
                            >
                              <span>
                                {item.name} x{item.qty}
                              </span>
                              <span>₱{item.subtotal}</span>
                            </div>
                          ))}
                        </>
                      )}

                      <hr />

                      <div className="receipt-row">
                        <span>System Payment</span>
                        <span>GCash ₱{systemPay.gcash} / Cash ₱{systemPay.cash}</span>
                      </div>

                      {ordersTotal > 0 && (
                        <div className="receipt-row">
                          <span>Order Payment</span>
                          <span>GCash ₱{orderPay.gcash} / Cash ₱{orderPay.cash}</span>
                        </div>
                      )}

                      <div className="receipt-row">
                        <span>System Remaining</span>
                        <span>₱{getSystemRemaining(selectedSession)}</span>
                      </div>

                      {ordersTotal > 0 && (
                        <div className="receipt-row">
                          <span>Order Remaining</span>
                          <span>₱{getOrderRemaining(selectedSession)}</span>
                        </div>
                      )}

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">
                          {toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}
                        </span>
                      </div>

                      <div className="receipt-total">
                        <span>{bottomLabel}</span>
                        <span>₱{bottomValue}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                {(() => {
                  const viewOn = isCustomerViewOnForSession(activeView, selectedSession.id);

                  return (
                    <div
                      className="modal-actions"
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      <button
                        className="receipt-btn"
                        onClick={() => void toggleCustomerViewForSession(selectedSession)}
                        disabled={viewBusy}
                        title={viewOn ? "Turn OFF View to Customer" : "Turn ON View to Customer"}
                        type="button"
                      >
                        {viewBusy ? "Updating..." : viewOn ? "Stop View" : "View Customer"}
                      </button>

                      <button
                        className="close-btn"
                        onClick={() => void closeReceipt()}
                        disabled={viewBusy}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Reservations;