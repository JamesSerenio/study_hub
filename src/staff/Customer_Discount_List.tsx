// src/pages/Customer_Discount_List.tsx
// ✅ SAME behavior as Admin_Customer_Discount_List.tsx
// ✅ Can edit: Discount + Discount Reason + Payment + Paid Toggle
// ✅ Has Date Filter (view-only filter)
// ❌ NO Delete
// ❌ NO Delete by Date
// ✅ strict TS (NO "any")

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";
type DiscountKind = "none" | "percent" | "amount";

interface PromoBookingRow {
  id: string;
  created_at: string;
  full_name: string;
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
}

interface PromoBookingDBRow {
  id: string;
  created_at: string;
  full_name: string;
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

const prettyArea = (a: PackageArea): string =>
  a === "conference_room" ? "Conference Room" : "Common Area";

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

const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
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

/* ================= COMPONENT ================= */

const Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);

  // ✅ DATE FILTER (view-only)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // refresh status/time
  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<PromoBookingRow | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // discount modal (WITH reason + auto payment after)
  const [discountTarget, setDiscountTarget] = useState<PromoBookingRow | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValueInput, setDiscountValueInput] = useState<string>("0");
  const [discountReasonInput, setDiscountReasonInput] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // paid toggle
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  const fetchPromoBookings = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("promo_bookings")
      .select(
        `
        id,
        created_at,
        full_name,
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

  const filteredRows = useMemo(() => {
    void tick;
    return rows.filter((r) => getCreatedDateLocal(r.created_at) === selectedDate);
  }, [rows, tick, selectedDate]);

  const getPaidInfo = (r: PromoBookingRow): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const openPaymentModal = (r: PromoBookingRow): void => {
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    const due = round2(calc.discountedCost);

    const pi = getPaidInfo(r);
    const existingGcash = pi.totalPaid > 0 ? pi.gcash : 0;

    // ✅ FIX: total paid always matches due (no overpay)
    const adj = recalcPaymentsToDue(due, existingGcash);

    setPaymentTarget(r);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setGcashAndAutoCash = (r: PromoBookingRow, gcashStr: string): void => {
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    const due = round2(calc.discountedCost);

    const gc = Math.max(0, toNumber(gcashStr));
    const adj = recalcPaymentsToDue(due, gc);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setCashAndAutoGcash = (r: PromoBookingRow, cashStr: string): void => {
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    const due = round2(calc.discountedCost);

    const ca = round2(Math.max(0, toNumber(cashStr)));

    // ✅ FIX: keep totalPaid == due
    const cash = round2(Math.min(due, ca));
    const gcash = round2(Math.max(0, due - cash));

    setCashInput(String(cash));
    setGcashInput(String(gcash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const base = round2(Math.max(0, toNumber(paymentTarget.price)));
    const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
    const due = round2(calc.discountedCost);

    const gcIn = Math.max(0, toNumber(gcashInput));
    const adj = recalcPaymentsToDue(due, gcIn);

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due <= 0 ? false : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          gcash_amount: adj.gcash,
          cash_amount: adj.cash,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select(
          `
          id,
          created_at,
          full_name,
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

    // Default payment after (based on FINAL cost)
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    const due = round2(calc.discountedCost);

    const pi = getPaidInfo(r);
    const existingGcash = pi.totalPaid > 0 ? pi.gcash : 0;
    const adj = recalcPaymentsToDue(due, existingGcash);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const base = round2(Math.max(0, toNumber(discountTarget.price)));

    const rawVal = toNumber(discountValueInput);
    const cleanVal = round2(Math.max(0, rawVal));
    const finalVal = discountKind === "percent" ? clamp(cleanVal, 0, 100) : cleanVal;

    const calc = applyDiscount(base, discountKind, finalVal);
    const newDue = round2(calc.discountedCost);

    // auto payment after discount
    const gcIn = Math.max(0, toNumber(gcashInput));
    const adjPay = recalcPaymentsToDue(newDue, gcIn);
    const totalPaid = round2(adjPay.gcash + adjPay.cash);
    const isPaidAuto = newDue <= 0 ? false : totalPaid >= newDue;

    try {
      setSavingDiscount(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          discount_kind: discountKind,
          discount_value: finalVal,
          discount_reason: discountReasonInput.trim() || null,

          gcash_amount: adjPay.gcash,
          cash_amount: adjPay.cash,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", discountTarget.id)
        .select(
          `
          id,
          created_at,
          full_name,
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
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const totals = useMemo(() => {
    void tick;

    const total = filteredRows.reduce((sum, r) => {
      const base = round2(Math.max(0, toNumber(r.price)));
      const calc = applyDiscount(base, r.discount_kind, r.discount_value);
      return sum + round2(calc.discountedCost);
    }, 0);

    const upcoming = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "UPCOMING").length;
    const ongoing = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "ONGOING").length;
    const finished = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "FINISHED").length;

    return { total, upcoming, ongoing, finished };
  }, [filteredRows, tick]);

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Customer Discount / Promo Records
        </h2>

        {/* ✅ Date Filter (same idea, but view-only) */}
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))} />
      </div>

      <div style={{ marginBottom: 10, opacity: 0.85, marginTop: 10 }}>
        <span style={{ marginRight: 14 }}>
          Upcoming: <strong>{totals.upcoming}</strong>
        </span>
        <span style={{ marginRight: 14 }}>
          Ongoing: <strong>{totals.ongoing}</strong>
        </span>
        <span style={{ marginRight: 14 }}>
          Finished: <strong>{totals.finished}</strong>
        </span>
        <span>
          Total Sales: <strong>₱{totals.total.toFixed(2)}</strong>
        </span>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filteredRows.length === 0 ? (
        <p>No promo records found</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
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
                  <td>{prettyArea(r.area)}</td>
                  <td>{seatLabel(r)}</td>
                  <td>{r.packages?.title || "—"}</td>
                  <td>{optionText}</td>
                  <td>{new Date(r.start_at).toLocaleString("en-PH")}</td>
                  <td>{new Date(r.end_at).toLocaleString("en-PH")}</td>

                  <td>₱{due.toFixed(2)}</td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>
                        {getDiscountTextFrom(r.discount_kind, r.discount_value)}
                      </span>
                      <button className="receipt-btn" onClick={() => openDiscountModal(r)}>
                        Discount
                      </button>
                    </div>
                  </td>

                  <td>
                    <strong>{getStatus(r.start_at, r.end_at)}</strong>
                  </td>

                  <td>
                    <button
                      className="receipt-btn"
                      onClick={() => void togglePaid(r)}
                      disabled={togglingPaidId === r.id}
                      style={{ background: paid ? "#1b5e20" : "#b00020" }}
                      title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                    >
                      {togglingPaidId === r.id ? "Updating..." : paid ? "PAID" : "UNPAID"}
                    </button>
                  </td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 12 }}>
                        GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.85 }}>
                        Remaining ₱{remaining.toFixed(2)}
                      </span>
                      <button className="receipt-btn" onClick={() => openPaymentModal(r)} disabled={due <= 0}>
                        Payment
                      </button>
                    </div>
                  </td>

                  <td>{(r.discount_reason ?? "").trim() || "—"}</td>

                  <td style={{ display: "flex", gap: 8 }}>
                    <button className="receipt-btn" onClick={() => setSelected(r)}>
                      View Receipt
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* PAYMENT MODAL */}
      {paymentTarget && (
        <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
          <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
            <h3 className="receipt-title">PAYMENT</h3>
            <p className="receipt-subtitle">{paymentTarget.full_name}</p>

            <hr />

            {(() => {
              const base = round2(Math.max(0, toNumber(paymentTarget.price)));
              const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
              const due = round2(calc.discountedCost);

              const gcIn = Math.max(0, toNumber(gcashInput));
              const adj = recalcPaymentsToDue(due, gcIn);

              const totalPaid = round2(adj.gcash + adj.cash);
              const remaining = round2(Math.max(0, due - totalPaid));
              const willPaid = due > 0 && totalPaid >= due;

              return (
                <>
                  <div className="receipt-row">
                    <span>Total Due</span>
                    <span>₱{due.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>GCash</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gcashInput}
                      onChange={(e) => setGcashAndAutoCash(paymentTarget, e.currentTarget.value)}
                      style={{ width: 160 }}
                    />
                  </div>

                  <div className="receipt-row">
                    <span>Cash</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashInput}
                      onChange={(e) => setCashAndAutoGcash(paymentTarget, e.currentTarget.value)}
                      style={{ width: 160 }}
                    />
                  </div>

                  <hr />

                  <div className="receipt-row">
                    <span>Total Paid</span>
                    <span>₱{totalPaid.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Remaining</span>
                    <span>₱{remaining.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Auto Status</span>
                    <span style={{ fontWeight: 900 }}>{willPaid ? "PAID" : "UNPAID"}</span>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="receipt-btn" onClick={() => setPaymentTarget(null)} style={{ flex: 1 }}>
                      Cancel
                    </button>
                    <button
                      className="receipt-btn"
                      onClick={() => void savePayment()}
                      disabled={savingPayment}
                      style={{ flex: 1 }}
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 900 }}>
                  {discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}
                </span>
                <input
                  type="number"
                  min="0"
                  step={discountKind === "percent" ? "1" : "0.01"}
                  value={discountValueInput}
                  onChange={(e) => setDiscountValueInput(e.currentTarget.value)}
                  style={{ width: 140 }}
                  disabled={discountKind === "none"}
                />
              </div>
            </div>

            <div className="receipt-row">
              <span>Reason</span>
              <input
                type="text"
                value={discountReasonInput}
                onChange={(e) => setDiscountReasonInput(e.currentTarget.value)}
                placeholder="e.g. loyalty card"
                style={{ width: 200 }}
              />
            </div>

            {(() => {
              const base = round2(Math.max(0, toNumber(discountTarget.price)));
              const rawVal = toNumber(discountValueInput);
              const val = discountKind === "percent" ? clamp(Math.max(0, rawVal), 0, 100) : Math.max(0, rawVal);

              const { discountedCost, discountAmount } = applyDiscount(base, discountKind, val);

              const gcIn = Math.max(0, toNumber(gcashInput));
              const adjPay = recalcPaymentsToDue(discountedCost, gcIn);

              const totalPaid = round2(adjPay.gcash + adjPay.cash);
              const willPaid = discountedCost > 0 && totalPaid >= discountedCost;

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
                    <span>₱{round2(discountedCost).toFixed(2)}</span>
                  </div>

                  <div className="receipt-total">
                    <span>NEW TOTAL BALANCE</span>
                    <span>₱{round2(discountedCost).toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Auto Payment After</span>
                    <span>
                      GCash ₱{adjPay.gcash.toFixed(2)} / Cash ₱{adjPay.cash.toFixed(2)}
                    </span>
                  </div>

                  <div className="receipt-row">
                    <span>Auto Paid</span>
                    <span style={{ fontWeight: 900 }}>{willPaid ? "PAID" : "UNPAID"}</span>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="receipt-btn" onClick={() => setDiscountTarget(null)} style={{ flex: 1 }}>
                      Cancel
                    </button>
                    <button
                      className="receipt-btn"
                      onClick={() => void saveDiscount()}
                      disabled={savingDiscount}
                      style={{ flex: 1 }}
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

      {/* RECEIPT (VIEW ONLY) */}
      {selected && (
        <div className="receipt-overlay" onClick={() => setSelected(null)}>
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
              <span>Customer</span>
              <span>{selected.full_name}</span>
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
              const { discountedCost, discountAmount } = applyDiscount(base, selected.discount_kind, selected.discount_value);
              const due = round2(discountedCost);

              const pi = getPaidInfo(selected);
              const remaining = round2(Math.max(0, due - pi.totalPaid));
              const paid = toBool(selected.is_paid);

              return (
                <>
                  {/* ✅ Receipt shows discount + discount amount */}
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
                    <span style={{ fontWeight: 900 }}>{paid ? "PAID" : "UNPAID"}</span>
                  </div>

                  {/* ❌ discount_reason intentionally hidden */}

                  <div className="receipt-total">
                    <span>TOTAL</span>
                    <span>₱{due.toFixed(2)}</span>
                  </div>
                </>
              );
            })()}

            <button className="close-btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customer_Discount_List;
