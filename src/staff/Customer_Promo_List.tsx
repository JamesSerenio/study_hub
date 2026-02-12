// src/pages/Customer_Discount_List.tsx
// ✅ SAME classnames as Customer_Lists.tsx so 1 CSS can style both pages
// ✅ SAME behavior as Admin_Customer_Discount_List.tsx
// ✅ Can edit: Discount + Discount Reason + Payment + Paid Toggle
// ✅ Has Date Filter (view-only filter)
// ❌ NO Delete
// ❌ NO Delete by Date
// ✅ strict TS (NO "any")
// ✅ ADD: phone_number field (separate column) + Receipt shows Customer Name + Phone #
// ✅ FIX: View to Customer REALTIME + EXACT same localStorage keys as Customer_Lists.tsx
// ✅ NEW: Search bar (Full Name) beside Date (same classnames as Customer_Lists)
// ✅ NEW: Refresh button beside Date filter (same style)
// ✅ NEW: Payment modal FREE INPUTS (NO LIMIT) — Cash & GCash can exceed due ✅
// ✅ NEW: CANCEL requires DESCRIPTION and moves record to promo_bookings_cancelled table

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";
type DiscountKind = "none" | "percent" | "amount";

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

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;

  // not selected in query, but exists in DB:
  // package_id, package_option_id, user_id, status...
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

/* ================= CUSTOMER VIEW (localStorage keys)
   ✅ SAME as Customer_Lists.tsx (ONLY these 2 keys)
*/
const LS_VIEW_ENABLED = "customer_view_enabled";
const LS_SESSION_ID = "customer_view_session_id";

/* ================= REALTIME VIEW STATE TABLE =================
   ✅ shared across devices
   ✅ SINGLE ROW (id=1)
*/
const VIEW_STATE_TABLE = "customer_view_state";
const VIEW_STATE_ID = 1;

type ViewStateRow = {
  id: number;
  enabled: boolean | number | string | null;
  session_id: string | null;
  updated_at?: string | null;
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

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getCreatedDateLocal = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const prettyArea = (a: PackageArea): string => (a === "conference_room" ? "Conference Room" : "Common Area");

const seatLabel = (r: PromoBookingRow): string =>
  r.area === "conference_room" ? "CONFERENCE ROOM" : r.seat_number || "N/A";

const getStatus = (startIso: string, endIso: string): "UPCOMING" | "ONGOING" | "FINISHED" => {
  const now = Date.now();
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();

  if (!Number.isFinite(s) || !Number.isFinite(e)) return "FINISHED";
  if (now < s) return "UPCOMING";
  if (now >= s && now <= e) return "ONGOING";
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

const normalizeRow = (row: PromoBookingDBRow): PromoBookingRow => {
  const kind = normalizeDiscountKind(row.discount_kind);
  const value = round2(toNumber(row.discount_value));

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

    packages: row.packages ?? null,
    package_options: row.package_options ?? null,
  };
};

const safePhone = (v: string | null | undefined): string => {
  const p = String(v ?? "").trim();
  return p ? p : "—";
};

const moneyFromStr = (s: string): number => round2(Math.max(0, toNumber(s)));

/* ================= VIEW-TO-CUSTOMER (REALTIME + localStorage keys stay same) ================= */

const readLocalView = (): { enabled: boolean; sessionId: string } => {
  const enabled = String(localStorage.getItem(LS_VIEW_ENABLED) ?? "").toLowerCase() === "true";
  const sid = String(localStorage.getItem(LS_SESSION_ID) ?? "").trim();
  return { enabled, sessionId: sid };
};

const writeLocalView = (enabled: boolean, sessionId: string | null): void => {
  localStorage.setItem(LS_VIEW_ENABLED, String(enabled));
  if (enabled && sessionId) localStorage.setItem(LS_SESSION_ID, sessionId);
  else localStorage.removeItem(LS_SESSION_ID);
};

const Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);

  // ✅ DATE FILTER (view-only)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ SEARCH (Full Name)
  const [searchName, setSearchName] = useState<string>("");

  // refresh status/time
  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  // ✅ force rerender for view-to-customer label switching
  const [, setViewTick] = useState<number>(0);

  // ✅ realtime view state in memory
  const [viewEnabled, setViewEnabled] = useState<boolean>(false);
  const [viewSessionId, setViewSessionId] = useState<string>("");

  const viewHydratedRef = useRef<boolean>(false);

  // ✅ refresh busy
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const applyViewState = (enabled: boolean, sessionId: string): void => {
    setViewEnabled(enabled);
    setViewSessionId(sessionId);
    writeLocalView(enabled, enabled ? sessionId : null);
    setViewTick((x) => x + 1);
  };

  const hydrateViewState = async (): Promise<void> => {
    const { data, error } = await supabase
      .from(VIEW_STATE_TABLE)
      .select("id, enabled, session_id, updated_at")
      .eq("id", VIEW_STATE_ID)
      .maybeSingle();

    if (!error && data) {
      const row = data as unknown as ViewStateRow;
      const enabled = toBool(row.enabled);
      const sid = String(row.session_id ?? "").trim();
      applyViewState(enabled, sid);
      viewHydratedRef.current = true;
      return;
    }

    const local = readLocalView();
    applyViewState(local.enabled, local.sessionId);
    viewHydratedRef.current = true;
  };

  const setCustomerViewRealtime = async (enabled: boolean, sessionId: string | null): Promise<void> => {
    const sid = enabled && sessionId ? sessionId : null;

    applyViewState(Boolean(enabled), String(sid ?? ""));

    const { error } = await supabase
      .from(VIEW_STATE_TABLE)
      .update({
        enabled: Boolean(enabled),
        session_id: sid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", VIEW_STATE_ID);

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("setCustomerViewRealtime error:", error.message);
      writeLocalView(Boolean(enabled), sid);
      setViewTick((x) => x + 1);
    }
  };

  const stopCustomerViewRealtime = async (): Promise<void> => {
    await setCustomerViewRealtime(false, null);
  };

  const isCustomerViewOnFor = (sessionId: string): boolean => {
    return viewEnabled && viewSessionId === sessionId;
  };

  useEffect(() => {
    void hydrateViewState();

    const channel = supabase
      .channel("realtime_customer_view_state_discount_list")
      .on("postgres_changes", { event: "*", schema: "public", table: VIEW_STATE_TABLE }, (payload) => {
        const next = (payload.new ?? null) as unknown as ViewStateRow | null;
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
        setViewTick((x) => x + 1);
        if (!viewHydratedRef.current) {
          const local = readLocalView();
          applyViewState(local.enabled, local.sessionId);
        }
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      void supabase.removeChannel(channel);
    };
  }, []);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<PromoBookingRow | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // discount modal
  const [discountTarget, setDiscountTarget] = useState<PromoBookingRow | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValueInput, setDiscountValueInput] = useState<string>("0");
  const [discountReasonInput, setDiscountReasonInput] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // paid toggle
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  // cancel modal
  const [cancelTarget, setCancelTarget] = useState<PromoBookingRow | null>(null);
  const [cancelDesc, setCancelDesc] = useState<string>("");
  const [cancelError, setCancelError] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);

  const fetchPromoBookings = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("promo_bookings")
      .select(
        `
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
        packages:package_id ( title ),
        package_options:package_option_id (
          option_name,
          duration_value,
          duration_unit
        )
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert(`Load error: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const dbRows = (data ?? []) as unknown as PromoBookingDBRow[];
    setRows(dbRows.map(normalizeRow));
    setLoading(false);
  };

  useEffect(() => {
    void fetchPromoBookings();
  }, []);

  // ✅ Refresh button action (reload list + view state)
  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await Promise.all([fetchPromoBookings(), hydrateViewState()]);
    } finally {
      setRefreshing(false);
    }
  };

  // ✅ Filter by date + full_name search
  const filteredRows = useMemo(() => {
    void tick;

    const q = searchName.trim().toLowerCase();

    return rows.filter((r) => {
      const sameDate = getCreatedDateLocal(r.created_at) === selectedDate;
      if (!sameDate) return false;

      if (!q) return true;
      const name = String(r.full_name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [rows, tick, selectedDate, searchName]);

  const getPaidInfo = (r: PromoBookingRow): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  /* ================= PAYMENT MODAL (FREE INPUTS) ================= */
  const openPaymentModal = (r: PromoBookingRow): void => {
    setPaymentTarget(r);
    setGcashInput(String(round2(Math.max(0, toNumber(r.gcash_amount)))));
    setCashInput(String(round2(Math.max(0, toNumber(r.cash_amount)))));
  };

  const onChangeGcashFree = (v: string): void => setGcashInput(v);
  const onChangeCashFree = (v: string): void => setCashInput(v);

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const base = round2(Math.max(0, toNumber(paymentTarget.price)));
    const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
    const due = round2(calc.discountedCost);

    const g = moneyFromStr(gcashInput);
    const c = moneyFromStr(cashInput);
    const totalPaid = round2(g + c);
    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          gcash_amount: g,
          cash_amount: c,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select(
          `
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
          packages:package_id ( title ),
          package_options:package_option_id (
            option_name,
            duration_value,
            duration_unit
          )
        `
        )
        .single();

      if (error || !data) {
        alert(`Save payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updated = normalizeRow(data as unknown as PromoBookingDBRow);
      setRows((prev) => prev.map((x) => (x.id === paymentTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === paymentTarget.id ? updated : prev));
      setPaymentTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  const openDiscountModal = (r: PromoBookingRow): void => {
    setDiscountTarget(r);
    setDiscountKind(r.discount_kind ?? "none");
    setDiscountValueInput(String(round2(toNumber(r.discount_value))));
    setDiscountReasonInput(String(r.discount_reason ?? ""));

    // keep current payments as-is (no clamping)
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

    const isPaidAuto = newDue <= 0 ? true : totalPaid >= newDue;

    try {
      setSavingDiscount(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          discount_kind: discountKind,
          discount_value: finalVal,
          discount_reason: discountReasonInput.trim() || null,

          gcash_amount: g,
          cash_amount: c,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", discountTarget.id)
        .select(
          `
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
          packages:package_id ( title ),
          package_options:package_option_id (
            option_name,
            duration_value,
            duration_unit
          )
        `
        )
        .single();

      if (error || !data) {
        alert(`Save discount error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updated = normalizeRow(data as unknown as PromoBookingDBRow);
      setRows((prev) => prev.map((x) => (x.id === discountTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === discountTarget.id ? updated : prev));
      setDiscountTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  const togglePaid = async (r: PromoBookingRow): Promise<void> => {
    try {
      setTogglingPaidId(r.id);

      const nextPaid = !toBool(r.is_paid);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .eq("id", r.id)
        .select("id, is_paid, paid_at, gcash_amount, cash_amount")
        .single();

      if (error || !data) {
        alert(`Toggle paid error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const u = data as unknown as PromoBookingPaidUpdateRow;

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
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  /* ================= CANCEL FLOW =================
     ✅ Requires description
     ✅ Copy row -> promo_bookings_cancelled
     ✅ Delete from promo_bookings
  */
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
      setCancelError("");

      // If this record is currently being viewed to customer, stop it first
      if (isCustomerViewOnFor(cancelTarget.id)) {
        try {
          await stopCustomerViewRealtime();
        } catch {
          // ignore
        }
      }

      // Fetch full DB row needed for copying (package_id, package_option_id, user_id, status, etc.)
      const { data: fullRow, error: fullErr } = await supabase
        .from("promo_bookings")
        .select(
          `
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
          discount_value
        `
        )
        .eq("id", cancelTarget.id)
        .single();

      if (fullErr || !fullRow) {
        setCancelError(`Failed to load booking: ${fullErr?.message ?? "Unknown error"}`);
        return;
      }

      // Insert into cancelled table
      const { error: insErr } = await supabase.from("promo_bookings_cancelled").insert({
        original_id: fullRow.id,
        description: desc,

        created_at: fullRow.created_at,
        user_id: fullRow.user_id ?? null,
        full_name: fullRow.full_name,
        phone_number: fullRow.phone_number ?? null,

        area: fullRow.area,
        package_id: fullRow.package_id,
        package_option_id: fullRow.package_option_id,

        seat_number: fullRow.seat_number ?? null,
        start_at: fullRow.start_at,
        end_at: fullRow.end_at,

        price: fullRow.price ?? 0,
        status: fullRow.status ?? "pending",

        gcash_amount: fullRow.gcash_amount ?? 0,
        cash_amount: fullRow.cash_amount ?? 0,
        is_paid: Boolean(fullRow.is_paid),
        paid_at: fullRow.paid_at ?? null,

        discount_reason: fullRow.discount_reason ?? null,
        discount_kind: String(fullRow.discount_kind ?? "none"),
        discount_value: fullRow.discount_value ?? 0,
      });

      if (insErr) {
        setCancelError(`Cancel save failed: ${insErr.message}`);
        return;
      }

      // Delete original row
      const { error: delErr } = await supabase.from("promo_bookings").delete().eq("id", cancelTarget.id);
      if (delErr) {
        setCancelError(
          `Inserted to cancelled, but delete failed: ${delErr.message}. (You may now have duplicate if you retry.)`
        );
        return;
      }

      // Update UI
      setRows((prev) => prev.filter((x) => x.id !== cancelTarget.id));
      setSelected((prev) => (prev?.id === cancelTarget.id ? null : prev));
      setCancelTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setCancelError("Cancel failed (unexpected error).");
    } finally {
      setCancelling(false);
    }
  };

  const closeReceipt = async (): Promise<void> => {
    if (selected && isCustomerViewOnFor(selected.id)) {
      try {
        await stopCustomerViewRealtime();
      } catch {
        // ignore
      }
    }
    setSelected(null);
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Promo Records</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>
              </div>

              <div className="customer-subtext" style={{ opacity: 0.85, fontSize: 12 }}>
                Customer View: <strong>{viewEnabled ? `ON (${String(viewSessionId).slice(0, 8)}...)` : "OFF"}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* ✅ SEARCH BAR */}
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

              {/* DATE + REFRESH */}
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
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredRows.length === 0 ? (
            <p className="customer-note">No promo records found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer Name</th>
                    <th>Phone #</th>
                    <th>Area</th>
                    <th>Seat</th>
                    <th>Package</th>
                    <th>Option</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Price</th>
                    <th>Discount</th>
                    <th>Status</th>
                    <th>Paid?</th>
                    <th>Payment</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => {
                    const opt = r.package_options;

                    const optionText =
                      opt?.option_name && opt?.duration_value && opt?.duration_unit
                        ? `${opt.option_name} • ${formatDuration(Number(opt.duration_value), opt.duration_unit)}`
                        : opt?.option_name || "—";

                    const paid = toBool(r.is_paid);

                    const base = round2(Math.max(0, toNumber(r.price)));
                    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
                    const due = round2(calc.discountedCost);

                    const pi = getPaidInfo(r);
                    const remaining = round2(Math.max(0, due - pi.totalPaid));

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

                        <td>₱{due.toFixed(2)}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountTextFrom(r.discount_kind, r.discount_value)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(r)}>
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <span className="cell-strong">{getStatus(r.start_at, r.end_at)}</span>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(r)}
                            disabled={togglingPaidId === r.id}
                            title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidId === r.id ? "Updating..." : paid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>Remaining ₱{remaining.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openPaymentModal(r)} disabled={due <= 0}>
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>{(r.discount_reason ?? "").trim() || "—"}</td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => setSelected(r)}>
                              View Receipt
                            </button>
                            <button className="receipt-btn" onClick={() => openCancelModal(r)}>
                              Cancel
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

          {/* CANCEL MODAL (requires description) */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancelling ? null : setCancelTarget(null))}>
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
                      <div style={{ marginTop: 8, color: "#b00020", fontSize: 12 }}>{cancelError}</div>
                    ) : null}
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void runCancel()} disabled={cancelling}>
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT MODAL (FREE INPUTS) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} • {safePhone(paymentTarget.phone_number)}
                </p>

                <hr />

                {(() => {
                  const base = round2(Math.max(0, toNumber(paymentTarget.price)));
                  const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
                  const due = round2(calc.discountedCost);

                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willPaid = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total Due</span>
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
                          onChange={(e) => onChangeGcashFree(e.currentTarget.value)}
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
                          onChange={(e) => onChangeCashFree(e.currentTarget.value)}
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
                        <span>Auto Status</span>
                        <span className="receipt-status">{willPaid ? "PAID" : "UNPAID"}</span>
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

          {/* DISCOUNT MODAL */}
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
                  const val = discountKind === "percent" ? clamp(Math.max(0, rawVal), 0, 100) : Math.max(0, rawVal);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, val);
                  const due = round2(discountedCost);

                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willPaid = due <= 0 ? true : totalPaid >= due;

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
                        <span>₱{round2(due).toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW TOTAL BALANCE</span>
                        <span>₱{round2(due).toFixed(2)}</span>
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
                        <span>Auto Paid</span>
                        <span className="receipt-status">{willPaid ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setDiscountTarget(null)}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount}>
                          {savingDiscount ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* RECEIPT */}
          {selected && (
            <div className="receipt-overlay" onClick={() => void closeReceipt()}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} className="receipt-logo" alt="logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">PROMO RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Status</span>
                  <span>{getStatus(selected.start_at, selected.end_at)}</span>
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

                {selected.package_options?.duration_value && selected.package_options?.duration_unit ? (
                  <div className="receipt-row">
                    <span>Duration</span>
                    <span>
                      {formatDuration(Number(selected.package_options.duration_value), selected.package_options.duration_unit)}
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
                  const { discountedCost, discountAmount } = applyDiscount(base, selected.discount_kind, selected.discount_value);
                  const due = round2(discountedCost);

                  const pi = getPaidInfo(selected);
                  const remaining = round2(Math.max(0, due - pi.totalPaid));
                  const paid = toBool(selected.is_paid);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(selected.discount_kind, selected.discount_value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final Cost</span>
                        <span>₱{due.toFixed(2)}</span>
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
                        <span>Remaining</span>
                        <span>₱{remaining.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Paid Status</span>
                        <span className="receipt-status">{paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="receipt-total">
                        <span>TOTAL</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}

                <div className="modal-actions" style={{ display: "flex", gap: 8 }}>
                  <button
                    className="receipt-btn"
                    onClick={() => {
                      const on = isCustomerViewOnFor(selected.id);
                      void setCustomerViewRealtime(!on, !on ? selected.id : null);
                    }}
                  >
                    {isCustomerViewOnFor(selected.id) ? "Stop View to Customer" : "View to Customer"}
                  </button>

                  <button className="close-btn" onClick={() => void closeReceipt()}>
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

export default Customer_Discount_List;
