// src/pages/Admin_customer_reservation.tsx
// ✅ Date filter (shows records by selected reservation_date)
// ✅ Export to Excel (CSV) for selected date only (UTF-8 BOM, Date/Time as TEXT, Amount as NUMBER only)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both) in table + receipt
// ✅ Delete single row
// ✅ Delete by DATE (deletes ALL records with reservation_date = selectedDate from DB)
// ✅ Promo filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5; // hidden
const DOWN_PAYMENT = 50;

interface CustomerSession {
  id: string;
  date: string;
  full_name: string;
  customer_type: string;
  customer_field: string;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string;
  time_ended: string;

  // minutes stored in DB (numeric may come as number|string)
  total_time: number | string;
  total_amount: number | string;

  reservation: string;
  reservation_date: string | null; // YYYY-MM-DD
  seat_number: string;
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

const Admin_customer_reservation: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(Date.now());

  // ✅ date filter
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  useEffect(() => {
    void fetchReservations();
  }, []);

  // tick so OPEN sessions auto-update display
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const toNum = (v: number | string | null | undefined): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const isPromoType = (t: string | null | undefined): boolean => {
    const v = (t ?? "").trim().toLowerCase();
    return v === "promo";
  };

  const fetchReservations = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select(`*`)
      .eq("reservation", "yes")
      .neq("customer_type", "promo")
      .order("reservation_date", { ascending: false });

    if (error) {
      console.error(error);
      alert(`Error loading reservations: ${error.message}`);
      setSessions([]);
      setLoading(false);
      return;
    }

    const cleaned = ((data as CustomerSession[]) || []).filter((s) => !isPromoType(s.customer_type));
    setSessions(cleaned);
    setLoading(false);
  };

  // ✅ filter by selectedDate (reservation_date)
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.reservation_date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

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

  const formatMinutesToTime = (minutes: number): string => {
    if (!minutes || minutes <= 0) return "0 min";

    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
    return `${hrs} hr ${mins} min`;
  };

  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return Number((chargeMinutes * perMinute).toFixed(2));
  };

  const getScheduledStartDateTime = (s: CustomerSession): Date => {
    const start = new Date(s.time_started);
    if (s.reservation_date) {
      const d = new Date(s.reservation_date);
      start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return start;
  };

  const getStatus = (session: CustomerSession): string => {
    const now = new Date(nowTick);
    const start = getScheduledStartDateTime(session);
    const end = new Date(session.time_ended);

    if (now < start) return "Upcoming";
    if (now >= start && now <= end) return "Ongoing";
    return "Finished";
  };

  const canShowStopButton = (session: CustomerSession): boolean => {
    if (!isOpenTimeSession(session)) return false;
    const startMs = getScheduledStartDateTime(session).getTime();
    if (!Number.isFinite(startMs)) return false;
    return nowTick >= startMs;
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
    return toNum(s.total_time);
  };

  const getLiveTotalCost = (s: CustomerSession): number => {
    const endIso = new Date(nowTick).toISOString();
    const timeCost = computeCostWithFreeMinutes(s.time_started, endIso);
    return Number(timeCost.toFixed(2));
  };

  const getSessionTotalCost = (s: CustomerSession): number => {
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : toNum(s.total_amount);
  };

  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
  };

  // ✅ ONLY ONE display value
  const getDisplayAmount = (
    s: CustomerSession
  ): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalance(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChange(s) };
  };

  const stopReservationTime = async (session: CustomerSession): Promise<void> => {
    if (!canShowStopButton(session)) {
      alert("Stop Time is only allowed when the reservation date/time has started.");
      return;
    }

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
        .select(`*`)
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => {
        const next = prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s));
        return next.filter((s) => !isPromoType(s.customer_type));
      });

      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const deleteSession = async (session: CustomerSession): Promise<void> => {
    const ok = window.confirm(
      `Delete this reservation record?\n\n${session.full_name}\nReservation Date: ${session.reservation_date ?? "N/A"}`
    );
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

  // ✅ delete ALL rows by selectedDate
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const count = filteredSessions.length;
    const ok = window.confirm(
      `Delete ALL reservation records on ${selectedDate}?\n\nThis will delete ${count} record(s) from the database.`
    );
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("reservation", "yes")
        .eq("reservation_date", selectedDate)
        .neq("customer_type", "promo");

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      // remove from UI
      setSessions((prev) => prev.filter((s) => (s.reservation_date ?? "") !== selectedDate));
      setSelectedSession((prev) => ((prev?.reservation_date ?? "") === selectedDate ? null : prev));
    } catch (e) {
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);

  // ✅ Export to Excel (CSV) for selected date only
  // FIXED:
  // - UTF-8 BOM
  // - Date/Time forced as TEXT
  // - Amount as NUMBER only
  // - Exports ONE: Amount Label + Amount
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
      "Reservation Date",
      "Full Name",
      "Field",
      "Has ID",
      "Specific ID",
      "Hours",
      "Time In",
      "Time Out",
      "Total Time (min)",
      "Amount Label",
      "Amount",
      "Seat",
      "Status",
    ];

    const rows = filteredSessions.map((s) => {
      const timeIn = formatTimeText(s.time_started);
      const timeOut = isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);
      const status = getStatus(s);
      const disp = getDisplayAmount(s);

      return [
        `\t${s.reservation_date ?? ""}`, // force text
        s.full_name,
        s.customer_field ?? "",
        s.has_id ? "Yes" : "No",
        s.id_number ?? "N/A",
        s.hour_avail,
        `\t${timeIn}`, // force text
        `\t${timeOut}`, // force text
        String(getDisplayedTotalMinutes(s) ?? 0),
        disp.label,
        disp.value.toFixed(2), // number only
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
    a.download = `admin-reservations-${selectedDate}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Admin Customer Reservations
        </h2>

        {/* ✅ Date filter + Export + Delete by Date */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
          />

          <button className="receipt-btn" onClick={exportToExcel}>
            Export to Excel
          </button>

          <button
            className="receipt-btn"
            onClick={() => void deleteByDate()}
            disabled={deletingDate === selectedDate}
          >
            {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filteredSessions.length === 0 ? (
        <p>No reservation records found for this date</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th>Reservation Date</th>
              <th>Full Name</th>
              <th>Field</th>
              <th>Has ID</th>
              <th>Specific ID</th>
              <th>Hours</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Total Time</th>
              <th>Total Balance / Change</th>
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredSessions.map((session) => {
              const showStop = canShowStopButton(session);
              const mins = getDisplayedTotalMinutes(session);
              const disp = getDisplayAmount(session);

              return (
                <tr key={session.id}>
                  <td>{session.reservation_date ?? "N/A"}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_field}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number || "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{formatTimeText(session.time_started)}</td>
                  <td>{renderTimeOut(session)}</td>

                  <td>{formatMinutesToTime(mins)}</td>

                  {/* ✅ ONLY ONE OUTPUT */}
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{disp.label}</span>
                      <span>₱{disp.value.toFixed(2)}</span>
                    </div>
                  </td>

                  <td>{session.seat_number}</td>
                  <td>{getStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8 }}>
                    {showStop && (
                      <button
                        className="receipt-btn"
                        disabled={stoppingId === session.id}
                        onClick={() => void stopReservationTime(session)}
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

      {/* RECEIPT MODAL */}
      {selectedSession && (
        <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
          <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
            <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

            <h3 className="receipt-title">ME TYME LOUNGE</h3>
            <p className="receipt-subtitle">RESERVATION RECEIPT</p>

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

            {isOpenTimeSession(selectedSession) && canShowStopButton(selectedSession) && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="receipt-btn"
                  disabled={stoppingId === selectedSession.id}
                  onClick={() => void stopReservationTime(selectedSession)}
                  style={{ width: "100%" }}
                >
                  {stoppingId === selectedSession.id ? "Stopping..." : "Stop Time (Set Time Out Now)"}
                </button>
              </div>
            )}

            <hr />

            {(() => {
              const disp = getDisplayAmount(selectedSession);
              const totalCost = getSessionTotalCost(selectedSession);

              return (
                <>
                  {/* ✅ ONLY ONE SUMMARY LINE */}
                  <div className="receipt-row">
                    <span>{disp.label}</span>
                    <span>₱{disp.value.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                  </div>

                  {/* optional debug (remove if you want hidden) */}
                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{Number(totalCost || 0).toFixed(2)}</span>
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

export default Admin_customer_reservation;
