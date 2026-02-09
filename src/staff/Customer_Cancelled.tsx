// src/pages/Customer_Cancelled.tsx
// ✅ Cancelled Records page (TABS: Add-Ons / Walk-in / Reservation)
// ✅ Add-Ons tab: your existing logic (Asia/Manila day range +08:00)
// ✅ Walk-in tab: reads public.customer_sessions_cancelled where reservation='no'
// ✅ Reservation tab: reads public.customer_sessions_cancelled where reservation='yes'
// ✅ Same layout/classnames style as your other tables (customer-*)
// ✅ Receipt modal (view details)
// ✅ STRICT TS (no any)

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

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
  // keep yours (locale)
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

const GROUP_WINDOW_MS = 10_000;

/* =========================
   COMPONENT
========================= */
type CancelTab = "addons" | "walkin" | "reservation";

const Customer_Cancelled: React.FC = () => {
  const [tab, setTab] = useState<CancelTab>("addons");

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [loading, setLoading] = useState<boolean>(true);

  // Add-ons data
  const [rowsAddOns, setRowsAddOns] = useState<CancelItemAddOn[]>([]);
  const [selectedGroupAddOns, setSelectedGroupAddOns] = useState<CancelGroupAddOn | null>(null);

  // Sessions data (walk-in + reservation)
  const [rowsSessions, setRowsSessions] = useState<CancelledSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<CancelledSession | null>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tab]);

  const refresh = async (): Promise<void> => {
    if (tab === "addons") {
      await fetchCancelledAddOns(selectedDate);
    } else if (tab === "walkin") {
      await fetchCancelledSessions(selectedDate, "no");
    } else {
      await fetchCancelledSessions(selectedDate, "yes");
    }
  };

  /* -----------------------------
     FETCH: Add-Ons Cancelled
  ------------------------------ */
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

  /* -----------------------------
     FETCH: Sessions Cancelled
     - uses customer_sessions_cancelled
     - filter date by cancelled_at day range (Manila)
     - reservation = 'no' or 'yes'
  ------------------------------ */
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
      const kindRaw = String(r.discount_kind ?? "none") as DiscountKind;
      const kind: DiscountKind =
        kindRaw === "percent" || kindRaw === "amount" || kindRaw === "none" ? kindRaw : "none";

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

  /* -----------------------------
     UI: Tabs header
  ------------------------------ */
  const tabTitle = tab === "addons" ? "Cancelled Add-Ons" : tab === "walkin" ? "Cancelled Walk-in" : "Cancelled Reservation";

  return (
    <IonPage>
      <IonContent className="cancelled-content">
        <div className="customer-lists-container">
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">{tabTitle} Records</h2>
              <div className="customer-subtext">
                Showing cancelled records for: <strong>{selectedDate}</strong>{" "}
                {tab === "addons" ? `(${groupedAddOns.length})` : `(${rowsSessions.length})`}
              </div>
            </div>

            <div className="customer-topbar-right" style={{ gap: 10, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
              {/* ✅ TABS */}
              <div className="customer-searchbar-inline" style={{ minWidth: 360 }}>
                <div className="customer-searchbar-inner" style={{ gap: 8 }}>
                  <button
                    className={`receipt-btn ${tab === "addons" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("addons");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Add-Ons
                  </button>

                  <button
                    className={`receipt-btn ${tab === "walkin" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("walkin");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Walk-in
                  </button>

                  <button
                    className={`receipt-btn ${tab === "reservation" ? "pay-badge pay-badge--paid" : ""}`}
                    onClick={() => {
                      setSelectedGroupAddOns(null);
                      setSelectedSession(null);
                      setTab("reservation");
                    }}
                    style={{ whiteSpace: "nowrap" }}
                    type="button"
                  >
                    Reservation
                  </button>
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

              <button className="receipt-btn" onClick={() => void refresh()} style={{ whiteSpace: "nowrap" }}>
                Refresh
              </button>
            </div>
          </div>

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
                            <div className="action-stack">
                              <button className="receipt-btn" onClick={() => setSelectedGroupAddOns(g)}>
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

                    <hr />

                    {selectedGroupAddOns.items.map((it) => (
                      <div
                        key={it.id}
                        style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}
                      >
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

                    <button className="close-btn" onClick={() => setSelectedGroupAddOns(null)}>
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
          {tab !== "addons" && (
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
                        <th>Paid?</th>
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
                        const statusText = s.is_paid ? "PAID" : "UNPAID";

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
                              <span className={`receipt-btn pay-badge ${s.is_paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}>
                                {statusText}
                              </span>
                            </td>
                            <td style={{ minWidth: 220 }}>
                              <div className="cancel-desc">{s.cancel_reason || "-"}</div>
                            </td>
                            <td>
                              <div className="action-stack">
                                <button className="receipt-btn" onClick={() => setSelectedSession(s)}>
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

                    <button className="close-btn" onClick={() => setSelectedSession(null)}>
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

export default Customer_Cancelled;
