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

const startEndIsoLocalDay = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const [yStr, mStr, dStr] = yyyyMmDd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  const startLocal = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endLocal = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  return { startIso: startLocal.toISOString(), endIso: endLocal.toISOString() };
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

/**
 * ✅ The ONLY rule for payment:
 * Total Paid must equal Due (no more, no less).
 * If user types GCash -> Cash auto updates.
 * If user types Cash -> GCash auto updates.
 */
const normalizePaymentToDue = (
  due: number,
  gcash: number,
  cash: number,
  edited: "gcash" | "cash"
): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const gIn = round2(Math.max(0, gcash));
  const cIn = round2(Math.max(0, cash));

  if (edited === "gcash") {
    const g = round2(Math.min(d, gIn));
    const c = round2(Math.max(0, d - g));
    return { gcash: g, cash: c };
  }

  // edited cash
  const c = round2(Math.min(d, cIn));
  const g = round2(Math.max(0, d - c));
  return { gcash: g, cash: c };
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

const Admin_Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // refresh status/time
  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  // ✅ date filter + delete by date
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

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

  const totals = useMemo(() => {
    void tick;

    const total = filteredRows.reduce((sum, r) => sum + toNumber(r.price), 0);
    const upcoming = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "UPCOMING").length;
    const ongoing = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "ONGOING").length;
    const finished = filteredRows.filter((r) => getStatus(r.start_at, r.end_at) === "FINISHED").length;

    return { total, upcoming, ongoing, finished };
  }, [filteredRows, tick]);

  const getPaidInfo = (r: PromoBookingRow): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const getDueAfterDiscount = (r: PromoBookingRow): { due: number; discountAmount: number } => {
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    return { due: round2(calc.discountedCost), discountAmount: round2(calc.discountAmount) };
  };

  const openPaymentModal = (r: PromoBookingRow): void => {
    const d = getDueAfterDiscount(r).due;
    const pi = getPaidInfo(r);

    // ✅ normalize current amounts to due (keep current cash as priority? we keep gcash as priority here)
    const adj = normalizePaymentToDue(d, pi.gcash, pi.cash, "gcash");

    setPaymentTarget(r);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const onChangeGcash = (r: PromoBookingRow, gcashStr: string): void => {
    const d = getDueAfterDiscount(r).due;
    const g = toNumber(gcashStr);
    const c = toNumber(cashInput);
    const adj = normalizePaymentToDue(d, g, c, "gcash");
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const onChangeCash = (r: PromoBookingRow, cashStr: string): void => {
    const d = getDueAfterDiscount(r).due;
    const c = toNumber(cashStr);
    const g = toNumber(gcashInput);
    const adj = normalizePaymentToDue(d, g, c, "cash");
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = getDueAfterDiscount(paymentTarget).due;

    const g = round2(Math.max(0, toNumber(gcashInput)));
    const c = round2(Math.max(0, toNumber(cashInput)));
    const adj = normalizePaymentToDue(due, g, c, "gcash"); // safe normalize

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due > 0 ? totalPaid >= due : false;

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

  // ✅ DISCOUNT MODAL
  const openDiscountModal = (r: PromoBookingRow): void => {
    setDiscountTarget(r);
    setDiscountKind(r.discount_kind ?? "none");
    setDiscountValueInput(String(round2(toNumber(r.discount_value))));
    setDiscountReasonInput(String(r.discount_reason ?? ""));

    // initialize payment inputs based on due after discount (current values)
    const dueNow = getDueAfterDiscount(r).due;
    const pi = getPaidInfo(r);
    const adj = normalizePaymentToDue(dueNow, pi.gcash, pi.cash, "gcash");
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

    // ✅ normalize payments to NEW due (user typed in modal)
    const g = round2(Math.max(0, toNumber(gcashInput)));
    const c = round2(Math.max(0, toNumber(cashInput)));
    const adjPay = normalizePaymentToDue(newDue, g, c, "gcash");

    const totalPaid = round2(adjPay.gcash + adjPay.cash);
    const isPaidAuto = newDue > 0 ? totalPaid >= newDue : false;

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

  const deletePromoBooking = async (row: PromoBookingRow): Promise<void> => {
    const ok = window.confirm(
      `Delete this promo record?\n\n${row.full_name}\n${prettyArea(row.area)} - ${seatLabel(
        row
      )}\nStart: ${new Date(row.start_at).toLocaleString("en-PH")}`
    );
    if (!ok) return;

    try {
      setDeletingId(row.id);

      const { error: csErr1 } = await supabase.from("customer_sessions").delete().eq("promo_booking_id", row.id);

      if (csErr1 && /promo_booking_id/i.test(csErr1.message)) {
        const seat = row.area === "conference_room" ? "CONFERENCE ROOM" : row.seat_number ?? "";

        const { error: csErr2 } = await supabase
          .from("customer_sessions")
          .delete()
          .eq("customer_type", "promo")
          .eq("full_name", row.full_name)
          .eq("seat_number", seat)
          .eq("time_started", row.start_at)
          .eq("time_ended", row.end_at);

        if (csErr2) {
          alert(`Delete customer session error: ${csErr2.message}`);
          return;
        }
      } else if (csErr1) {
        alert(`Delete customer session error: ${csErr1.message}`);
        return;
      }

      const { data, error } = await supabase.from("promo_bookings").delete().eq("id", row.id).select("id").maybeSingle();

      if (error) {
        alert(`Delete promo error: ${error.message}`);
        return;
      }

      if (!data?.id) {
        alert("Delete failed: not permitted by RLS or record not found.");
        return;
      }

      setRows((prev) => prev.filter((x) => x.id !== row.id));
      setSelected((prev) => (prev?.id === row.id ? null : prev));
    } finally {
      setDeletingId(null);
    }
  };

  // ✅ DELETE BY DATE (promo_bookings by created_at day)
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const count = filteredRows.length;
    const ok = window.confirm(
      `Delete ALL promo records on ${selectedDate}?\n\nThis will delete ${count} record(s).`
    );
    if (!ok) return;

    const range = startEndIsoLocalDay(selectedDate);

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase
        .from("promo_bookings")
        .delete()
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso);

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      // remove from UI
      setRows((prev) => prev.filter((r) => getCreatedDateLocal(r.created_at) !== selectedDate));
      setSelected((prev) => (prev && getCreatedDateLocal(prev.created_at) === selectedDate ? null : prev));
    } catch (e) {
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Admin Discount / Promo Records
        </h2>

        {/* ✅ DATE FILTER + DELETE BY DATE */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))} />
          <button className="receipt-btn" onClick={() => void deleteByDate()} disabled={deletingDate === selectedDate}>
            {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong>
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
        <p>No promo records found for this date</p>
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

              const { due, discountAmount } = getDueAfterDiscount(r);

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
                      <span style={{ fontSize: 12, opacity: 0.85 }}>
                        Disc ₱{discountAmount.toFixed(2)}
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

                    <button className="receipt-btn" disabled={deletingId === r.id} onClick={() => void deletePromoBooking(r)}>
                      {deletingId === r.id ? "Deleting..." : "Delete"}
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
              const { due } = getDueAfterDiscount(paymentTarget);

              const gIn = round2(Math.max(0, toNumber(gcashInput)));
              const cIn = round2(Math.max(0, toNumber(cashInput)));
              const adj = normalizePaymentToDue(due, gIn, cIn, "gcash");

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
                      onChange={(e) => onChangeGcash(paymentTarget, e.currentTarget.value)}
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
                      onChange={(e) => onChangeCash(paymentTarget, e.currentTarget.value)}
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
                    <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment} style={{ flex: 1 }}>
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

              // preview payment after discount using CURRENT inputs
              const gIn = round2(Math.max(0, toNumber(gcashInput)));
              const cIn = round2(Math.max(0, toNumber(cashInput)));
              const adjPay = normalizePaymentToDue(discountedCost, gIn, cIn, "gcash");

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
                    <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount} style={{ flex: 1 }}>
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
                  {/* ✅ show discount in receipt */}
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

export default Admin_Customer_Discount_List;
