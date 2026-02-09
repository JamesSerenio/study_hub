// src/pages/Customer_Lists.tsx
// ✅ Shows ONLY NON-RESERVATION records (reservation = "no")
// ✅ Seat column REMOVED from Customer List table (but still shown on receipt; remove if you want)
// ✅ Discount UI reverted to previous "breakdown" layout
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Payment is based on TIME CONSUMED (System Cost after discount) — ❌ DOES NOT deduct Down Payment
// ✅ Down Payment column between Discount and Payment
// ✅ Down Payment is EDITABLE (modal) and saved to DB: customer_sessions.down_payment
// ✅ Receipt: removed "Edit DP" button
// ✅ Receipt auto-updates balance/change after DP edit (because row + selectedSession are updated)
// ✅ Phone # column beside Full Name
// ✅ View to Customer toggle now supports CROSS-DEVICE via Supabase table: customer_view_state (SINGLE ROW id=1)
// ✅ Search bar (Full Name only)
// ✅ NEW: Cancel now requires DESCRIPTION and moves record to customer_sessions_cancelled (RPC)
// ✅ strict TS (NO "any")
// ✅ FIXED: PAYMENT inputs no longer LIMIT/force total = due (Cash & GCash free input)

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

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

const Customer_Lists: React.FC = () => {
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

  // Date filter
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

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

  useEffect(() => {
    void fetchCustomerSessions();
    void readActiveCustomerView();
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

  const filteredSessions = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return sessions.filter((s) => {
      const sameDate = (s.date ?? "") === selectedDate;
      if (!sameDate) return false;

      if (!q) return true;
      const name = String(s.full_name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [sessions, selectedDate, searchName]);

  const fetchCustomerSessions = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "no")
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
      .channel("customer_view_state_changes_customer_lists")
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
    // ✅ Prefill with existing values (no forcing to due)
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
     - opens modal
     - submit -> RPC cancel_customer_session()
     - moves row to customer_sessions_cancelled then deletes original
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

      // remove from UI list immediately
      setSessions((prev) => prev.filter((x) => x.id !== cancelTarget.id));

      // close receipt if same
      if (selectedSession?.id === cancelTarget.id) {
        setSelectedSession(null);
      }

      // refresh view state display
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
      } catch (e) {
        // eslint-disable-next-line no-console
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
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Lists - Non Reservation</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Customer View:{" "}
                <strong>
                  {activeView?.enabled ? `ON (${String(activeView.session_id ?? "").slice(0, 8)}...)` : "OFF"}
                </strong>
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
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No data found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
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
                    const remainingPay = round2(systemCost - pi.totalPaid); // ✅ can be negative (change)

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

                        {/* PAYMENT */}
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
                            className={`receipt-btn pay-badge ${
                              toBool(session.is_paid) ? "pay-badge--paid" : "pay-badge--unpaid"
                            }`}
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
                              <button
                                className="receipt-btn"
                                disabled={stoppingId === session.id}
                                onClick={() => void stopOpenTime(session)}
                              >
                                {stoppingId === session.id ? "Stopping..." : "Stop Time"}
                              </button>
                            )}

                            <button className="receipt-btn" onClick={() => setSelectedSession(session)}>
                              View Receipt
                            </button>

                            {/* ✅ CANCEL -> opens reason modal */}
                            <button
                              className="receipt-btn admin-danger"
                              onClick={() => openCancelModal(session)}
                              title="Cancel requires description"
                            >
                              Cancel
                            </button>

                            {viewOn ? (
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

          {/* ✅ CANCEL MODAL (REQUIRES DESCRIPTION) */}
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

                  const diff = round2(totalPaid - due); // + = change, - = remaining
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (System Cost)</span>
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
                    <button
                      className="receipt-btn btn-full"
                      disabled={stoppingId === selectedSession.id}
                      onClick={() => void stopOpenTime(selectedSession)}
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

                  {/* ✅ CANCEL IN RECEIPT -> opens reason modal */}
                  <button
                    className="receipt-btn admin-danger"
                    onClick={() => openCancelModal(selectedSession)}
                    disabled={viewBusy}
                    title="Cancel requires description"
                  >
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

export default Customer_Lists;
