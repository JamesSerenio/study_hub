// src/pages/Admin_customer_list.tsx
// ✅ SAME as Customer_Lists (Non-Reservation) — SAME LOGIC + UI + MODALS
// ✅ Seat column REMOVED from table (still shown on receipt)
// ✅ Discount (same breakdown UI)
// ✅ Down Payment EDITABLE (saved to DB: customer_sessions.down_payment)
// ✅ Payment modal FREE INPUTS (NO LIMIT) — Cash & GCash can exceed due
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ View to Customer toggle CROSS-DEVICE via Supabase table: customer_view_state (SINGLE ROW id=1)
// ✅ Search bar (Full Name only)
// ✅ Cancel requires DESCRIPTION and moves record to customer_sessions_cancelled (RPC cancel_customer_session)
// ✅ Admin-only: Export to Excel (.xlsx) with nice layout + embedded logo
// ✅ NEW: Refresh button (same classname style: receipt-btn) beside Export
// ✅ UPDATED (YOUR REQUEST): Export to Excel by DAY / WEEK / MONTH (anchor date)
// ✅ UPDATED (YOUR REQUEST): DELETE by DAY / WEEK / MONTH (permanent delete) (NON-RESERVATION only)
// ✅ strict TS (NO "any")

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

// ✅ EXCEL
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

/**
 * ✅ CROSS-DEVICE CUSTOMER VIEW (Supabase) — SINGLE ROW
 * Table design:
 *   customer_view_state(
 *     id int primary key default 1,
 *     session_id uuid null,
 *     enabled boolean not null default false,
 *     updated_at timestamptz not null default now()
 *   )
 * Must have exactly 1 row with id=1
 */
type CustomerViewRow = {
  id: number;
  session_id: string | null;
  enabled: boolean;
  updated_at: string;
};

type DiscountKind = "none" | "percent" | "amount";
type FilterMode = "day" | "week" | "month";

interface CustomerSession {
  id: string;
  date: string; // YYYY-MM-DD
  full_name: string;

  phone_number?: string | null;

  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string;
  time_ended: string;
  total_time: number;
  total_amount: number;
  reservation: string;
  reservation_date: string | null;
  seat_number: string;

  // ✅ DOWN PAYMENT (DB)
  down_payment?: number | string | null;

  // DISCOUNT
  discount_kind?: DiscountKind;
  discount_value?: number | string;
  discount_reason?: string | null;

  // PAYMENT
  gcash_amount?: number | string;
  cash_amount?: number | string;

  // PAID STATUS
  is_paid?: boolean | number | string | null;
  paid_at?: string | null;
}

/* =========================
   Date / Range helpers
========================= */
const pad2 = (n: number): string => String(n).padStart(2, "0");

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
};

const yyyyMmLocal = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

const startOfLocalDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

const getWeekRangeMonSunKeys = (anchorYmd: string): { startKey: string; endKey: string } => {
  const base = new Date(`${anchorYmd}T00:00:00`);
  const day = base.getDay(); // 0 Sun ... 6 Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = startOfLocalDay(addDays(base, diffToMon));
  const endInc = addDays(start, 6);
  return { startKey: yyyyMmDdLocal(start), endKey: yyyyMmDdLocal(endInc) };
};

const getMonthRangeKeys = (anchorYmd: string): { startKey: string; endKey: string; monthLabel: string } => {
  const base = new Date(`${anchorYmd}T00:00:00`);
  const y = base.getFullYear();
  const m = base.getMonth();
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const endExclusive = new Date(y, m + 1, 1, 0, 0, 0, 0);
  const endInc = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  return { startKey: yyyyMmDdLocal(start), endKey: yyyyMmDdLocal(endInc), monthLabel: yyyyMmLocal(base) };
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
    return { startKey: w.startKey, endKey: w.endKey, label: `${w.startKey} to ${w.endKey} (Mon-Sun)`, fileLabel: `${w.startKey}_to_${w.endKey}` };
  }
  const m = getMonthRangeKeys(anchorYmd);
  return { startKey: m.startKey, endKey: m.endKey, label: `${m.monthLabel} (${m.startKey} to ${m.endKey})`, fileLabel: m.monthLabel };
};

/* =========================
   Misc helpers
========================= */
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

/* =========================
   CROSS-DEVICE VIEW HELPERS (SINGLE ROW id=1)
========================= */

const VIEW_ROW_ID = 1;

const setCustomerViewState = async (enabled: boolean, sessionId: string | null): Promise<void> => {
  const { error } = await supabase
    .from("customer_view_state")
    .update({
      enabled,
      session_id: enabled ? sessionId : null,
    })
    .eq("id", VIEW_ROW_ID);

  if (error) throw error;
};

const isCustomerViewOnForSession = (active: CustomerViewRow | null, sessionId: string): boolean => {
  if (!active) return false;
  if (!active.enabled) return false;
  return String(active.session_id ?? "") === String(sessionId);
};

/* =========================
   Excel helpers
========================= */
const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
};

const isLikelyUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());

const Admin_customer_list: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // ✅ customer view status (from DB)
  const [activeView, setActiveView] = useState<CustomerViewRow | null>(null);
  const [viewBusy, setViewBusy] = useState<boolean>(false);

  // ✅ Cancel modal (requires description)
  const [cancelTarget, setCancelTarget] = useState<CustomerSession | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancellingBusy, setCancellingBusy] = useState<boolean>(false);

  // ✅ NEW: Range filter
  const [filterMode, setFilterMode] = useState<FilterMode>("day");
  const [anchorDate, setAnchorDate] = useState<string>(yyyyMmDdLocal(new Date()));

  const activeRange = useMemo(() => rangeFromMode(filterMode, anchorDate), [filterMode, anchorDate]);

  // ✅ Search (Full Name only)
  const [searchName, setSearchName] = useState<string>("");

  // Discount modal
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // ✅ Down Payment modal
  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  // ✅ Payment modal (FREE INPUTS, NO LIMIT)
  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // Paid toggle busy id
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  // Export busy
  const [exporting, setExporting] = useState<boolean>(false);

  // Refresh busy
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // ✅ DELETE BY FILTER (Day/Week/Month)
  const [deleteRangeOpen, setDeleteRangeOpen] = useState<boolean>(false);
  const [deletingByRange, setDeletingByRange] = useState<boolean>(false);

  useEffect(() => {
    void initLoad();
    const unsub = subscribeCustomerViewRealtime();

    return () => {
      try {
        if (typeof unsub === "function") unsub();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // fetch whenever range changes
    void fetchCustomerSessionsByRange(activeRange.startKey, activeRange.endKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRange.startKey, activeRange.endKey]);

  const initLoad = async (): Promise<void> => {
    await Promise.all([fetchCustomerSessionsByRange(activeRange.startKey, activeRange.endKey), readActiveCustomerView()]);
  };

  const filteredSessions = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!q) return true;
      const name = String(s.full_name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [sessions, searchName]);

  const fetchCustomerSessionsByRange = async (startKey: string, endKey: string): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "no")
      .gte("date", startKey)
      .lte("date", endKey)
      .order("date", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert("Error loading customer lists");
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
      await Promise.all([fetchCustomerSessionsByRange(activeRange.startKey, activeRange.endKey), readActiveCustomerView()]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  /* =========================
     CUSTOMER VIEW STATE (DB)
  ========================= */
  const readActiveCustomerView = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("customer_view_state")
      .select("id, session_id, enabled, updated_at")
      .eq("id", VIEW_ROW_ID)
      .maybeSingle();

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      setActiveView(null);
      return;
    }

    const row = (data ?? null) as CustomerViewRow | null;
    setActiveView(row);
  };

  const subscribeCustomerViewRealtime = (): (() => void) => {
    const channel = supabase
      .channel("customer_view_state_changes_admin_customer_list")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_view_state" }, () => {
        void readActiveCustomerView();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  };

  const phoneText = (s: CustomerSession): string => {
    const p = String(s.phone_number ?? "").trim();
    return p || "N/A";
  };

  const getDownPayment = (s: CustomerSession): number => round2(Math.max(0, toMoney(s.down_payment ?? 0)));

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
    return round2(chargeMinutes * perMinute);
  };

  const getLiveTotalCost = (s: CustomerSession): number => {
    const nowIso = new Date().toISOString();
    return computeCostWithFreeMinutes(s.time_started, nowIso);
  };

  const getBaseSystemCost = (s: CustomerSession): number => {
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : toMoney(s.total_amount);
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

  // ✅ System cost AFTER discount (Payment basis)
  const getSessionSystemCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return applyDiscount(base, di.kind, di.value).discountedCost;
  };

  // ✅ Balance/Change display uses DP (display only)
  const getSessionBalanceAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return round2(Math.max(0, systemCost - dp));
  };

  const getSessionChangeAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return round2(Math.max(0, dp - systemCost));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const balance = getSessionBalanceAfterDP(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = round2(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
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

      setSessions((prev) => prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      // eslint-disable-next-line no-console
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

  // -----------------------
  // DISCOUNT MODAL
  // -----------------------
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
    const dueForPayment = round2(Math.max(0, discounted));

    // ✅ KEEP existing cash/gcash as-is (no limiting)
    const prevPay = getPaidInfo(discountTarget);
    const totalPaid = round2(prevPay.gcash + prevPay.cash);
    const autoPaid = dueForPayment <= 0 ? true : totalPaid >= dueForPayment;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),

          // keep existing payments
          gcash_amount: prevPay.gcash,
          cash_amount: prevPay.cash,

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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  // -----------------------
  // ✅ DOWN PAYMENT MODAL (EDITABLE)
  // -----------------------
  const openDpModal = (s: CustomerSession): void => {
    setDpTarget(s);
    setDpInput(String(getDownPayment(s)));
  };

  const saveDownPayment = async (): Promise<void> => {
    if (!dpTarget) return;

    const raw = Number(dpInput);
    const dp = round2(Math.max(0, Number.isFinite(raw) ? raw : 0));

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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save down payment failed.");
    } finally {
      setSavingDp(false);
    }
  };

  // -----------------------
  // ✅ PAYMENT MODAL (FREE INPUTS, NO LIMIT)
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const pi = getPaidInfo(s);
    setPaymentTarget(s);
    setGcashInput(String(pi.gcash));
    setCashInput(String(pi.cash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = round2(Math.max(0, getSessionSystemCost(paymentTarget)));

    const g = round2(Math.max(0, toMoney(gcashInput)));
    const c = round2(Math.max(0, toMoney(cashInput)));
    const totalPaid = round2(g + c);

    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          gcash_amount: g,
          cash_amount: c,
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  /* =========================
     ✅ CANCEL FLOW (REQUIRES DESCRIPTION)
  ========================= */
  const openCancelModal = (s: CustomerSession): void => {
    setCancelTarget(s);
    setCancelReason("");
  };

  const submitCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const reason = cancelReason.trim();
    if (!reason) return;

    try {
      setCancellingBusy(true);

      const { error } = await supabase.rpc("cancel_customer_session", {
        p_session_id: cancelTarget.id,
        p_reason: reason,
      });

      if (error) {
        alert(`Cancel failed: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((x) => x.id !== cancelTarget.id));

      if (selectedSession?.id === cancelTarget.id) {
        setSelectedSession(null);
      }

      await readActiveCustomerView();

      setCancelTarget(null);
      setCancelReason("");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cancel failed.");
    } finally {
      setCancellingBusy(false);
    }
  };

  /* =========================
     ✅ DELETE BY RANGE (NON-RESERVATION ONLY)
  ========================= */
  const openDeleteByRangeModal = (): void => {
    if (loading || refreshing || exporting) return;
    if (filteredSessions.length === 0) {
      alert("No records to delete in this range.");
      return;
    }
    setDeleteRangeOpen(true);
  };

  const deleteByRange = async (): Promise<void> => {
    try {
      setDeletingByRange(true);

      // ✅ close customer view if it points to a session that will be deleted
      if (activeView?.enabled && activeView.session_id) {
        const willDelete = sessions.some((s) => String(s.id) === String(activeView.session_id));
        if (willDelete) {
          try {
            await setCustomerViewState(false, null);
          } catch {
            // ignore (still proceed)
          }
        }
      }

      // ✅ delete ALL non-reservation rows for that range
      const { error } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("reservation", "no")
        .gte("date", activeRange.startKey)
        .lte("date", activeRange.endKey);

      if (error) {
        alert(`Delete failed: ${error.message}`);
        return;
      }

      // ✅ update UI immediately
      setSessions([]);

      // ✅ if receipt open and deleted
      setSelectedSession(null);

      await readActiveCustomerView();

      setDeleteRangeOpen(false);
      alert(`Deleted all non-reservation records for ${filterMode.toUpperCase()} range: ${activeRange.label}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete by range failed.");
    } finally {
      setDeletingByRange(false);
    }
  };

  const toggleCustomerViewForSelected = async (): Promise<void> => {
    if (!selectedSession) return;

    const currentlyOn = isCustomerViewOnForSession(activeView, selectedSession.id);

    try {
      setViewBusy(true);

      if (currentlyOn) {
        await setCustomerViewState(false, null);
      } else {
        await setCustomerViewState(true, selectedSession.id);
      }

      await readActiveCustomerView();
    } catch (e) {
      // eslint-disable-next-line no-console
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
      } catch {
        // ignore
      } finally {
        setViewBusy(false);
      }
    }
    setSelectedSession(null);
  };

  /* =========================
     ✅ EXPORT TO EXCEL (Nice layout + logo)
     ✅ NOW: exports current Day/Week/Month range
  ========================= */
  const exportToExcel = async (): Promise<void> => {
    if (filteredSessions.length === 0) {
      alert("No records for selected range.");
      return;
    }

    try {
      setExporting(true);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Me Tyme Lounge";
      wb.created = new Date();

      const ws = wb.addWorksheet("Non-Reservation", {
        views: [{ state: "frozen", ySplit: 6 }],
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      ws.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Full Name", key: "full_name", width: 26 },
        { header: "Phone #", key: "phone_number", width: 16 },
        { header: "Type", key: "customer_type", width: 14 },
        { header: "Field", key: "customer_field", width: 18 },
        { header: "Has ID", key: "has_id", width: 10 },
        { header: "Specific ID", key: "id_number", width: 16 },
        { header: "Hours", key: "hour_avail", width: 10 },
        { header: "Time In", key: "time_in", width: 10 },
        { header: "Time Out", key: "time_out", width: 10 },
        { header: "Total Hours", key: "total_hours", width: 12 },

        { header: "Amount Label", key: "amount_label", width: 16 },
        { header: "Balance/Change", key: "amount_value", width: 14 },

        { header: "Discount", key: "discount_text", width: 12 },
        { header: "Down Payment", key: "down_payment", width: 14 },

        { header: "System Cost", key: "system_cost", width: 14 },
        { header: "GCash", key: "gcash", width: 12 },
        { header: "Cash", key: "cash", width: 12 },
        { header: "Total Paid", key: "total_paid", width: 12 },
        { header: "Remaining/Change", key: "remaining", width: 16 },

        { header: "Paid?", key: "paid", width: 10 },
        { header: "Status", key: "status", width: 12 },
        { header: "Seat", key: "seat", width: 10 },
      ];

      const lastColLetter = "W";

      ws.mergeCells(`A1:${lastColLetter}1`);
      ws.getCell("A1").value = "ME TYME LOUNGE — Admin Customer Lists (Non-Reservation)";
      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

      ws.mergeCells(`A2:${lastColLetter}2`);
      ws.getCell("A2").value = `${filterMode.toUpperCase()} Range: ${activeRange.label}    •    Records: ${filteredSessions.length}`;
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

      ws.getRow(1).height = 26;
      ws.getRow(2).height = 18;

      if (isLikelyUrl(logo)) {
        const ab = await fetchAsArrayBuffer(logo);
        if (ab) {
          const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
          const imgId = wb.addImage({ buffer: ab, extension: ext });
          ws.addImage(imgId, {
            tl: { col: 18.5, row: 0.25 },
            ext: { width: 170, height: 64 },
          });
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

      const moneyCols = new Set(["amount_value", "down_payment", "system_cost", "gcash", "cash", "total_paid", "remaining"]);

      filteredSessions.forEach((s, idx) => {
        const open = isOpenTimeSession(s);

        const disp = getDisplayAmount(s);
        const dp = getDownPayment(s);

        const base = getBaseSystemCost(s);
        const di = getDiscountInfo(s);
        const calc = applyDiscount(base, di.kind, di.value);
        const systemCost = round2(Math.max(0, calc.discountedCost));

        const pi = getPaidInfo(s);
        const remainingPay = round2(systemCost - pi.totalPaid);

        const row = ws.addRow({
          date: s.date,
          full_name: s.full_name,
          phone_number: phoneText(s),
          customer_type: s.customer_type,
          customer_field: s.customer_field ?? "",
          has_id: s.has_id ? "Yes" : "No",
          id_number: s.id_number ?? "N/A",
          hour_avail: s.hour_avail,
          time_in: formatTimeText(s.time_started),
          time_out: open ? "OPEN" : formatTimeText(s.time_ended),
          total_hours: Number.isFinite(Number(s.total_time)) ? String(s.total_time) : "0",

          amount_label: disp.label,
          amount_value: disp.value,

          discount_text: getDiscountTextFrom(di.kind, di.value),
          down_payment: dp,

          system_cost: systemCost,
          gcash: pi.gcash,
          cash: pi.cash,
          total_paid: pi.totalPaid,
          remaining: remainingPay,

          paid: toBool(s.is_paid) ? "PAID" : "UNPAID",
          status: renderStatus(s),
          seat: s.seat_number,
        });

        const rowIndex = row.number;
        ws.getRow(rowIndex).height = 18;

        row.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: "middle", horizontal: colNumber === 2 ? "left" : "center", wrapText: true };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            left: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
            right: { style: "thin", color: { argb: "FFE5E7EB" } },
          };

          const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        });

        ws.columns.forEach((c, i) => {
          if (!c.key) return;
          if (moneyCols.has(String(c.key))) {
            const cell = ws.getCell(rowIndex, i + 1);
            cell.numFmt = '"₱"#,##0.00;[Red]"₱"#,##0.00';
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }
        });

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
      });

      ws.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: ws.columns.length },
      };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `admin-nonreservation_${filterMode}_${activeRange.fileLabel}.xlsx`);
    } catch (e) {
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
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Customer Lists - Non Reservation</h2>
              <div className="customer-subtext">
                <strong>{rangeHint}</strong> • Records: <strong>{filteredSessions.length}</strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Customer View:{" "}
                <strong>{activeView?.enabled ? `ON (${String(activeView.session_id ?? "").slice(0, 8)}...)` : "OFF"}</strong>
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
                    value={searchName}
                    onChange={(e) => setSearchName(e.currentTarget.value)}
                    placeholder="Search by Full Name..."
                  />
                  {searchName.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearchName("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* ✅ NEW: Mode */}
              <label className="date-pill" style={{ marginLeft: 10 }}>
                <span className="date-pill-label">Mode</span>
                <select className="date-pill-input" value={filterMode} onChange={(e) => setFilterMode(e.currentTarget.value as FilterMode)}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
                <span className="date-pill-icon" aria-hidden="true">
                  ▾
                </span>
              </label>

              {/* ✅ Anchor Date */}
              <label className="date-pill">
                <span className="date-pill-label">{filterMode === "day" ? "Date" : "Anchor"}</span>
                <input
                  className="date-pill-input"
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(String(e.currentTarget.value ?? ""))}
                />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>

              {/* ✅ REFRESH */}
              <button
                className="receipt-btn"
                onClick={() => void refreshAll()}
                disabled={refreshing || loading}
                title="Refresh data"
                style={{ marginLeft: 8 }}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>

              {/* ✅ DELETE BY RANGE */}
              <button
                className="receipt-btn admin-danger"
                onClick={() => openDeleteByRangeModal()}
                disabled={loading || refreshing || exporting || deletingByRange || filteredSessions.length === 0}
                title={filteredSessions.length === 0 ? "No data to delete" : `Delete ALL records for this ${filterMode.toUpperCase()} range`}
                style={{ marginLeft: 8 }}
              >
                {deletingByRange ? "Deleting..." : `Delete (${filterMode})`}
              </button>

              {/* ✅ EXPORT */}
              <button
                className="receipt-btn"
                onClick={() => void exportToExcel()}
                disabled={exporting || loading || filteredSessions.length === 0}
                title={filteredSessions.length === 0 ? "No data to export" : `Export .xlsx for this ${filterMode.toUpperCase()} range`}
                style={{ marginLeft: 8 }}
              >
                {exporting ? "Exporting..." : "Export to Excel"}
              </button>
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No data found for this range</p>
          ) : (
            <div className="customer-table-wrap" key={`${filterMode}-${activeRange.fileLabel}`}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Full Name</th>
                    <th>Phone #</th>
                    <th>Type</th>
                    <th>Field</th>
                    <th>Has ID</th>
                    <th>Specific ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Hours</th>
                    <th>Total Balance / Change</th>
                    <th>Discount</th>
                    <th>Down Payment</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSessions.map((session) => {
                    const open = isOpenTimeSession(session);

                    const disp = getDisplayAmount(session);

                    const systemCost = round2(Math.max(0, getSessionSystemCost(session)));
                    const pi = getPaidInfo(session);
                    const remainingPay = round2(systemCost - pi.totalPaid);

                    const dp = getDownPayment(session);
                    const viewOn = isCustomerViewOnForSession(activeView, session.id);

                    return (
                      <tr key={session.id}>
                        <td>{session.date}</td>
                        <td>{session.full_name}</td>
                        <td>{phoneText(session)}</td>
                        <td>{session.customer_type}</td>
                        <td>{session.customer_field ?? ""}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.id_number ?? "N/A"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{renderTimeOut(session)}</td>
                        <td>{session.total_time}</td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value.toFixed(2)}</span>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountText(session)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{dp.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openDpModal(session)}>
                              Edit DP
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {remainingPay >= 0 ? `Remaining ₱${remainingPay.toFixed(2)}` : `Change ₱${Math.abs(remainingPay).toFixed(2)}`}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={systemCost <= 0}
                              title={systemCost <= 0 ? "No due" : "Set Cash & GCash freely (no limit)"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${toBool(session.is_paid) ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(session)}
                            disabled={togglingPaidId === session.id}
                            title={toBool(session.is_paid) ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidId === session.id ? "Updating..." : toBool(session.is_paid) ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>{renderStatus(session)}</td>

                        <td>
                          <div className="action-stack">
                            {open && (
                              <button className="receipt-btn" disabled={stoppingId === session.id} onClick={() => void stopOpenTime(session)}>
                                {stoppingId === session.id ? "Stopping..." : "Stop Time"}
                              </button>
                            )}

                            <button className="receipt-btn" onClick={() => setSelectedSession(session)}>
                              View Receipt
                            </button>

                            <button className="receipt-btn admin-danger" onClick={() => openCancelModal(session)} title="Cancel requires description">
                              Cancel
                            </button>

                            {viewOn ? <span style={{ fontSize: 11, opacity: 0.85 }}>👁 Viewing</span> : <span style={{ fontSize: 11, opacity: 0.45 }}>—</span>}
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
                  This will delete <strong>ALL</strong> non-reservation records in this range:
                  <br />
                  <strong>{activeRange.label}</strong>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Records Found</span>
                  <span>{filteredSessions.length}</span>
                </div>

                <div className="receipt-row" style={{ opacity: 0.85, fontSize: 12 }}>
                  <span>Warning</span>
                  <span>Permanent delete (cannot undo).</span>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDeleteRangeOpen(false)} disabled={deletingByRange}>
                    Cancel
                  </button>

                  <button className="receipt-btn admin-danger" onClick={() => void deleteByRange()} disabled={deletingByRange} title="Delete all records for this range">
                    {deletingByRange ? "Deleting..." : "Delete Now"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ CANCEL MODAL */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancellingBusy ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL SESSION</h3>
                <p className="receipt-subtitle">{cancelTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{cancelTarget.date}</span>
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
                    ⚠️ Cannot cancel if empty. This record will be moved to <strong>customer_sessions_cancelled</strong>.
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancellingBusy}>
                    Back
                  </button>

                  <button
                    className="receipt-btn admin-danger"
                    onClick={() => void submitCancel()}
                    disabled={cancellingBusy || cancelReason.trim().length === 0}
                    title={cancelReason.trim().length === 0 ? "Reason required" : "Submit cancel"}
                  >
                    {cancellingBusy ? "Cancelling..." : "Submit Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ DOWN PAYMENT MODAL */}
          {dpTarget && (
            <div className="receipt-overlay" onClick={() => setDpTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DOWN PAYMENT</h3>
                <p className="receipt-subtitle">{dpTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Down Payment (₱)</span>
                  <input className="money-input" type="number" min="0" step="0.01" value={dpInput} onChange={(e) => setDpInput(e.currentTarget.value)} />
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDpTarget(null)}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDownPayment()} disabled={savingDp}>
                    {savingDp ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DISCOUNT MODAL */}
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
                    <span className="inline-input-prefix">{discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}</span>
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
                  const appliedVal = discountKind === "percent" ? clamp(Math.max(0, val), 0, 100) : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);
                  const dueForPayment = round2(Math.max(0, discountedCost));

                  const prevPay = getPaidInfo(discountTarget);

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, appliedVal)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost (Payment Basis)</span>
                        <span>₱{discountedCost.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW PAYMENT DUE</span>
                        <span>₱{dueForPayment.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current Payment</span>
                        <span>
                          GCash ₱{prevPay.gcash.toFixed(2)} / Cash ₱{prevPay.cash.toFixed(2)}
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
                  <button className="receipt-btn" onClick={() => setDiscountTarget(null)}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount}>
                    {savingDiscount ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ PAYMENT MODAL (NO LIMIT) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, getSessionSystemCost(paymentTarget)));

                  const g = round2(Math.max(0, toMoney(gcashInput)));
                  const c = round2(Math.max(0, toMoney(cashInput)));
                  const totalPaid = round2(g + c);

                  const diff = round2(totalPaid - due);
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (System Cost)</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input className="money-input" type="number" min="0" step="0.01" value={gcashInput} onChange={(e) => setGcashInput(e.currentTarget.value)} />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input className="money-input" type="number" min="0" step="0.01" value={cashInput} onChange={(e) => setCashInput(e.currentTarget.value)} />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>₱{Math.abs(diff).toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Status</span>
                        <span className="receipt-status">{isPaidAuto ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)}>
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
          {selectedSession && (
            <div className="receipt-overlay" onClick={() => void closeReceipt()}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{selectedSession.date}</span>
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
                    <button className="receipt-btn btn-full" disabled={stoppingId === selectedSession.id} onClick={() => void stopOpenTime(selectedSession)}>
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

                  const dueForPayment = round2(Math.max(0, discountCalc.discountedCost));

                  const pi = getPaidInfo(selectedSession);

                  const dpBalance = round2(Math.max(0, dueForPayment - dp));
                  const dpChange = round2(Math.max(0, dp - dueForPayment));

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
                        <span>₱{dpDisp.value.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(di.kind, di.value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountCalc.discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (Payment Basis)</span>
                        <span>₱{dueForPayment.toFixed(2)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>₱{pi.gcash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>₱{pi.cash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{pi.totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining Balance (After DP)</span>
                        <span>₱{dpBalance.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="receipt-total">
                        <span>{bottomLabel}</span>
                        <span>₱{bottomValue.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                <div className="modal-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="receipt-btn" onClick={() => void toggleCustomerViewForSelected()} disabled={viewBusy}>
                    {isCustomerViewOnForSession(activeView, selectedSession.id) ? "Stop View to Customer" : "View to Customer"}
                  </button>

                  <button className="receipt-btn admin-danger" onClick={() => openCancelModal(selectedSession)} disabled={viewBusy} title="Cancel requires description">
                    Cancel
                  </button>

                  <button className="close-btn" onClick={() => void closeReceipt()} disabled={viewBusy}>
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

export default Admin_customer_list;
