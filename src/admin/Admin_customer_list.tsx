// src/pages/Admin_customer_list.tsx
// ✅ Same logic as Customer_Lists + Admin tools
// ✅ Discount feature (same as Customer_Lists):
//    - Discount button per customer -> modal
//    - Discount kind: percent (%) or amount (₱) or none
//    - Auto recompute totals (table + receipt)
// ✅ Date filter
// ✅ Export to Excel (CSV) for selected date only
// ✅ Admin delete: single row + delete by date
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5;
const DOWN_PAYMENT = 50;

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;
  date: string; // YYYY-MM-DD
  full_name: string;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string; // timestamptz
  time_ended: string; // timestamptz
  total_time: number | null; // minutes
  total_amount: number; // system cost (DB numeric)
  reservation: string;
  reservation_date: string | null;
  seat_number: string;

  // ✅ DISCOUNT columns in DB
  discount_kind?: DiscountKind;
  discount_value?: number;
}

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const csvEscape = (v: string): string => `"${v.replace(/"/g, '""')}"`;

const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

const getDiscountText = (s: CustomerSession): string => {
  const kind = (s.discount_kind ?? "none") as DiscountKind;
  const value = Number(s.discount_value ?? 0);
  return getDiscountTextFrom(kind, value);
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
    const disc = Number(((cost * pct) / 100).toFixed(2));
    const final = Number(Math.max(0, cost - disc).toFixed(2));
    return { discountedCost: final, discountAmount: disc };
  }

  if (kind === "amount") {
    const disc = Number(Math.min(cost, v).toFixed(2));
    const final = Number(Math.max(0, cost - disc).toFixed(2));
    return { discountedCost: final, discountAmount: disc };
  }

  return { discountedCost: Number(cost.toFixed(2)), discountAmount: 0 };
};

const diffMinutes = (startIso: string, endIso: string): number => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / (1000 * 60));
};

const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
  const minutesUsed = diffMinutes(startIso, endIso);
  const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
  const perMinute = HOURLY_RATE / 60;
  return Number((chargeMinutes * perMinute).toFixed(2));
};

const formatMinutesToTime = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
  return `${hrs} hr ${mins} min`;
};

const Admin_customer_list: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  // auto refresh OPEN time display
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // ✅ Date filter
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ Discount modal state
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  useEffect(() => {
    void fetchCustomerSessions();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const fetchCustomerSessions = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .neq("reservation", "yes")
      .order("date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading customer lists");
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions((data as CustomerSession[]) || []);
    setLoading(false);
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999;
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());

    if (typeof s.total_time === "number" && Number.isFinite(s.total_time)) return Number(s.total_time || 0);

    return diffMinutes(s.time_started, s.time_ended);
  };

  // ✅ Base cost before discount (OPEN uses live; CLOSED uses DB)
  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return computeCostWithFreeMinutes(s.time_started, new Date(nowTick).toISOString());
    return Number(s.total_amount || 0);
  };

  // ✅ Final cost after discount
  const getSessionTotalCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const kind = (s.discount_kind ?? "none") as DiscountKind;
    const value = Number(s.discount_value ?? 0);
    return applyDiscount(base, kind, value).discountedCost;
  };

  // ✅ TWO categories (display only one)
  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalance(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChange(s) };
  };

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalMinutes = diffMinutes(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalMinutes,
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
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const deleteSession = async (session: CustomerSession): Promise<void> => {
    const ok = window.confirm(`Delete this record?\n\n${session.full_name} (${session.date})`);
    if (!ok) return;

    try {
      setDeletingId(session.id);

      const { error } = await supabase.from("customer_sessions").delete().eq("id", session.id);

      if (error) {
        alert(`Delete error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setSelectedSession((prev) => (prev?.id === session.id ? null : prev));
    } catch (e) {
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) return;

    const ok = window.confirm(`Delete ALL records on date: ${selectedDate}?\n\nThis will remove them from the database.`);
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("date", selectedDate)
        .neq("reservation", "yes");

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.date !== selectedDate));
      setSelectedSession(null);
    } catch (e) {
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);

  const renderStatus = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  // ✅ Discount modal handlers
  const openDiscountModal = (s: CustomerSession): void => {
    const k = (s.discount_kind ?? "none") as DiscountKind;
    const v = Number(s.discount_value ?? 0);
    setDiscountTarget(s);
    setDiscountKind(k);
    setDiscountInput(String(Number.isFinite(v) ? v : 0));
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

  // ✅ Export to Excel (CSV) for selected date only
  const exportToExcel = (): void => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredSessions.length === 0) {
      alert("No records for selected date.");
      return;
    }

    const headers = [
      "Date",
      "Full Name",
      "Type",
      "Field",
      "Has ID",
      "Specific ID",
      "Hours",
      "Time In",
      "Time Out",
      "Total Time",
      "Amount Label",
      "Amount",
      "Discount",
      "Discount Amount",
      "System Cost (After Discount)",
      "Seat",
      "Status",
    ];

    const rows = filteredSessions.map((s) => {
      const timeIn = formatTimeText(s.time_started);
      const timeOut = isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);
      const status = renderStatus(s);

      const totalMins = getDisplayedTotalMinutes(s);
      const disp = getDisplayAmount(s);

      const base = getBaseSystemCost(s);
      const kind = (s.discount_kind ?? "none") as DiscountKind;
      const value = Number(s.discount_value ?? 0);
      const calc = applyDiscount(base, kind, value);

      return [
        `\t${s.date}`,
        s.full_name,
        s.customer_type,
        s.customer_field ?? "",
        s.has_id ? "Yes" : "No",
        s.id_number ?? "N/A",
        s.hour_avail,
        `\t${timeIn}`,
        `\t${timeOut}`,
        formatMinutesToTime(totalMins),
        disp.label,
        disp.value.toFixed(2),
        getDiscountText(s),
        calc.discountAmount.toFixed(2),
        calc.discountedCost.toFixed(2),
        s.seat_number,
        status,
      ];
    });

    const csv =
      "\ufeff" +
      [headers, ...rows]
        .map((r) => r.map((v) => csvEscape(String(v ?? ""))).join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-nonreservation-${selectedDate}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Admin Customer Lists - Non Reservation
        </h2>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
          />

          <button className="receipt-btn" onClick={exportToExcel} disabled={filteredSessions.length === 0}>
            Export to Excel
          </button>

          <button
            className="receipt-btn"
            onClick={() => void deleteByDate()}
            disabled={filteredSessions.length === 0 || deletingDate === selectedDate}
            style={{ background: "#b00020" }}
          >
            {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong> ({filteredSessions.length})
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filteredSessions.length === 0 ? (
        <p>No data found for this date</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Full Name</th>
              <th>Type</th>
              <th>Field</th>
              <th>Has ID</th>
              <th>Specific ID</th>
              <th>Hours</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Total Time</th>
              <th>Total Balance / Change</th>
              <th>Discount</th>
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredSessions.map((session) => {
              const open = isOpenTimeSession(session);
              const totalMins = getDisplayedTotalMinutes(session);
              const disp = getDisplayAmount(session);

              return (
                <tr key={session.id}>
                  <td>{session.date}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_type}</td>
                  <td>{session.customer_field ?? ""}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number ?? "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{formatTimeText(session.time_started)}</td>
                  <td>{renderTimeOut(session)}</td>

                  <td>{formatMinutesToTime(totalMins)}</td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{disp.label}</span>
                      <span>₱{disp.value.toFixed(2)}</span>
                    </div>
                  </td>

                  {/* ✅ DISCOUNT */}
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>{getDiscountText(session)}</span>
                      <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                        Discount
                      </button>
                    </div>
                  </td>

                  <td>{session.seat_number}</td>
                  <td>{renderStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

                    <button
                      className="receipt-btn"
                      disabled={deletingId === session.id}
                      onClick={() => void deleteSession(session)}
                      style={{ background: "#444" }}
                    >
                      {deletingId === session.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              <select
                value={discountKind}
                onChange={(e) => setDiscountKind(e.currentTarget.value as DiscountKind)}
              >
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
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.currentTarget.value)}
                  style={{ width: 140 }}
                  disabled={discountKind === "none"}
                />
              </div>
            </div>

            {(() => {
              const base = getBaseSystemCost(discountTarget);
              const val = Number(discountInput);
              const safeVal = Number.isFinite(val) ? val : 0;

              const appliedVal =
                discountKind === "percent" ? clamp(Math.max(0, safeVal), 0, 100) : Math.max(0, safeVal);

              const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);

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

                  <div className="receipt-total">
                    <span>FINAL SYSTEM COST</span>
                    <span>₱{discountedCost.toFixed(2)}</span>
                  </div>
                </>
              );
            })()}

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
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      {selectedSession && (
        <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
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
              <span>Total Time</span>
              <span>{formatMinutesToTime(getDisplayedTotalMinutes(selectedSession))}</span>
            </div>

            {isOpenTimeSession(selectedSession) && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="receipt-btn"
                  disabled={stoppingId === selectedSession.id}
                  onClick={() => void stopOpenTime(selectedSession)}
                  style={{ width: "100%" }}
                >
                  {stoppingId === selectedSession.id ? "Stopping..." : "Stop Time (Set Time Out Now)"}
                </button>
              </div>
            )}

            <hr />

            {(() => {
              const disp = getDisplayAmount(selectedSession);

              const base = getBaseSystemCost(selectedSession);
              const kind = (selectedSession.discount_kind ?? "none") as DiscountKind;
              const value = Number(selectedSession.discount_value ?? 0);
              const calc = applyDiscount(base, kind, value);

              return (
                <>
                  <div className="receipt-row">
                    <span>{disp.label}</span>
                    <span>₱{disp.value.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Discount</span>
                    <span>{getDiscountText(selectedSession)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Discount Amount</span>
                    <span>₱{calc.discountAmount.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{calc.discountedCost.toFixed(2)}</span>
                  </div>

                  <div className="receipt-total">
                    <span>{disp.label.toUpperCase()}</span>
                    <span>₱{disp.value.toFixed(2)}</span>
                  </div>
                </>
              );
            })()}

            <p className="receipt-footer">
              Thank you for choosing <br />
              <strong>Me Tyme Lounge</strong>
            </p>

            <button className="close-btn" onClick={() => setSelectedSession(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin_customer_list;
