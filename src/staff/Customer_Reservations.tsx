// src/pages/Customer_Reservations.tsx
// ✅ SAME STYLE/CLASSNAMES as Customer_Lists.tsx
// ✅ Shows ONLY RESERVATION records (reservation = "yes")
// ✅ Seat column INCLUDED
// ✅ Discount UI same as Customer_Lists (breakdown)
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Payment is based on TIME CONSUMED (System Cost after discount) — ❌ DOES NOT deduct Down Payment
// ✅ Down Payment column between Discount and Payment
// ✅ Down Payment is EDITABLE (modal) and saved to DB: customer_sessions.down_payment
// ✅ Receipt: removed "Edit DP" button
// ✅ Receipt auto-updates balance/change after DP edit (row + selectedSession updated)
// ✅ Phone # column beside Full Name
// ✅ View to Customer is REALTIME using SINGLE ROW customer_view_state (id=1)
// ✅ Search bar (Full Name only)
// ✅ Date filter uses reservation_date
// ✅ Stop Time for OPEN sessions (also releases seat_blocked_times end_at = now)
// ✅ CANCEL SAME AS Customer_Lists (ID-BASED, NO RPC)
// ✅ Payment modal FREE INPUTS (NO LIMIT) — Cash & GCash can exceed due
// ✅ REFRESH button beside DATE FILTER
// ✅ No "any"
// ✅ NEW FIX:
// - ALL MONEY VALUES are WHOLE NUMBERS ONLY
// - If value has decimal, ALWAYS ROUND UP
//   Example: 10.01 => 11, 10.99 => 11
// ✅ REMOVED FROM UI:
// - customer_field
// - id_number
// - Field column
// - Specific ID column
// ✅ NEW:
// - SORT BY TIME IN ASCENDING (earliest first)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

/* ✅ LOCAL STORAGE KEYS (fallback) */
const LS_VIEW_ENABLED = "customer_view_enabled";
const LS_SESSION_ID = "customer_view_session_id";

/* ✅ REALTIME TABLE (single row) */
const VIEW_STATE_TABLE = "customer_view_state";
const VIEW_STATE_ID = 1;

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;

  created_at?: string | null;
  staff_id?: string | null;

  date: string;
  reservation_date: string | null;

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
  seat_number: string;

  id_number?: string | null;
  promo_booking_id?: string | null;

  down_payment?: number | string | null;

  discount_kind?: DiscountKind;
  discount_value?: number | string;
  discount_reason?: string | null;

  gcash_amount?: number | string;
  cash_amount?: number | string;

  is_paid?: boolean | number | string | null;
  paid_at?: string | null;
}

type SeatBlockedRow = {
  id: string;
  seat_number: string;
  start_at: string;
  end_at: string;
  source: string;
  note: string | null;
};

type ViewStateRow = {
  id: number;
  enabled: boolean;
  session_id: string | null;
  updated_at: string;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatTimeText = (iso: string): string => {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const wholePeso = (n: number): number => Math.ceil(Math.max(0, Number.isFinite(n) ? n : 0));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
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

// kept from your original discount-save behavior
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = wholePeso(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = wholePeso(Math.min(d, Math.max(0, gcash)));
  const c = wholePeso(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

const splitSeats = (seatStr: string): string[] => {
  return String(seatStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toUpperCase() !== "N/A");
};

const Customer_Reservations: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const [, setViewTick] = useState<number>(0);

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [searchName, setSearchName] = useState<string>("");

  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  const [viewEnabled, setViewEnabled] = useState<boolean>(false);
  const [viewSessionId, setViewSessionId] = useState<string>("");

  const viewHydratedRef = useRef<boolean>(false);

  const [cancelTarget, setCancelTarget] = useState<CustomerSession | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancellingBusy, setCancellingBusy] = useState<boolean>(false);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    void fetchReservationSessions();
  }, []);

  /* =========================
     REALTIME VIEW STATE
  ========================= */

  const writeLocalFallback = (enabled: boolean, sessionId: string | null): void => {
    localStorage.setItem(LS_VIEW_ENABLED, String(enabled));
    if (enabled && sessionId) localStorage.setItem(LS_SESSION_ID, sessionId);
    else localStorage.removeItem(LS_SESSION_ID);
  };

  const readLocalFallback = (): { enabled: boolean; sessionId: string } => {
    const enabled = String(localStorage.getItem(LS_VIEW_ENABLED) ?? "").toLowerCase() === "true";
    const sid = String(localStorage.getItem(LS_SESSION_ID) ?? "").trim();
    return { enabled, sessionId: sid };
  };

  const applyViewState = (enabled: boolean, sessionId: string): void => {
    setViewEnabled(enabled);
    setViewSessionId(sessionId);
    writeLocalFallback(enabled, enabled ? sessionId : null);
    setViewTick((x) => x + 1);
  };

  const hydrateViewState = async (): Promise<void> => {
    const { data, error } = await supabase
      .from(VIEW_STATE_TABLE)
      .select("id, enabled, session_id, updated_at")
      .eq("id", VIEW_STATE_ID)
      .maybeSingle();

    if (!error && data) {
      const row = data as ViewStateRow;
      const enabled = toBool(row.enabled);
      const sid = String(row.session_id ?? "").trim();
      applyViewState(enabled, sid);
      viewHydratedRef.current = true;
      return;
    }

    const local = readLocalFallback();
    applyViewState(local.enabled, local.sessionId);
    viewHydratedRef.current = true;
  };

  useEffect(() => {
    void hydrateViewState();

    const channel = supabase
      .channel("realtime_customer_view_state_reservations")
      .on("postgres_changes", { event: "*", schema: "public", table: VIEW_STATE_TABLE }, (payload) => {
        const next = (payload.new ?? null) as ViewStateRow | null;
        if (!next) return;
        if (Number(next.id) !== VIEW_STATE_ID) return;

        const enabled = toBool(next.enabled);
        const sid = String(next.session_id ?? "").trim();

        if (!viewHydratedRef.current) viewHydratedRef.current = true;
        applyViewState(enabled, sid);
      })
      .subscribe();

    const onStorage = (e: StorageEvent): void => {
      if (!e.key) return;
      if (e.key === LS_VIEW_ENABLED || e.key === LS_SESSION_ID) {
        const local = readLocalFallback();
        if (!viewHydratedRef.current) applyViewState(local.enabled, local.sessionId);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      void supabase.removeChannel(channel);
    };
  }, []);

  const isCustomerViewOnFor = (sessionId: string): boolean => viewEnabled && viewSessionId === sessionId;

  const setCustomerViewRealtime = async (enabled: boolean, sessionId: string | null): Promise<void> => {
    const sid = enabled && sessionId ? sessionId : null;

    applyViewState(Boolean(enabled), String(sid ?? ""));

    const { error } = await supabase
      .from(VIEW_STATE_TABLE)
      .update({
        enabled: Boolean(enabled),
        session_id: sid,
      })
      .eq("id", VIEW_STATE_ID);

    if (error) {
      console.warn("setCustomerViewRealtime error:", error.message);
      writeLocalFallback(Boolean(enabled), sid);
      setViewTick((x) => x + 1);
    }
  };

  const stopCustomerViewRealtime = async (): Promise<void> => {
    await setCustomerViewRealtime(false, null);
  };

  /* =========================
     LIST / FILTER
  ========================= */

  const filteredSessions = useMemo(() => {
    const q = searchName.trim().toLowerCase();

    return sessions
      .filter((s) => {
        const sameDate = (s.reservation_date ?? "") === selectedDate;
        if (!sameDate) return false;

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
  }, [sessions, selectedDate, searchName]);

  const fetchReservationSessions = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "yes")
      .order("reservation_date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading reservations");
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions((data as CustomerSession[]) || []);
    setLoading(false);
  };

  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await Promise.all([fetchReservationSessions(), hydrateViewState()]);
    } finally {
      setRefreshing(false);
    }
  };

  const phoneText = (s: CustomerSession): string => {
    const p = String(s.phone_number ?? "").trim();
    return p || "N/A";
  };

  const getDownPayment = (s: CustomerSession): number => wholePeso(Math.max(0, toMoney(s.down_payment ?? 0)));

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
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : wholePeso(toMoney(s.total_amount));
  };

  const getDiscountInfo = (s: CustomerSession): { kind: DiscountKind; value: number; reason: string } => {
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

  const getSessionBalanceAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, systemCost - dp));
  };

  const getSessionChangeAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, dp - systemCost));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const balance = getSessionBalanceAfterDP(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = wholePeso(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = wholePeso(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = wholePeso(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const releaseSeatBlocksNow = async (session: CustomerSession, nowIso: string): Promise<void> => {
    const seats = splitSeats(session.seat_number);
    if (seats.length === 0) return;

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("id, seat_number, start_at, end_at, source, note")
      .in("seat_number", seats)
      .eq("source", "reserved")
      .eq("start_at", session.time_started)
      .gt("end_at", nowIso);

    if (error) {
      console.warn("releaseSeatBlocksNow select:", error.message);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];
    if (rows.length === 0) {
      const { error: upErr } = await supabase
        .from("seat_blocked_times")
        .update({ end_at: nowIso, note: "stopped/cancelled (fallback)" })
        .in("seat_number", seats)
        .eq("source", "reserved")
        .gt("end_at", nowIso);

      if (upErr) {
        console.warn("releaseSeatBlocksNow fallback update:", upErr.message);
      }
      return;
    }

    const ids = rows.map((r) => r.id);
    const { error: upErr } = await supabase
      .from("seat_blocked_times")
      .update({ end_at: nowIso, note: "stopped/cancelled" })
      .in("id", ids);

    if (upErr) {
      console.warn("releaseSeatBlocksNow update:", upErr.message);
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

      setSessions((prev) => prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
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
    if (isOpenTimeSession(s)) return "Ongoing";
    const end = new Date(s.time_ended);
    if (!Number.isFinite(end.getTime())) return "Finished";
    return new Date() > end ? "Finished" : "Ongoing";
  };

  const getUsedMinutesForReceipt = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date().toISOString());
    return diffMinutes(s.time_started, s.time_ended);
  };

  const getChargeMinutesForReceipt = (s: CustomerSession): number => {
    const used = getUsedMinutesForReceipt(s);
    return Math.max(0, used - FREE_MINUTES);
  };

  /* =========================
     CANCEL FLOW
  ========================= */

  const openCancelModal = (s: CustomerSession): void => {
    setCancelTarget(s);
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

      if (isCustomerViewOnFor(row.id)) {
        try {
          await stopCustomerViewRealtime();
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

        id_number: row.id_number ?? null,
        seat_number: String(row.seat_number ?? "").trim() || "N/A",

        promo_booking_id: row.promo_booking_id ?? null,

        discount_kind: row.discount_kind ?? "none",
        discount_value: Math.max(0, toMoney(row.discount_value ?? 0)),
        discount_reason: row.discount_reason ?? null,

        gcash_amount: Math.max(0, toMoney(row.gcash_amount ?? 0)),
        cash_amount: Math.max(0, toMoney(row.cash_amount ?? 0)),
        is_paid: toBool(row.is_paid),
        paid_at: row.paid_at ?? null,

        phone_number: row.phone_number ?? null,
        down_payment: row.down_payment == null ? null : wholePeso(toMoney(row.down_payment)),
      };

      const { error: insertErr } = await supabase
        .from("customer_sessions_cancelled")
        .insert(cancelPayload);

      if (insertErr) {
        alert(`Cancel failed: ${insertErr.message}`);
        return;
      }

      const nowIso = new Date().toISOString();
      await releaseSeatBlocksNow(row, nowIso);

      const { error: deleteErr } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("id", row.id);

      if (deleteErr) {
        alert(`Cancelled copy saved, but delete failed: ${deleteErr.message}`);
        return;
      }

      setSessions((prev) => prev.filter((x) => x.id !== row.id));

      if (selectedSession?.id === row.id) setSelectedSession(null);

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

  /* =========================
     DISCOUNT
  ========================= */

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

    const base = getBaseSystemCost(discountTarget);
    const discounted = applyDiscount(base, discountKind, finalValue).discountedCost;
    const dueForPayment = wholePeso(Math.max(0, discounted));

    const prevPay = getPaidInfo(discountTarget);
    const adjPay = recalcPaymentsToDue(dueForPayment, prevPay.gcash);

    const totalPaid = wholePeso(adjPay.gcash + adjPay.cash);
    const autoPaid = dueForPayment <= 0 ? true : totalPaid >= dueForPayment;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),
          gcash_amount: adjPay.gcash,
          cash_amount: adjPay.cash,
          is_paid: autoPaid,
          paid_at: autoPaid ? new Date().toISOString() : null,
        })
        .eq("id", discountTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save discount error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === discountTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === discountTarget.id ? (updated as CustomerSession) : prev));
      setDiscountTarget(null);
    } catch (e) {
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  /* =========================
     DOWN PAYMENT
  ========================= */

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

      setSessions((prev) => prev.map((s) => (s.id === dpTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === dpTarget.id ? (updated as CustomerSession) : prev));
      setDpTarget(null);
    } catch (e) {
      console.error(e);
      alert("Save down payment failed.");
    } finally {
      setSavingDp(false);
    }
  };

  /* =========================
     PAYMENT
  ========================= */

  const openPaymentModal = (s: CustomerSession): void => {
    const pi = getPaidInfo(s);
    setPaymentTarget(s);
    setGcashInput(String(pi.gcash));
    setCashInput(String(pi.cash));
  };

  const setGcashFree = (gcashStr: string): void => {
    const v = wholePeso(Math.max(0, toMoney(gcashStr)));
    setGcashInput(String(v));
  };

  const setCashFree = (cashStr: string): void => {
    const v = wholePeso(Math.max(0, toMoney(cashStr)));
    setCashInput(String(v));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = wholePeso(Math.max(0, getSessionSystemCost(paymentTarget)));

    const gc = wholePeso(Math.max(0, toMoney(gcashInput)));
    const ca = wholePeso(Math.max(0, toMoney(cashInput)));

    const totalPaid = wholePeso(gc + ca);
    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          gcash_amount: gc,
          cash_amount: ca,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === paymentTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === paymentTarget.id ? (updated as CustomerSession) : prev));
      setPaymentTarget(null);
    } catch (e) {
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
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

      setSessions((prev) => prev.map((x) => (x.id === s.id ? (updated as CustomerSession) : x)));
      setSelectedSession((prev) => (prev?.id === s.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const closeReceipt = async (): Promise<void> => {
    if (selectedSession && isCustomerViewOnFor(selectedSession.id)) {
      try {
        await stopCustomerViewRealtime();
      } catch {
        //
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
                Showing records for: <strong>{selectedDate}</strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Customer View: <strong>{viewEnabled ? `ON (${String(viewSessionId).slice(0, 8)}...)` : "OFF"}</strong>
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
                    <button className="customer-search-clear" onClick={() => setSearchName("")} type="button">
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <p className="customer-note">No reservation data found for this date</p>
          ) : (
            <div
              className="customer-table-wrap"
              key={selectedDate}
              style={{
                maxHeight: "560px",
                overflowY: "auto",
                overflowX: "auto",
              }}
            >
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Reservation Date</th>
                    <th>Full Name</th>
                    <th>Phone #</th>
                    <th>Type</th>
                    <th>Has ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Hours</th>
                    <th>Total Balance / Change</th>
                    <th>Discount</th>
                    <th>Down Payment</th>
                    <th>Payment</th>
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
                    const systemCost = getSessionSystemCost(session);
                    const pi = getPaidInfo(session);
                    const remainingPay = systemCost - pi.totalPaid;
                    const dp = getDownPayment(session);

                    return (
                      <tr key={session.id}>
                        <td>{session.reservation_date}</td>
                        <td>{session.full_name}</td>
                        <td>{phoneText(session)}</td>
                        <td>{session.customer_type}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{open ? "OPEN" : renderTimeOut(session)}</td>
                        <td>{session.total_time}</td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value}</span>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountText(session)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(session)} type="button">
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{dp}</span>
                            <button className="receipt-btn" onClick={() => openDpModal(session)} type="button">
                              Edit DP
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash} / Cash ₱{pi.cash}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {remainingPay >= 0
                                ? `Remaining ₱${wholePeso(remainingPay)}`
                                : `Change ₱${wholePeso(Math.abs(remainingPay))}`}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={systemCost <= 0}
                              title={systemCost <= 0 ? "No due" : "Set GCash/Cash payment (FREE INPUTS, can exceed due)"}
                              type="button"
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${
                              toBool(session.is_paid) ? "pay-badge--paid" : "pay-badge--unpaid"
                            }`}
                            onClick={() => void togglePaid(session)}
                            disabled={togglingPaidId === session.id}
                            title={toBool(session.is_paid) ? "Tap to set UNPAID" : "Tap to set PAID"}
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

                            <button className="receipt-btn" onClick={() => setSelectedSession(session)} type="button">
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

                            {isCustomerViewOnFor(session.id) ? (
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

          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancellingBusy ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL RESERVATION</h3>
                <p className="receipt-subtitle">{cancelTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Reservation Date</span>
                  <span>{cancelTarget.reservation_date ?? "N/A"}</span>
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
                    ⚠️ This record will be moved to <strong>customer_sessions_cancelled</strong>.
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancellingBusy} type="button">
                    Back
                  </button>

                  <button
                    className="receipt-btn admin-danger"
                    onClick={() => void submitCancel()}
                    disabled={cancellingBusy || cancelReason.trim().length === 0}
                    title={cancelReason.trim().length === 0 ? "Reason required" : "Submit cancel"}
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
                  <button className="receipt-btn" onClick={() => setDpTarget(null)} type="button">
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDownPayment()} disabled={savingDp} type="button">
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
                  <select value={discountKind} onChange={(e) => setDiscountKind(e.currentTarget.value as DiscountKind)}>
                    <option value="none">None</option>
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Peso (₱)</option>
                  </select>
                </div>

                <div className="receipt-row">
                  <span>Value</span>
                  <div className="inline-input">
                    <span className="inline-input-prefix">
                      {discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}
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
                    discountKind === "percent" ? clamp(Math.max(0, val), 0, 100) : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);
                  const dueForPayment = wholePeso(Math.max(0, discountedCost));

                  const prevPay = getPaidInfo(discountTarget);
                  const adjPay = recalcPaymentsToDue(dueForPayment, prevPay.gcash);

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
                        <span>Final System Cost (Payment Basis)</span>
                        <span>₱{wholePeso(discountedCost)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW PAYMENT DUE</span>
                        <span>₱{wholePeso(dueForPayment)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Payment After Save</span>
                        <span>
                          GCash ₱{adjPay.gcash} / Cash ₱{adjPay.cash}
                        </span>
                      </div>

                      <div className="receipt-row" style={{ opacity: 0.8, fontSize: 12 }}>
                        <span>Note</span>
                        <span>Payment basis is System Cost after discount (DP not deducted)</span>
                      </div>
                    </>
                  );
                })()}

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDiscountTarget(null)} type="button">
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount} type="button">
                    {savingDiscount ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = wholePeso(Math.max(0, getSessionSystemCost(paymentTarget)));

                  const gc = wholePeso(Math.max(0, toMoney(gcashInput)));
                  const ca = wholePeso(Math.max(0, toMoney(cashInput)));
                  const totalPaid = wholePeso(gc + ca);

                  const diff = due - totalPaid;
                  const label = diff > 0 ? "Remaining" : "Change";
                  const value = diff > 0 ? diff : Math.abs(diff);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (System Cost)</span>
                        <span>₱{due}</span>
                      </div>

                      <div className="receipt-row" style={{ opacity: 0.8, fontSize: 12 }}>
                        <span>Mode</span>
                        <span>FREE INPUTS (Cash/GCash can exceed due)</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashFree(e.currentTarget.value)}
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
                          onChange={(e) => setCashFree(e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{label}</span>
                        <span>₱{wholePeso(value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Will be marked</span>
                        <span className="receipt-status">{due <= 0 ? "PAID" : totalPaid >= due ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)} type="button">
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment} type="button">
                          {savingPayment ? "Saving..." : "Save"}
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
                  <span>Reservation Date</span>
                  <span>{selectedSession.reservation_date ?? "N/A"}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedSession.full_name}</span>
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
                      {stoppingId === selectedSession.id ? "Stopping..." : "Stop Time (Set Time Out Now)"}
                    </button>
                  </div>
                )}

                <hr />

                {(() => {
                  const dp = getDownPayment(selectedSession);

                  const baseCost = getBaseSystemCost(selectedSession);
                  const di = getDiscountInfo(selectedSession);
                  const discountCalc = applyDiscount(baseCost, di.kind, di.value);

                  const dueForPayment = wholePeso(Math.max(0, discountCalc.discountedCost));
                  const pi = getPaidInfo(selectedSession);

                  const dpBalance = wholePeso(Math.max(0, dueForPayment - dp));
                  const dpChange = wholePeso(Math.max(0, dp - dueForPayment));

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
                        <span>System Cost (Payment Basis)</span>
                        <span>₱{wholePeso(dueForPayment)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>₱{pi.gcash}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>₱{pi.cash}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{pi.totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining Balance (After DP)</span>
                        <span>₱{dpBalance}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
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

                <div className="modal-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="receipt-btn"
                    disabled={!selectedSession}
                    onClick={() => {
                      if (!selectedSession) return;
                      const on = isCustomerViewOnFor(selectedSession.id);
                      void setCustomerViewRealtime(!on, !on ? selectedSession.id : null);
                    }}
                    type="button"
                  >
                    {selectedSession && isCustomerViewOnFor(selectedSession.id)
                      ? "Stop View to Customer"
                      : "View to Customer"}
                  </button>

                  <button className="close-btn" onClick={() => void closeReceipt()} disabled={cancellingBusy} type="button">
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Reservations;