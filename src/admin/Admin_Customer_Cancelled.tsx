// src/admin/Admin_Customer_Cancelled.tsx
// ✅ ADMIN = SAME UI/FUNCTIONS as Customer_Cancelled (Add-Ons / Walk-in / Reservation / Promo)
// ✅ Admin ONLY extras: Delete by Date (ALL tabs) + Export Excel (ALL tabs)
// ✅ Promo tab works WITHOUT FK (3-query merge: promo_bookings_cancelled + packages + package_options)
// ✅ NEW: Consignment tab (consignment_cancelled) + grouped view + receipt modal
// ✅ Delete by Date includes Consignment
// ✅ Export Excel includes Consignment + summary
// ✅ STRICT TS (no any)
// ✅ ExcelJS clearRow TS-safe (no undefined for border/fill)

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
   TYPES (Promo Cancelled)
========================= */
type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";

type CancelledPromoDB = {
  id: string;
  cancelled_at: string;
  original_id: string;
  description: string;

  created_at: string;
  user_id: string | null;

  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  package_id: string;
  package_option_id: string;

  seat_number: string | null;
  start_at: string;
  end_at: string;

  price: number | string;
  status: string;

  gcash_amount: number | string;
  cash_amount: number | string;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  discount_reason: string | null;
  discount_kind: DiscountKind | string;
  discount_value: number | string;
};

// lookup tables
type PackageRow = { id: string; title: string | null };
type PackageOptionRow = {
  id: string;
  option_name: string | null;
  duration_value: number | null;
  duration_unit: DurationUnit | null;
};

type CancelledPromo = {
  id: string;
  cancelled_at: string;
  original_id: string;
  description: string;

  created_at: string;
  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  seat_number: string | null;

  start_at: string;
  end_at: string;

  price: number;
  status: string;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  discount_kind: DiscountKind;
  discount_value: number;
  discount_reason: string | null;

  package_title: string;
  option_name: string;
  duration_value: number | null;
  duration_unit: DurationUnit | null;
};

/* =========================
   TYPES (Consignment Cancelled)
========================= */
type ConsignmentCancelledDB = {
  id: string;
  cancelled_at: string;
  cancelled_by: string;
  original_id: string;
  original_created_at: string | null;

  consignment_id: string;
  quantity: number;
  price: NumericLike;
  total: NumericLike;

  full_name: string;
  seat_number: string;

  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  was_voided: boolean | number | string | null;
  voided_at: string | null;
  void_note: string | null;

  item_name: string;
  category: string | null;
  size: string | null;
  image_url: string | null;

  cancel_note: string;

  stock_returned: boolean | number | string | null;
};

type CancelItemConsignment = {
  id: string;
  cancelled_at: string;
  original_id: string;
  original_created_at: string | null;

  consignment_id: string;
  item_name: string;
  category: string;
  size: string | null;
  image_url: string | null;

  quantity: number;
  price: number;
  total: number;

  full_name: string;
  seat_number: string;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  was_voided: boolean;
  voided_at: string | null;
  void_note: string | null;

  cancel_note: string;
  stock_returned: boolean;
};

type CancelGroupItemConsignment = {
  id: string;
  original_id: string;
  consignment_id: string;

  item_name: string;
  category: string;
  size: string | null;

  quantity: number;
  price: number;
  total: number;
};

type CancelGroupConsignment = {
  key: string;
  cancelled_at: string;
  full_name: string;
  seat_number: string;

  cancel_note: string;

  items: CancelGroupItemConsignment[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  was_voided: boolean;
  voided_at: string | null;
  void_note: string | null;

  stock_returned: boolean;
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

const normalizeDiscountKind = (v: unknown): DiscountKind => {
  const s = String(v ?? "none").trim().toLowerCase();
  if (s === "percent") return "percent";
  if (s === "amount") return "amount";
  return "none";
};

const prettyArea = (a: PackageArea): string => (a === "conference_room" ? "Conference Room" : "Common Area");

const seatLabelPromo = (area: PackageArea, seat: string | null): string =>
  area === "conference_room" ? "CONFERENCE ROOM" : String(seat ?? "").trim() || "N/A";

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
type CancelTab = "addons" | "walkin" | "reservation" | "promo" | "consignment";

const TAB_LABEL: Record<CancelTab, string> = {
  addons: "Add-Ons",
  walkin: "Walk-in",
  reservation: "Reservation",
  promo: "Promo (Membership)",
  consignment: "Consignment",
};

const tabTitleFrom = (tab: CancelTab): string => {
  if (tab === "addons") return "Cancelled Add-Ons";
  if (tab === "walkin") return "Cancelled Walk-in";
  if (tab === "reservation") return "Cancelled Reservation";
  if (tab === "promo") return "Cancelled Promo Membership";
  return "Cancelled Consignment";
};

const Admin_Customer_Cancelled: React.FC = () => {
  const [tab, setTab] = useState<CancelTab>("addons");
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [loading, setLoading] = useState<boolean>(true);

  // Add-ons
  const [rowsAddOns, setRowsAddOns] = useState<CancelItemAddOn[]>([]);
  const [selectedGroupAddOns, setSelectedGroupAddOns] = useState<CancelGroupAddOn | null>(null);

  // Sessions
  const [rowsSessions, setRowsSessions] = useState<CancelledSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<CancelledSession | null>(null);

  // Promo
  const [rowsPromo, setRowsPromo] = useState<CancelledPromo[]>([]);
  const [selectedPromo, setSelectedPromo] = useState<CancelledPromo | null>(null);

  // Consignment
  const [rowsConsignment, setRowsConsignment] = useState<CancelItemConsignment[]>([]);
  const [selectedGroupConsignment, setSelectedGroupConsignment] = useState<CancelGroupConsignment | null>(null);

  // Admin actions
  const [confirmDeleteDate, setConfirmDeleteDate] = useState<boolean>(false);
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
    setSelectedPromo(null);
    setSelectedGroupConsignment(null);

    if (tab === "addons") await fetchCancelledAddOns(selectedDate);
    else if (tab === "walkin") await fetchCancelledSessions(selectedDate, "no");
    else if (tab === "reservation") await fetchCancelledSessions(selectedDate, "yes");
    else if (tab === "promo") await fetchCancelledPromo(selectedDate);
    else await fetchCancelledConsignment(selectedDate);
  };

  /* =========================
     GROUP (Add-Ons)
  ========================= */
  const groupedAddOns = useMemo<CancelGroupAddOn[]>(() => {
    if (rowsAddOns.length === 0) return [];

    const groups: CancelGroupAddOn[] = [];
    let current: CancelGroupAddOn | null = null;
    let last: CancelItemAddOn | null = null;

    const sameKey = (a: CancelItemAddOn, b: CancelItemAddOn): boolean =>
      norm(a.full_name) === norm(b.full_name) &&
      norm(a.seat_number) === norm(b.seat_number) &&
      norm(a.description) === norm(b.description);

    for (const r of rowsAddOns) {
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
  }, [rowsAddOns]);

  /* =========================
     GROUP (Consignment)
  ========================= */
  const groupedConsignment = useMemo<CancelGroupConsignment[]>(() => {
    if (rowsConsignment.length === 0) return [];

    const sorted = [...rowsConsignment].sort((a, b) => ms(a.cancelled_at) - ms(b.cancelled_at));

    const groups: CancelGroupConsignment[] = [];
    let current: CancelGroupConsignment | null = null;
    let last: CancelItemConsignment | null = null;

    const sameKey = (a: CancelItemConsignment, b: CancelItemConsignment): boolean =>
      norm(a.full_name) === norm(b.full_name) &&
      norm(a.seat_number) === norm(b.seat_number) &&
      norm(a.cancel_note) === norm(b.cancel_note);

    for (const r of sorted) {
      const startNew =
        current === null ||
        last === null ||
        !sameKey(r, last) ||
        Math.abs(ms(r.cancelled_at) - ms(last.cancelled_at)) > GROUP_WINDOW_MS;

      if (startNew) {
        const key = `${norm(r.full_name)}|${norm(r.seat_number)}|${ms(r.cancelled_at)}|${norm(r.cancel_note)}`;
        current = {
          key,
          cancelled_at: r.cancelled_at,
          full_name: r.full_name,
          seat_number: r.seat_number,
          cancel_note: r.cancel_note || "-",
          items: [],
          grand_total: 0,
          gcash_amount: 0,
          cash_amount: 0,
          is_paid: false,
          paid_at: null,
          was_voided: false,
          voided_at: null,
          void_note: null,
          stock_returned: false,
        };
        groups.push(current);
      }

      if (!current) continue;

      current.items.push({
        id: r.id,
        original_id: r.original_id,
        consignment_id: r.consignment_id,
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

      current.was_voided = current.was_voided || r.was_voided;
      current.voided_at = current.voided_at ?? r.voided_at;
      current.void_note = current.void_note ?? r.void_note;

      current.stock_returned = current.stock_returned || r.stock_returned;

      last = r;
    }

    return groups.sort((a, b) => ms(b.cancelled_at) - ms(a.cancelled_at));
  }, [rowsConsignment]);

  /* =========================
     FETCH: ADD-ONS CANCELLED
  ========================= */
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

  /* =========================
     FETCH: SESSIONS CANCELLED
  ========================= */
  const fetchCancelledSessions = async (dateStr: string, reservation: "no" | "yes"): Promise<void> => {
    setLoading(true);
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
      setRowsSessions([]);
      setLoading(false);
      return;
    }

    const mapped: CancelledSession[] = (data ?? []).map((r) => {
      const kind: DiscountKind = normalizeDiscountKind(r.discount_kind);

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

    setRowsSessions(mapped);
    setLoading(false);
  };

  /* =========================
     FETCH: PROMO CANCELLED (NO FK)
  ========================= */
  const fetchCancelledPromo = async (dateStr: string): Promise<void> => {
    setLoading(true);
    const { startIso, endIso } = manilaDayRange(dateStr);

    const { data, error } = await supabase
      .from("promo_bookings_cancelled")
      .select(
        `
        id,
        cancelled_at,
        original_id,
        description,
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
        discount_value
      `
      )
      .gte("cancelled_at", startIso)
      .lt("cancelled_at", endIso)
      .order("cancelled_at", { ascending: false })
      .returns<CancelledPromoDB[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CANCELLED PROMO ERROR:", error);
      setRowsPromo([]);
      setLoading(false);
      return;
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      setRowsPromo([]);
      setLoading(false);
      return;
    }

    const pkgIds = Array.from(new Set(rows.map((r) => String(r.package_id)).filter((x) => x.length > 0)));
    const optIds = Array.from(new Set(rows.map((r) => String(r.package_option_id)).filter((x) => x.length > 0)));

    const [pkgRes, optRes] = await Promise.all([
      pkgIds.length
        ? supabase.from("packages").select("id,title").in("id", pkgIds).returns<PackageRow[]>()
        : Promise.resolve({ data: [] as PackageRow[], error: null as unknown }),
      optIds.length
        ? supabase
            .from("package_options")
            .select("id,option_name,duration_value,duration_unit")
            .in("id", optIds)
            .returns<PackageOptionRow[]>()
        : Promise.resolve({ data: [] as PackageOptionRow[], error: null as unknown }),
    ]);

    if ((pkgRes as { error: unknown }).error) {
      // eslint-disable-next-line no-console
      console.error("FETCH PACKAGES LOOKUP ERROR:", (pkgRes as { error: unknown }).error);
    }
    if ((optRes as { error: unknown }).error) {
      // eslint-disable-next-line no-console
      console.error("FETCH PACKAGE_OPTIONS LOOKUP ERROR:", (optRes as { error: unknown }).error);
    }

    const pkgMap = new Map<string, PackageRow>();
    ((pkgRes as { data: PackageRow[] }).data ?? []).forEach((p) => pkgMap.set(p.id, p));

    const optMap = new Map<string, PackageOptionRow>();
    ((optRes as { data: PackageOptionRow[] }).data ?? []).forEach((o) => optMap.set(o.id, o));

    const mapped: CancelledPromo[] = rows.map((r) => {
      const kind = normalizeDiscountKind(r.discount_kind);
      const price = round2(Math.max(0, toNumber(r.price as NumericLike)));
      const discVal = round2(Math.max(0, toNumber(r.discount_value as NumericLike)));

      const pkg = pkgMap.get(String(r.package_id));
      const opt = optMap.get(String(r.package_option_id));

      return {
        id: r.id,
        cancelled_at: r.cancelled_at,
        original_id: r.original_id,
        description: String(r.description ?? "").trim() || "-",

        created_at: r.created_at,
        full_name: String(r.full_name ?? "-"),
        phone_number: r.phone_number ?? null,

        area: r.area,
        seat_number: r.seat_number ?? null,

        start_at: r.start_at,
        end_at: r.end_at,

        price,
        status: String(r.status ?? "pending"),

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount as NumericLike))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount as NumericLike))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,

        discount_kind: kind,
        discount_value: discVal,
        discount_reason: r.discount_reason ?? null,

        package_title: String(pkg?.title ?? "").trim() || "—",
        option_name: String(opt?.option_name ?? "").trim() || "—",
        duration_value: opt?.duration_value ?? null,
        duration_unit: opt?.duration_unit ?? null,
      };
    });

    setRowsPromo(mapped);
    setLoading(false);
  };

  /* =========================
     FETCH: CONSIGNMENT CANCELLED
  ========================= */
  const fetchCancelledConsignment = async (dateStr: string): Promise<void> => {
    setLoading(true);
    const { startIso, endIso } = manilaDayRange(dateStr);

    const { data, error } = await supabase
      .from("consignment_cancelled")
      .select(
        `
        id,
        cancelled_at,
        cancelled_by,
        original_id,
        original_created_at,
        consignment_id,
        quantity,
        price,
        total,
        full_name,
        seat_number,
        gcash_amount,
        cash_amount,
        is_paid,
        paid_at,
        was_voided,
        voided_at,
        void_note,
        item_name,
        category,
        size,
        image_url,
        cancel_note,
        stock_returned
      `
      )
      .gte("cancelled_at", startIso)
      .lt("cancelled_at", endIso)
      .order("cancelled_at", { ascending: true })
      .returns<ConsignmentCancelledDB[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CONSIGNMENT CANCELLED ERROR:", error);
      setRowsConsignment([]);
      setLoading(false);
      return;
    }

    const mapped: CancelItemConsignment[] = (data ?? []).map((r) => {
      const qty = Math.max(0, Math.floor(Number(r.quantity) || 0));
      const price = round2(Math.max(0, toNumber(r.price)));
      const total = round2(Math.max(0, toNumber(r.total)));

      // if total is 0 but qty/price exist, compute fallback
      const fixedTotal = total > 0 ? total : round2(qty * price);

      return {
        id: r.id,
        cancelled_at: r.cancelled_at,
        original_id: r.original_id,
        original_created_at: r.original_created_at ?? null,

        consignment_id: r.consignment_id,
        item_name: String(r.item_name ?? "-"),
        category: String(r.category ?? "-") || "-",
        size: r.size ?? null,
        image_url: r.image_url ?? null,

        quantity: qty,
        price,
        total: fixedTotal,

        full_name: String(r.full_name ?? "-"),
        seat_number: String(r.seat_number ?? "-"),

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,

        was_voided: toBool(r.was_voided),
        voided_at: r.voided_at ?? null,
        void_note: r.void_note ?? null,

        cancel_note: String(r.cancel_note ?? "").trim() || "-",
        stock_returned: toBool(r.stock_returned),
      };
    });

    setRowsConsignment(mapped);
    setLoading(false);
  };

  /* =========================
     ADMIN: DELETE BY DATE (ALL TABLES)
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

      const { error: e3 } = await supabase
        .from("promo_bookings_cancelled")
        .delete()
        .gte("cancelled_at", startIso)
        .lt("cancelled_at", endIso);
      if (e3) {
        alert(`Delete Promo by date failed: ${e3.message}`);
        return;
      }

      const { error: e4 } = await supabase
        .from("consignment_cancelled")
        .delete()
        .gte("cancelled_at", startIso)
        .lt("cancelled_at", endIso);
      if (e4) {
        alert(`Delete Consignment by date failed: ${e4.message}`);
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

  /* =========================
     ADMIN: EXCEL (ALL TABS)
  ========================= */
  const exportExcelAll = async (): Promise<void> => {
    try {
      setBusyExport(true);
      const { startIso, endIso } = manilaDayRange(selectedDate);

      // ====== Pull all datasets for selectedDate
      const [addRes, walkRes, resRes, promoRes, conRes] = await Promise.all([
        supabase
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
          .returns<CancelRowDB_AddOns[]>(),

        supabase
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
          .eq("reservation", "no")
          .order("cancelled_at", { ascending: false })
          .returns<CancelledSessionDB[]>(),

        supabase
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
          .eq("reservation", "yes")
          .order("cancelled_at", { ascending: false })
          .returns<CancelledSessionDB[]>(),

        supabase
          .from("promo_bookings_cancelled")
          .select(
            `
            id,
            cancelled_at,
            original_id,
            description,
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
            discount_value
          `
          )
          .gte("cancelled_at", startIso)
          .lt("cancelled_at", endIso)
          .order("cancelled_at", { ascending: false })
          .returns<CancelledPromoDB[]>(),

        supabase
          .from("consignment_cancelled")
          .select(
            `
            id,
            cancelled_at,
            cancelled_by,
            original_id,
            original_created_at,
            consignment_id,
            quantity,
            price,
            total,
            full_name,
            seat_number,
            gcash_amount,
            cash_amount,
            is_paid,
            paid_at,
            was_voided,
            voided_at,
            void_note,
            item_name,
            category,
            size,
            image_url,
            cancel_note,
            stock_returned
          `
          )
          .gte("cancelled_at", startIso)
          .lt("cancelled_at", endIso)
          .order("cancelled_at", { ascending: true })
          .returns<ConsignmentCancelledDB[]>(),
      ]);

      if (addRes.error) throw addRes.error;
      if (walkRes.error) throw walkRes.error;
      if (resRes.error) throw resRes.error;
      if (promoRes.error) throw promoRes.error;
      if (conRes.error) throw conRes.error;

      // ====== Map Add-ons
      const addMapped: CancelItemAddOn[] = (addRes.data ?? []).map((r) => {
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

      // group add-ons (same as UI)
      const addGroups: CancelGroupAddOn[] = (() => {
        if (addMapped.length === 0) return [];
        const sorted = [...addMapped].sort((a, b) => ms(a.cancelled_at) - ms(b.cancelled_at));

        const groups: CancelGroupAddOn[] = [];
        let current: CancelGroupAddOn | null = null;
        let last: CancelItemAddOn | null = null;

        const sameKey = (a: CancelItemAddOn, b: CancelItemAddOn): boolean =>
          norm(a.full_name) === norm(b.full_name) &&
          norm(a.seat_number) === norm(b.seat_number) &&
          norm(a.description) === norm(b.description);

        for (const r of sorted) {
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
      })();

      // ====== Map sessions
      const mapSessions = (rows: CancelledSessionDB[]): CancelledSession[] =>
        (rows ?? []).map((r) => ({
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
          discount_kind: normalizeDiscountKind(r.discount_kind),
          discount_value: round2(Math.max(0, toNumber(r.discount_value as NumericLike))),
          discount_reason: r.discount_reason ?? null,
          down_payment: round2(Math.max(0, toNumber(r.down_payment as NumericLike))),
          gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount as NumericLike))),
          cash_amount: round2(Math.max(0, toNumber(r.cash_amount as NumericLike))),
          is_paid: toBool(r.is_paid),
          paid_at: r.paid_at ?? null,
        }));

      const walkin = mapSessions(walkRes.data ?? []);
      const reservation = mapSessions(resRes.data ?? []);

      // ====== Map promo (needs lookups)
      const promoRows = promoRes.data ?? [];
      let promoMapped: CancelledPromo[] = [];

      if (promoRows.length > 0) {
        const pkgIds = Array.from(new Set(promoRows.map((r) => String(r.package_id)).filter((x) => x.length > 0)));
        const optIds = Array.from(new Set(promoRows.map((r) => String(r.package_option_id)).filter((x) => x.length > 0)));

        const [pkgRes2, optRes2] = await Promise.all([
          pkgIds.length
            ? supabase.from("packages").select("id,title").in("id", pkgIds).returns<PackageRow[]>()
            : Promise.resolve({ data: [] as PackageRow[], error: null as unknown }),
          optIds.length
            ? supabase
                .from("package_options")
                .select("id,option_name,duration_value,duration_unit")
                .in("id", optIds)
                .returns<PackageOptionRow[]>()
            : Promise.resolve({ data: [] as PackageOptionRow[], error: null as unknown }),
        ]);

        const pkgMap = new Map<string, PackageRow>();
        ((pkgRes2 as { data: PackageRow[] }).data ?? []).forEach((p) => pkgMap.set(p.id, p));

        const optMap = new Map<string, PackageOptionRow>();
        ((optRes2 as { data: PackageOptionRow[] }).data ?? []).forEach((o) => optMap.set(o.id, o));

        promoMapped = promoRows.map((r) => {
          const kind = normalizeDiscountKind(r.discount_kind);
          const base = round2(Math.max(0, toNumber(r.price as NumericLike)));
          const discVal = round2(Math.max(0, toNumber(r.discount_value as NumericLike)));

          const pkg = pkgMap.get(String(r.package_id));
          const opt = optMap.get(String(r.package_option_id));

          return {
            id: r.id,
            cancelled_at: r.cancelled_at,
            original_id: r.original_id,
            description: String(r.description ?? "").trim() || "-",
            created_at: r.created_at,
            full_name: String(r.full_name ?? "-"),
            phone_number: r.phone_number ?? null,
            area: r.area,
            seat_number: r.seat_number ?? null,
            start_at: r.start_at,
            end_at: r.end_at,
            price: base,
            status: String(r.status ?? "pending"),
            gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount as NumericLike))),
            cash_amount: round2(Math.max(0, toNumber(r.cash_amount as NumericLike))),
            is_paid: toBool(r.is_paid),
            paid_at: r.paid_at ?? null,
            discount_kind: kind,
            discount_value: discVal,
            discount_reason: r.discount_reason ?? null,
            package_title: String(pkg?.title ?? "").trim() || "—",
            option_name: String(opt?.option_name ?? "").trim() || "—",
            duration_value: opt?.duration_value ?? null,
            duration_unit: opt?.duration_unit ?? null,
          };
        });
      }

      // ====== Map consignment + group
      const conMapped: CancelItemConsignment[] = (conRes.data ?? []).map((r) => {
        const qty = Math.max(0, Math.floor(Number(r.quantity) || 0));
        const price = round2(Math.max(0, toNumber(r.price)));
        const total = round2(Math.max(0, toNumber(r.total)));
        const fixedTotal = total > 0 ? total : round2(qty * price);

        return {
          id: r.id,
          cancelled_at: r.cancelled_at,
          original_id: r.original_id,
          original_created_at: r.original_created_at ?? null,
          consignment_id: r.consignment_id,
          item_name: String(r.item_name ?? "-"),
          category: String(r.category ?? "-") || "-",
          size: r.size ?? null,
          image_url: r.image_url ?? null,
          quantity: qty,
          price,
          total: fixedTotal,
          full_name: String(r.full_name ?? "-"),
          seat_number: String(r.seat_number ?? "-"),
          gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
          cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
          is_paid: toBool(r.is_paid),
          paid_at: r.paid_at ?? null,
          was_voided: toBool(r.was_voided),
          voided_at: r.voided_at ?? null,
          void_note: r.void_note ?? null,
          cancel_note: String(r.cancel_note ?? "").trim() || "-",
          stock_returned: toBool(r.stock_returned),
        };
      });

      const conGroups: CancelGroupConsignment[] = (() => {
        if (conMapped.length === 0) return [];
        const sorted = [...conMapped].sort((a, b) => ms(a.cancelled_at) - ms(b.cancelled_at));

        const groups: CancelGroupConsignment[] = [];
        let current: CancelGroupConsignment | null = null;
        let last: CancelItemConsignment | null = null;

        const sameKey = (a: CancelItemConsignment, b: CancelItemConsignment): boolean =>
          norm(a.full_name) === norm(b.full_name) &&
          norm(a.seat_number) === norm(b.seat_number) &&
          norm(a.cancel_note) === norm(b.cancel_note);

        for (const r of sorted) {
          const startNew =
            current === null ||
            last === null ||
            !sameKey(r, last) ||
            Math.abs(ms(r.cancelled_at) - ms(last.cancelled_at)) > GROUP_WINDOW_MS;

          if (startNew) {
            const key = `${norm(r.full_name)}|${norm(r.seat_number)}|${ms(r.cancelled_at)}|${norm(r.cancel_note)}`;
            current = {
              key,
              cancelled_at: r.cancelled_at,
              full_name: r.full_name,
              seat_number: r.seat_number,
              cancel_note: r.cancel_note || "-",
              items: [],
              grand_total: 0,
              gcash_amount: 0,
              cash_amount: 0,
              is_paid: false,
              paid_at: null,
              was_voided: false,
              voided_at: null,
              void_note: null,
              stock_returned: false,
            };
            groups.push(current);
          }

          if (!current) continue;

          current.items.push({
            id: r.id,
            original_id: r.original_id,
            consignment_id: r.consignment_id,
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

          current.was_voided = current.was_voided || r.was_voided;
          current.voided_at = current.voided_at ?? r.voided_at;
          current.void_note = current.void_note ?? r.void_note;

          current.stock_returned = current.stock_returned || r.stock_returned;

          last = r;
        }

        return groups.sort((a, b) => ms(b.cancelled_at) - ms(a.cancelled_at));
      })();

      // ====== Build workbook
      const wb = new ExcelJS.Workbook();
      wb.creator = "Me Tyme Lounge";
      wb.created = new Date();

      const ws = wb.addWorksheet("Cancelled Records", {
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        properties: { defaultRowHeight: 18 },
        views: [{ state: "frozen", ySplit: 5 }],
      });

      ws.columns = [
        { width: 22 }, // 1
        { width: 14 }, // 2
        { width: 18 }, // 3
        { width: 22 }, // 4
        { width: 18 }, // 5
        { width: 16 }, // 6
        { width: 12 }, // 7
        { width: 14 }, // 8
        { width: 12 }, // 9
        { width: 12 }, // 10
        { width: 18 }, // 11
        { width: 16 }, // 12
        { width: 16 }, // 13
        { width: 12 }, // 14
        { width: 30 }, // 15
        { width: 22 }, // 16
        { width: 22 }, // 17
        { width: 22 }, // 18
      ];

      const borderAll: Partial<ExcelJS.Borders> = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };

      const fillSolid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

      const setCell = (
        rowNo: number,
        colNo: number,
        value: ExcelJS.CellValue,
        opts?: { bold?: boolean; center?: boolean; right?: boolean; wrap?: boolean; fill?: string; numFmt?: string; size?: number }
      ): void => {
        const cell = ws.getCell(rowNo, colNo);
        cell.value = value;
        cell.border = borderAll;

        cell.font = { bold: Boolean(opts?.bold), size: opts?.size ?? 11 };

        const h = opts?.center ? "center" : opts?.right ? "right" : ("left" as ExcelJS.Alignment["horizontal"]);
        cell.alignment = { vertical: "middle", horizontal: h, wrapText: opts?.wrap ?? true };

        if (opts?.fill) cell.fill = fillSolid(opts.fill);
        if (opts?.numFmt) cell.numFmt = opts.numFmt;
      };

      const mergeTitle = (rowNo: number, text: string, fill: string): void => {
        ws.mergeCells(rowNo, 1, rowNo, 18);
        setCell(rowNo, 1, text, { bold: true, center: true, size: 16, fill });
        ws.getRow(rowNo).height = 28;
      };

      const mergeSub = (rowNo: number, text: string): void => {
        ws.mergeCells(rowNo, 1, rowNo, 18);
        setCell(rowNo, 1, text, { bold: true, center: true, fill: "FFF3F4F6" });
      };

      const sectionTitle = (rowNo: number, text: string): void => {
        ws.mergeCells(rowNo, 1, rowNo, 18);
        setCell(rowNo, 1, text, { bold: true, fill: "FFE5E7EB", size: 13 });
        ws.getRow(rowNo).height = 22;
      };

      const header = (rowNo: number, cols: Array<{ c: number; label: string }>): void => {
        for (let c = 1; c <= 18; c++) setCell(rowNo, c, "", { fill: "FFF9FAFB" });
        for (const x of cols) setCell(rowNo, x.c, x.label, { bold: true, center: true, fill: "FFF3F4F6", wrap: true });
        ws.getRow(rowNo).height = 20;
      };

      // ✅ TS-safe clearRow (NO undefined)
      const clearRow = (rowNo: number): void => {
        for (let c = 1; c <= 18; c++) {
          const cell = ws.getCell(rowNo, c);
          cell.value = "";
          cell.border = {};
          cell.fill = { type: "pattern", pattern: "none" };
          cell.font = { size: 11, bold: false };
          cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
          cell.numFmt = "General";
        }
      };

      // Logo optional
      try {
        const res = await fetch(logo);
        const buf = await res.arrayBuffer();
        const imgId = wb.addImage({ buffer: buf, extension: "png" });
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 90, height: 90 } });
      } catch {
        // ignore
      }

      mergeTitle(1, "ME TYME LOUNGE — CANCELLED RECORDS", "FFFFFFFF");
      mergeSub(2, `Date (Cancelled): ${selectedDate}`);
      mergeSub(3, `Generated: ${new Date().toLocaleString("en-PH")}`);
      clearRow(4);

      let r = 5;

      // ====== 1) Add-ons
      sectionTitle(r, "1) CANCELLED ADD-ONS (Grouped)");
      r++;

      header(r, [
        { c: 1, label: "Cancelled At" },
        { c: 2, label: "Full Name" },
        { c: 3, label: "Seat" },
        { c: 4, label: "Item" },
        { c: 5, label: "Category" },
        { c: 6, label: "Size" },
        { c: 7, label: "Qty" },
        { c: 8, label: "Price" },
        { c: 9, label: "Total" },
        { c: 10, label: "Paid" },
        { c: 11, label: "Description" },
      ]);
      r++;

      let addTotal = 0;
      let addItemCount = 0;

      for (const g of addGroups) {
        for (const it of g.items) {
          addItemCount += 1;
          addTotal = round2(addTotal + it.total);

          setCell(r, 1, formatDateTime(g.cancelled_at));
          setCell(r, 2, g.full_name || "-");
          setCell(r, 3, g.seat_number || "-", { center: true });
          setCell(r, 4, it.item_name || "-");
          setCell(r, 5, it.category || "-");
          setCell(r, 6, sizeText(it.size), { center: true });
          setCell(r, 7, it.quantity, { center: true });
          setCell(r, 8, it.price, { right: true, numFmt: "₱#,##0.00" });
          setCell(r, 9, it.total, { right: true, numFmt: "₱#,##0.00" });
          setCell(r, 10, g.is_paid ? "PAID" : "UNPAID", { center: true });
          setCell(r, 11, g.description || "-");
          for (let c = 12; c <= 18; c++) setCell(r, c, "");
          r++;
        }
      }

      ws.mergeCells(r, 1, r, 8);
      setCell(r, 1, "ADD-ONS TOTAL", { bold: true, right: true, fill: "FFF9FAFB" });
      setCell(r, 9, addTotal, { bold: true, right: true, fill: "FFF9FAFB", numFmt: "₱#,##0.00" });
      for (let c = 10; c <= 18; c++) setCell(r, c, "", { fill: "FFF9FAFB" });
      r += 2;

      // ====== 2) Walk-in
      sectionTitle(r, "2) CANCELLED WALK-IN");
      r++;

      header(r, [
        { c: 1, label: "Cancelled At" },
        { c: 2, label: "Date" },
        { c: 3, label: "Full Name" },
        { c: 4, label: "Phone" },
        { c: 5, label: "Seat" },
        { c: 6, label: "Type" },
        { c: 7, label: "Hours" },
        { c: 8, label: "Time In" },
        { c: 9, label: "Time Out" },
        { c: 10, label: "Amount (After Discount)" },
        { c: 11, label: "Discount" },
        { c: 12, label: "Down Payment" },
        { c: 13, label: "Paid" },
        { c: 14, label: "Cancel Reason" },
      ]);
      r++;

      let wTotal = 0;
      for (const s of walkin) {
        const base = round2(Math.max(0, s.total_amount));
        const disc = applyDiscount(base, s.discount_kind, s.discount_value);
        const dp = round2(Math.max(0, s.down_payment));
        wTotal = round2(wTotal + disc.discountedCost);

        setCell(r, 1, formatDateTime(s.cancelled_at));
        setCell(r, 2, s.date, { center: true });
        setCell(r, 3, s.full_name);
        setCell(r, 4, String(s.phone_number ?? "").trim() || "N/A");
        setCell(r, 5, s.seat_number, { center: true });
        setCell(r, 6, s.customer_type, { center: true });
        setCell(r, 7, s.hour_avail, { center: true });
        setCell(r, 8, formatTimeText(s.time_started), { center: true });
        setCell(r, 9, formatTimeText(s.time_ended), { center: true });
        setCell(r, 10, disc.discountedCost, { right: true, numFmt: "₱#,##0.00" });
        setCell(r, 11, getDiscountText(s.discount_kind, s.discount_value), { center: true });
        setCell(r, 12, dp, { right: true, numFmt: "₱#,##0.00" });
        setCell(r, 13, s.is_paid ? "PAID" : "UNPAID", { center: true });
        setCell(r, 14, s.cancel_reason || "-", { wrap: true });
        for (let c = 15; c <= 18; c++) setCell(r, c, "");
        r++;
      }

      ws.mergeCells(r, 1, r, 9);
      setCell(r, 1, "WALK-IN TOTAL (After Discount)", { bold: true, right: true, fill: "FFF9FAFB" });
      setCell(r, 10, wTotal, { bold: true, right: true, fill: "FFF9FAFB", numFmt: "₱#,##0.00" });
      for (let c = 11; c <= 18; c++) setCell(r, c, "", { fill: "FFF9FAFB" });
      r += 2;

      // ====== 3) Reservation
      sectionTitle(r, "3) CANCELLED RESERVATION");
      r++;

      header(r, [
        { c: 1, label: "Cancelled At" },
        { c: 2, label: "Date" },
        { c: 3, label: "Reservation Date" },
        { c: 4, label: "Full Name" },
        { c: 5, label: "Phone" },
        { c: 6, label: "Seat" },
        { c: 7, label: "Type" },
        { c: 8, label: "Hours" },
        { c: 9, label: "Time In" },
        { c: 10, label: "Time Out" },
        { c: 11, label: "Amount (After Discount)" },
        { c: 12, label: "Discount" },
        { c: 13, label: "Down Payment" },
        { c: 14, label: "Paid" },
        { c: 15, label: "Cancel Reason" },
      ]);
      r++;

      let resTotal = 0;
      for (const s of reservation) {
        const base = round2(Math.max(0, s.total_amount));
        const disc = applyDiscount(base, s.discount_kind, s.discount_value);
        const dp = round2(Math.max(0, s.down_payment));
        resTotal = round2(resTotal + disc.discountedCost);

        setCell(r, 1, formatDateTime(s.cancelled_at));
        setCell(r, 2, s.date, { center: true });
        setCell(r, 3, s.reservation_date ?? "-", { center: true });
        setCell(r, 4, s.full_name);
        setCell(r, 5, String(s.phone_number ?? "").trim() || "N/A");
        setCell(r, 6, s.seat_number, { center: true });
        setCell(r, 7, s.customer_type, { center: true });
        setCell(r, 8, s.hour_avail, { center: true });
        setCell(r, 9, formatTimeText(s.time_started), { center: true });
        setCell(r, 10, formatTimeText(s.time_ended), { center: true });
        setCell(r, 11, disc.discountedCost, { right: true, numFmt: "₱#,##0.00" });
        setCell(r, 12, getDiscountText(s.discount_kind, s.discount_value), { center: true });
        setCell(r, 13, dp, { right: true, numFmt: "₱#,##0.00" });
        setCell(r, 14, s.is_paid ? "PAID" : "UNPAID", { center: true });
        setCell(r, 15, s.cancel_reason || "-", { wrap: true });
        for (let c = 16; c <= 18; c++) setCell(r, c, "");
        r++;
      }

      ws.mergeCells(r, 1, r, 10);
      setCell(r, 1, "RESERVATION TOTAL (After Discount)", { bold: true, right: true, fill: "FFF9FAFB" });
      setCell(r, 11, resTotal, { bold: true, right: true, fill: "FFF9FAFB", numFmt: "₱#,##0.00" });
      for (let c = 12; c <= 18; c++) setCell(r, c, "", { fill: "FFF9FAFB" });
      r += 2;

      // ====== 4) Promo
      sectionTitle(r, "4) CANCELLED PROMO (Membership)");
      r++;

      header(r, [
        { c: 1, label: "Cancelled At" },
        { c: 2, label: "Customer" },
        { c: 3, label: "Phone" },
        { c: 4, label: "Area" },
        { c: 5, label: "Seat" },
        { c: 6, label: "Package" },
        { c: 7, label: "Option" },
        { c: 8, label: "Start" },
        { c: 9, label: "End" },
        { c: 10, label: "Final Cost" },
        { c: 11, label: "Discount" },
        { c: 12, label: "Paid" },
        { c: 13, label: "Description" },
      ]);
      r++;

      let promoTotal = 0;
      for (const p of promoMapped) {
        const base = round2(Math.max(0, p.price));
        const disc = applyDiscount(base, p.discount_kind, p.discount_value);
        const due = round2(disc.discountedCost);
        promoTotal = round2(promoTotal + due);

        const optText =
          p.duration_value && p.duration_unit
            ? `${p.option_name} • ${formatDuration(Number(p.duration_value), p.duration_unit)}`
            : p.option_name;

        setCell(r, 1, formatDateTime(p.cancelled_at));
        setCell(r, 2, p.full_name);
        setCell(r, 3, String(p.phone_number ?? "").trim() || "N/A");
        setCell(r, 4, prettyArea(p.area), { center: true });
        setCell(r, 5, seatLabelPromo(p.area, p.seat_number), { center: true });
        setCell(r, 6, p.package_title);
        setCell(r, 7, optText);
        setCell(r, 8, formatDateTime(p.start_at));
        setCell(r, 9, formatDateTime(p.end_at));
        setCell(r, 10, due, { right: true, numFmt: "₱#,##0.00" });
        setCell(r, 11, getDiscountText(p.discount_kind, p.discount_value), { center: true });
        setCell(r, 12, p.is_paid ? "PAID" : "UNPAID", { center: true });
        setCell(r, 13, p.description || "-", { wrap: true });
        for (let c = 14; c <= 18; c++) setCell(r, c, "");
        r++;
      }

      ws.mergeCells(r, 1, r, 9);
      setCell(r, 1, "PROMO TOTAL (After Discount)", { bold: true, right: true, fill: "FFF9FAFB" });
      setCell(r, 10, promoTotal, { bold: true, right: true, fill: "FFF9FAFB", numFmt: "₱#,##0.00" });
      for (let c = 11; c <= 18; c++) setCell(r, c, "", { fill: "FFF9FAFB" });
      r += 2;

      // ====== 5) Consignment
      sectionTitle(r, "5) CANCELLED CONSIGNMENT (Grouped)");
      r++;

      header(r, [
        { c: 1, label: "Cancelled At" },
        { c: 2, label: "Full Name" },
        { c: 3, label: "Seat" },
        { c: 4, label: "Item" },
        { c: 5, label: "Category" },
        { c: 6, label: "Size" },
        { c: 7, label: "Qty" },
        { c: 8, label: "Price" },
        { c: 9, label: "Total" },
        { c: 10, label: "Paid" },
        { c: 11, label: "Cancel Note" },
        { c: 12, label: "Voided" },
        { c: 13, label: "Void Note" },
        { c: 14, label: "Stock Returned" },
      ]);
      r++;

      let conTotal = 0;
      let conItemCount = 0;

      for (const g of conGroups) {
        for (const it of g.items) {
          conItemCount += 1;
          conTotal = round2(conTotal + it.total);

          setCell(r, 1, formatDateTime(g.cancelled_at));
          setCell(r, 2, g.full_name || "-");
          setCell(r, 3, g.seat_number || "-", { center: true });
          setCell(r, 4, it.item_name || "-");
          setCell(r, 5, it.category || "-");
          setCell(r, 6, sizeText(it.size), { center: true });
          setCell(r, 7, it.quantity, { center: true });
          setCell(r, 8, it.price, { right: true, numFmt: "₱#,##0.00" });
          setCell(r, 9, it.total, { right: true, numFmt: "₱#,##0.00" });
          setCell(r, 10, g.is_paid ? "PAID" : "UNPAID", { center: true });
          setCell(r, 11, g.cancel_note || "-");
          setCell(r, 12, g.was_voided ? "YES" : "NO", { center: true });
          setCell(r, 13, String(g.void_note ?? "").trim() || "—");
          setCell(r, 14, g.stock_returned ? "YES" : "NO", { center: true });
          for (let c = 15; c <= 18; c++) setCell(r, c, "");
          r++;
        }
      }

      ws.mergeCells(r, 1, r, 8);
      setCell(r, 1, "CONSIGNMENT TOTAL", { bold: true, right: true, fill: "FFF9FAFB" });
      setCell(r, 9, conTotal, { bold: true, right: true, fill: "FFF9FAFB", numFmt: "₱#,##0.00" });
      for (let c = 10; c <= 18; c++) setCell(r, c, "", { fill: "FFF9FAFB" });
      r += 2;

      // ====== SUMMARY
      sectionTitle(r, "SUMMARY");
      r++;

      header(r, [
        { c: 1, label: "Section" },
        { c: 2, label: "Count" },
        { c: 3, label: "Total" },
      ]);
      r++;

      setCell(r, 1, "Add-Ons (items)", { bold: true });
      setCell(r, 2, addItemCount, { center: true });
      setCell(r, 3, addTotal, { right: true, numFmt: "₱#,##0.00" });
      for (let c = 4; c <= 18; c++) setCell(r, c, "");
      r++;

      setCell(r, 1, "Walk-in", { bold: true });
      setCell(r, 2, walkin.length, { center: true });
      setCell(r, 3, wTotal, { right: true, numFmt: "₱#,##0.00" });
      for (let c = 4; c <= 18; c++) setCell(r, c, "");
      r++;

      setCell(r, 1, "Reservation", { bold: true });
      setCell(r, 2, reservation.length, { center: true });
      setCell(r, 3, resTotal, { right: true, numFmt: "₱#,##0.00" });
      for (let c = 4; c <= 18; c++) setCell(r, c, "");
      r++;

      setCell(r, 1, "Promo (Membership)", { bold: true });
      setCell(r, 2, promoMapped.length, { center: true });
      setCell(r, 3, promoTotal, { right: true, numFmt: "₱#,##0.00" });
      for (let c = 4; c <= 18; c++) setCell(r, c, "");
      r++;

      setCell(r, 1, "Consignment (items)", { bold: true });
      setCell(r, 2, conItemCount, { center: true });
      setCell(r, 3, conTotal, { right: true, numFmt: "₱#,##0.00" });
      for (let c = 4; c <= 18; c++) setCell(r, c, "");
      r++;

      ws.mergeCells(r, 1, r, 2);
      setCell(r, 1, "GRAND TOTAL", { bold: true, right: true, fill: "FFF3F4F6" });
      setCell(r, 3, round2(addTotal + wTotal + resTotal + promoTotal + conTotal), {
        bold: true,
        right: true,
        fill: "FFF3F4F6",
        numFmt: "₱#,##0.00",
      });
      for (let c = 4; c <= 18; c++) setCell(r, c, "", { fill: "FFF3F4F6" });

      ws.getRow(1).height = 30;
      ws.getRow(2).height = 20;
      ws.getRow(3).height = 18;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, `Cancelled_Records_${selectedDate}.xlsx`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Export failed.");
    } finally {
      setBusyExport(false);
    }
  };

  /* =========================
     UI
  ========================= */
  const tabTitle = tabTitleFrom(tab);

  const countText =
    tab === "addons"
      ? groupedAddOns.length
      : tab === "consignment"
      ? groupedConsignment.length
      : tab === "promo"
      ? rowsPromo.length
      : rowsSessions.length;

  return (
    <IonPage>
      <IonContent className="cancelled-content">
        <IonAlert
          isOpen={confirmDeleteDate}
          onDidDismiss={() => setConfirmDeleteDate(false)}
          header="Delete Cancelled Records"
          message={`Delete ALL cancelled records for ${selectedDate}? (Add-Ons + Walk-in + Reservation + Promo + Consignment)`}
          buttons={[
            { text: "Cancel", role: "cancel" },
            { text: busyDelete ? "Deleting..." : "Delete", role: "destructive", handler: () => void deleteByDateAll() },
          ]}
        />

        <div className="customer-lists-container">
          {/* TOP BAR (SAME AS CUSTOMER CANCELLED) + ADMIN BUTTONS */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">{tabTitle} Records</h2>
              <div className="customer-subtext">
                Showing cancelled records for: <strong>{selectedDate}</strong> ({countText})
              </div>
              <div className="customer-subtext" style={{ fontSize: 12, opacity: 0.75 }}>
                Read-only: cancelled records cannot be edited. (Admin can delete/export)
              </div>
            </div>

            <div className="customer-topbar-right" style={{ gap: 10, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
              {/* DROPDOWN */}
              <label className="date-pill" style={{ minWidth: 240 }}>
                <span className="date-pill-label">Type</span>
                <select
                  className="date-pill-input"
                  value={tab}
                  onChange={(e) => setTab(e.currentTarget.value as CancelTab)}
                  aria-label="Cancelled type"
                  style={{ paddingRight: 34 }}
                >
                  <option value="addons">{TAB_LABEL.addons}</option>
                  <option value="walkin">{TAB_LABEL.walkin}</option>
                  <option value="reservation">{TAB_LABEL.reservation}</option>
                  <option value="promo">{TAB_LABEL.promo}</option>
                  <option value="consignment">{TAB_LABEL.consignment}</option>
                </select>
                <span className="date-pill-icon" aria-hidden="true">
                  ▾
                </span>
              </label>

              {/* DATE */}
              <label className="date-pill">
                <span className="date-pill-label">Date</span>
                <input className="date-pill-input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))} />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>

              <button className="receipt-btn" onClick={() => void refresh()} style={{ whiteSpace: "nowrap" }} type="button" disabled={loading || busyDelete}>
                Refresh
              </button>

              <button className="receipt-btn" onClick={() => void exportExcelAll()} style={{ whiteSpace: "nowrap" }} type="button" disabled={busyExport || busyDelete}>
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

                    <button className="close-btn" onClick={() => setSelectedGroupAddOns(null)} type="button">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* =========================
              TAB: WALK-IN / RESERVATION
          ========================= */}
          {tab !== "addons" && tab !== "promo" && tab !== "consignment" && (
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
                      {selectedSession.reservation === "yes" ? "CANCELLED RESERVATION RECEIPT" : "CANCELLED WALK-IN RECEIPT"}
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

                    <button className="close-btn" onClick={() => setSelectedSession(null)} type="button">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* =========================
              TAB: PROMO (Membership)
          ========================= */}
          {tab === "promo" && (
            <>
              {loading ? (
                <p className="customer-note">Loading...</p>
              ) : rowsPromo.length === 0 ? (
                <p className="customer-note">No cancelled promo (membership) records found for this date</p>
              ) : (
                <div className="customer-table-wrap" key={`${selectedDate}-promo`}>
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Cancelled At</th>
                        <th>Customer</th>
                        <th>Phone #</th>
                        <th>Area</th>
                        <th>Seat</th>
                        <th>Package</th>
                        <th>Option</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Total</th>
                        <th>Discount</th>
                        <th>Paid</th>
                        <th>Description</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {rowsPromo.map((p) => {
                        const base = round2(Math.max(0, p.price));
                        const disc = applyDiscount(base, p.discount_kind, p.discount_value);
                        const due = round2(disc.discountedCost);

                        return (
                          <tr key={p.id}>
                            <td>{formatDateTime(p.cancelled_at)}</td>
                            <td>{p.full_name}</td>
                            <td>{String(p.phone_number ?? "").trim() || "N/A"}</td>
                            <td>{prettyArea(p.area)}</td>
                            <td>{seatLabelPromo(p.area, p.seat_number)}</td>
                            <td>{p.package_title}</td>
                            <td>
                              {p.duration_value && p.duration_unit
                                ? `${p.option_name} • ${formatDuration(Number(p.duration_value), p.duration_unit)}`
                                : p.option_name}
                            </td>
                            <td>{formatDateTime(p.start_at)}</td>
                            <td>{formatDateTime(p.end_at)}</td>
                            <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(due)}</td>
                            <td>{getDiscountText(p.discount_kind, p.discount_value)}</td>
                            <td>
                              <ReadOnlyBadge paid={p.is_paid} />
                            </td>
                            <td style={{ minWidth: 220 }}>
                              <div className="cancel-desc">{p.description || "-"}</div>
                            </td>
                            <td>
                              <div className="action-stack">
                                <button className="receipt-btn" onClick={() => setSelectedPromo(p)} type="button">
                                  View Receipt
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

              {/* RECEIPT MODAL (PROMO) */}
              {selectedPromo && (
                <div className="receipt-overlay" onClick={() => setSelectedPromo(null)}>
                  <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                    <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                    <h3 className="receipt-title">ME TYME LOUNGE</h3>
                    <p className="receipt-subtitle">CANCELLED PROMO (MEMBERSHIP) RECEIPT</p>

                    <hr />

                    <div className="receipt-row">
                      <span>Cancelled At</span>
                      <span>{formatDateTime(selectedPromo.cancelled_at)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Customer</span>
                      <span>{selectedPromo.full_name}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Phone #</span>
                      <span>{String(selectedPromo.phone_number ?? "").trim() || "N/A"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Area</span>
                      <span>{prettyArea(selectedPromo.area)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Seat</span>
                      <span>{seatLabelPromo(selectedPromo.area, selectedPromo.seat_number)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Description</span>
                      <span style={{ fontWeight: 800 }}>{selectedPromo.description || "-"}</span>
                    </div>

                    <hr />

                    <div className="receipt-row">
                      <span>Package</span>
                      <span>{selectedPromo.package_title}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Option</span>
                      <span>
                        {selectedPromo.duration_value && selectedPromo.duration_unit
                          ? `${selectedPromo.option_name} • ${formatDuration(Number(selectedPromo.duration_value), selectedPromo.duration_unit)}`
                          : selectedPromo.option_name}
                      </span>
                    </div>

                    <hr />

                    <div className="receipt-row">
                      <span>Start</span>
                      <span>{formatDateTime(selectedPromo.start_at)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>End</span>
                      <span>{formatDateTime(selectedPromo.end_at)}</span>
                    </div>

                    <hr />

                    {(() => {
                      const base = round2(Math.max(0, selectedPromo.price));
                      const disc = applyDiscount(base, selectedPromo.discount_kind, selectedPromo.discount_value);
                      const due = round2(disc.discountedCost);

                      const paidTotal = round2(selectedPromo.gcash_amount + selectedPromo.cash_amount);
                      const remaining = round2(Math.max(0, due - paidTotal));

                      return (
                        <>
                          <div className="receipt-row">
                            <span>System Cost (Before)</span>
                            <span>{moneyText(base)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Discount</span>
                            <span>{getDiscountText(selectedPromo.discount_kind, selectedPromo.discount_value)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Final Cost</span>
                            <span>{moneyText(due)}</span>
                          </div>

                          <hr />

                          <div className="receipt-row">
                            <span>GCash</span>
                            <span>{moneyText(selectedPromo.gcash_amount)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Cash</span>
                            <span>{moneyText(selectedPromo.cash_amount)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Total Paid</span>
                            <span>{moneyText(paidTotal)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Remaining</span>
                            <span>{moneyText(remaining)}</span>
                          </div>

                          <div className="receipt-row">
                            <span>Status</span>
                            <span className="receipt-status">{selectedPromo.is_paid ? "PAID" : "UNPAID"}</span>
                          </div>

                          <div className="receipt-total">
                            <span>TOTAL</span>
                            <span>{moneyText(due)}</span>
                          </div>
                        </>
                      );
                    })()}

                    <p className="receipt-footer">
                      Cancelled record archived <br />
                      <strong>Me Tyme Lounge</strong>
                    </p>

                    <button className="close-btn" onClick={() => setSelectedPromo(null)} type="button">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* =========================
              TAB: CONSIGNMENT
          ========================= */}
          {tab === "consignment" && (
            <>
              {loading ? (
                <p className="customer-note">Loading...</p>
              ) : groupedConsignment.length === 0 ? (
                <p className="customer-note">No cancelled consignment records found for this date</p>
              ) : (
                <div className="customer-table-wrap" key={`${selectedDate}-consignment`}>
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Cancelled At</th>
                        <th>Full Name</th>
                        <th>Seat</th>
                        <th>Items</th>
                        <th>Grand Total</th>
                        <th>Cancel Note</th>
                        <th>Paid</th>
                        <th>Voided</th>
                        <th>Stock Returned</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {groupedConsignment.map((g) => (
                        <tr key={g.key}>
                          <td>{formatDateTime(g.cancelled_at)}</td>
                          <td>{g.full_name || "-"}</td>
                          <td>{g.seat_number || "-"}</td>

                          <td>
                            <div style={{ display: "grid", gap: 6, minWidth: 280 }}>
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
                            <div className="cancel-desc">{g.cancel_note || "-"}</div>
                          </td>

                          <td>
                            <ReadOnlyBadge paid={g.is_paid} />
                          </td>

                          <td style={{ fontWeight: 900, textAlign: "center" }}>{g.was_voided ? "YES" : "NO"}</td>
                          <td style={{ fontWeight: 900, textAlign: "center" }}>{g.stock_returned ? "YES" : "NO"}</td>

                          <td>
                            <div className="action-stack">
                              <button className="receipt-btn" onClick={() => setSelectedGroupConsignment(g)} type="button">
                                View Receipt
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* RECEIPT MODAL (CONSIGNMENT) */}
              {selectedGroupConsignment && (
                <div className="receipt-overlay" onClick={() => setSelectedGroupConsignment(null)}>
                  <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                    <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                    <h3 className="receipt-title">ME TYME LOUNGE</h3>
                    <p className="receipt-subtitle">CANCELLED CONSIGNMENT RECEIPT</p>

                    <hr />

                    <div className="receipt-row">
                      <span>Cancelled At</span>
                      <span>{formatDateTime(selectedGroupConsignment.cancelled_at)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Customer</span>
                      <span>{selectedGroupConsignment.full_name}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Seat</span>
                      <span>{selectedGroupConsignment.seat_number}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Cancel Note</span>
                      <span style={{ fontWeight: 800 }}>{selectedGroupConsignment.cancel_note || "-"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Status</span>
                      <span className="receipt-status">{selectedGroupConsignment.is_paid ? "PAID" : "UNPAID"}</span>
                    </div>

                    <hr />

                    {selectedGroupConsignment.items.map((it) => (
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
                      <span style={{ fontWeight: 900 }}>{moneyText(selectedGroupConsignment.grand_total)}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Voided</span>
                      <span style={{ fontWeight: 900 }}>{selectedGroupConsignment.was_voided ? "YES" : "NO"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Void Note</span>
                      <span>{String(selectedGroupConsignment.void_note ?? "").trim() || "—"}</span>
                    </div>

                    <div className="receipt-row">
                      <span>Stock Returned</span>
                      <span style={{ fontWeight: 900 }}>{selectedGroupConsignment.stock_returned ? "YES" : "NO"}</span>
                    </div>

                    <p className="receipt-footer">
                      Cancelled record archived <br />
                      <strong>Me Tyme Lounge</strong>
                    </p>

                    <button className="close-btn" onClick={() => setSelectedGroupConsignment(null)} type="button">
                      Close
                    </button>
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
