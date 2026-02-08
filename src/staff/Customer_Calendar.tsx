// src/pages/Customer_Calendar.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ Shows counts (numbers) on icons
// ✅ Reservation = TOP-LEFT (with count)
// ✅ Walk-in     = BOTTOM-RIGHT (with count)
// ✅ Removes blue tap highlight (keeps yellow current date)
// ✅ customer_sessions + promo_bookings logic
// ✅ FIX: hides neighboring month days (no 26–31 / no extra "1")
// ✅ FIX: Sunday-first calendar (en-US)
// ✅ Refresh button + auto refresh every 30s (nice for live updates)
// ✅ Decor image (s.png) OUTSIDE the card
// ✅ NEW: Tap a date -> modal shows FULL NAMES (walk-in + reservation)
// ✅ NEW: Shows booked at, time in/out, seat (if meron)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonContent,
  IonPage,
  IonModal,
  IonButton,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonIcon,
  IonSpinner,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { supabase } from "../utils/supabaseClient";

// swapped icons
import walkInIcon from "../assets/customer_reservation.png";
import reservationIcon from "../assets/customer.png";

// ✅ decor
import sDecor from "../assets/s.png";

type Area = "common_area" | "conference_room" | string;

type Counts = {
  walkIn: number;
  reservation: number;
};

type CountMap = Record<string, Counts>;

type TileArgs = {
  date: Date;
  view: "month" | "year" | "decade" | "century";
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfDayLocal = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

const endOfDayLocal = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const ensure = (m: CountMap, date: string): Counts => {
  if (!m[date]) m[date] = { walkIn: 0, reservation: 0 };
  return m[date];
};

const addCount = (m: CountMap, date: string, key: keyof Counts): void => {
  ensure(m, date)[key] += 1;
};

const safeDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const fmtDateTime = (iso: string | null | undefined): string => {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const fmtTimeOnly = (iso: string | null | undefined): string => {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/* =========================
   DB TYPES (STRICT)
========================= */

interface CustomerSessionRow {
  id: string;
  date: string; // yyyy-mm-dd
  full_name: string | null;

  reservation: string; // "yes" | "no"
  reservation_date: string | null; // yyyy-mm-dd

  time_started: string | null; // timestamptz
  time_ended: string | null; // timestamptz

  seat_number: string | null;
  created_at: string | null;

  customer_type?: string | null; // used to ignore "promo"
}

interface PromoBookingRow {
  id: string;
  created_at: string | null;

  full_name: string | null;
  seat_number: string | null;

  start_at: string; // ISO
  end_at: string | null;

  area: Area;
  status: string | null;
}

/* =========================
   MODAL ITEM TYPES
========================= */

type DayKind = "walkIn" | "reservation";

type DayItem = {
  kind: DayKind;
  source: "session" | "promo";
  id: string;

  full_name: string;

  booked_at: string | null; // created_at if available
  time_in: string | null; // time_started or start_at
  time_out: string | null; // time_ended or end_at
  seat: string | null;

  area?: Area;
  status?: string | null;
};

const normalizeName = (v: string | null | undefined): string => {
  const s = String(v ?? "").trim();
  return s || "Unknown";
};

const Customer_Calendar: React.FC = () => {
  const [counts, setCounts] = useState<CountMap>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // ✅ modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dayLoading, setDayLoading] = useState<boolean>(false);
  const [dayWalkIns, setDayWalkIns] = useState<DayItem[]>([]);
  const [dayReservations, setDayReservations] = useState<DayItem[]>([]);

  useEffect(() => {
    void loadCalendar();

    const t = window.setInterval(() => {
      void loadCalendar();
    }, 30000);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCalendar = async (): Promise<void> => {
    try {
      setLoading(true);

      const sessionsReq = supabase
        .from("customer_sessions")
        .select("id, date, full_name, reservation, reservation_date, customer_type");

      const promosReq = supabase
        .from("promo_bookings")
        .select("id, start_at, area, status");

      const [{ data: sessions, error: sErr }, { data: promos, error: pErr }] =
        await Promise.all([sessionsReq, promosReq]);

      if (sErr) console.error("customer_sessions error:", sErr.message);
      if (pErr) console.error("promo_bookings error:", pErr.message);

      const result: CountMap = {};

      // ✅ sessions (ignore promo)
      (sessions ?? []).forEach((s: Omit<CustomerSessionRow, "time_started" | "time_ended" | "seat_number" | "created_at">) => {
        const ctype = String(s.customer_type ?? "").trim().toLowerCase();
        if (ctype === "promo") return;

        if (s.reservation === "yes" && s.reservation_date) {
          addCount(result, s.reservation_date, "reservation");
        } else {
          addCount(result, s.date, "walkIn");
        }
      });

      // ✅ promos (use CURRENT day range)
      const now = new Date();
      const todayStart = startOfDayLocal(now);
      const todayEnd = endOfDayLocal(now);

      (promos ?? []).forEach((p: Pick<PromoBookingRow, "start_at" | "area" | "status">) => {
        const start = new Date(p.start_at);
        if (!Number.isFinite(start.getTime())) return;

        const dateKey = yyyyMmDdLocal(start);

        if (p.area === "common_area") {
          const isToday = start >= todayStart && start <= todayEnd;

          // If it's today and already started -> walk-in, else future -> reservation
          if (isToday && start <= now) addCount(result, dateKey, "walkIn");
          else addCount(result, dateKey, "reservation");
        } else if (p.area === "conference_room") {
          addCount(result, dateKey, "reservation");
        } else {
          // default: treat unknown area as reservation
          addCount(result, dateKey, "reservation");
        }
      });

      setCounts(result);
      setLastUpdated(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    } finally {
      setLoading(false);
    }
  };

  const loadDayDetails = async (day: Date): Promise<void> => {
    const dayKey = yyyyMmDdLocal(day);

    try {
      setDayLoading(true);
      setDayWalkIns([]);
      setDayReservations([]);

      // We fetch all sessions for that date OR reservations that point to that date
      const sessionsReq = supabase
        .from("customer_sessions")
        .select(
          "id, date, full_name, reservation, reservation_date, time_started, time_ended, seat_number, created_at, customer_type"
        )
        .or(`date.eq.${dayKey},reservation_date.eq.${dayKey}`);

      // Promos for that day (range using start_at)
      const dayStartIso = startOfDayLocal(day).toISOString();
      const dayEndIso = endOfDayLocal(day).toISOString();

      const promosReq = supabase
        .from("promo_bookings")
        .select("id, created_at, full_name, seat_number, start_at, end_at, area, status")
        .gte("start_at", dayStartIso)
        .lte("start_at", dayEndIso);

      const [{ data: sessions, error: sErr }, { data: promos, error: pErr }] =
        await Promise.all([sessionsReq, promosReq]);

      if (sErr) console.error("day sessions error:", sErr.message);
      if (pErr) console.error("day promos error:", pErr.message);

      const walkIns: DayItem[] = [];
      const reservations: DayItem[] = [];

      // ✅ sessions -> decide kind based on your rule
      (sessions ?? []).forEach((s: CustomerSessionRow) => {
        const ctype = String(s.customer_type ?? "").trim().toLowerCase();
        if (ctype === "promo") return;

        const kind: DayKind =
          s.reservation === "yes" && s.reservation_date === dayKey
            ? "reservation"
            : s.date === dayKey
            ? "walkIn"
            : "walkIn";

        const item: DayItem = {
          kind,
          source: "session",
          id: s.id,
          full_name: normalizeName(s.full_name),
          booked_at: s.created_at ?? null,
          time_in: s.time_started ?? null,
          time_out: s.time_ended ?? null,
          seat: s.seat_number ?? null,
        };

        if (kind === "walkIn") walkIns.push(item);
        else reservations.push(item);
      });

      // ✅ promos -> apply SAME logic as calendar counts
      const now = new Date();
      const todayKey = yyyyMmDdLocal(now);
      const todayStart = startOfDayLocal(now);
      const todayEnd = endOfDayLocal(now);

      (promos ?? []).forEach((p: PromoBookingRow) => {
        const start = new Date(p.start_at);
        if (!Number.isFinite(start.getTime())) return;

        const pKey = yyyyMmDdLocal(start);
        if (pKey !== dayKey) return;

        let kind: DayKind = "reservation";

        if (p.area === "common_area") {
          if (dayKey === todayKey) {
            const isToday = start >= todayStart && start <= todayEnd;
            if (isToday && start <= now) kind = "walkIn";
            else kind = "reservation";
          } else {
            // not today: treat as reservation (since "already started" rule is only for today)
            kind = "reservation";
          }
        } else if (p.area === "conference_room") {
          kind = "reservation";
        } else {
          kind = "reservation";
        }

        const item: DayItem = {
          kind,
          source: "promo",
          id: p.id,
          full_name: normalizeName(p.full_name),
          booked_at: p.created_at ?? null,
          time_in: p.start_at ?? null,
          time_out: p.end_at ?? null,
          seat: p.seat_number ?? null,
          area: p.area,
          status: p.status ?? null,
        };

        if (kind === "walkIn") walkIns.push(item);
        else reservations.push(item);
      });

      // Sort nicely (time_in)
      const byTime = (a: DayItem, b: DayItem): number => {
        const ta = safeDate(a.time_in)?.getTime() ?? 0;
        const tb = safeDate(b.time_in)?.getTime() ?? 0;
        return ta - tb;
      };

      walkIns.sort(byTime);
      reservations.sort(byTime);

      setDayWalkIns(walkIns);
      setDayReservations(reservations);
    } finally {
      setDayLoading(false);
    }
  };

  const tileContent = ({ date, view }: TileArgs): React.ReactNode => {
    if (view !== "month") return null;

    const key = yyyyMmDdLocal(date);
    const data = counts[key];
    if (!data) return null;

    const showRes = data.reservation > 0;
    const showWalk = data.walkIn > 0;
    if (!showRes && !showWalk) return null;

    return (
      <>
        {showRes && (
          <div
            className="cal-icon-wrap cal-reservation"
            title={`Reservation: ${data.reservation}`}
          >
            <img src={reservationIcon} alt="Reservation" />
            <span className="cal-count">{data.reservation}</span>
          </div>
        )}

        {showWalk && (
          <div className="cal-icon-wrap cal-walkin" title={`Walk-in: ${data.walkIn}`}>
            <img src={walkInIcon} alt="Walk-in" />
            <span className="cal-count">{data.walkIn}</span>
          </div>
        )}
      </>
    );
  };

  const selectedKey = useMemo(() => yyyyMmDdLocal(selectedDate), [selectedDate]);

  const openDayModal = (d: Date): void => {
    setSelectedDate(d);
    setIsModalOpen(true);
    void loadDayDetails(d);
  };

  return (
    <IonPage>
      {/* ✅ keep your app background consistent */}
      <IonContent className="staff-content" scrollY={false}>
        <div className="customer-calendar-page customer-calendar-decor">
          {/* ✅ s.png OUTSIDE card */}
          <img className="customer-calendar-s" src={sDecor} alt="Decor" />

          <div className="customer-calendar-card">
            <div className="calendar-topbar">
              <h2 className="calendar-title">Customer Calendar</h2>

              <div className="calendar-topbar-right">
                <button
                  className="receipt-btn"
                  onClick={() => void loadCalendar()}
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>

                <div className="calendar-updated">
                  Updated: <strong>{lastUpdated || "—"}</strong>
                </div>
              </div>
            </div>

            <div className="calendar-legend">
              <div className="legend-row">
                <img src={reservationIcon} className="legend-icon" alt="Reservation" />
                <span>
                  <strong>Reservation</strong> — future bookings & conference room
                </span>
              </div>

              <div className="legend-row">
                <img src={walkInIcon} className="legend-icon" alt="Walk-in" />
                <span>
                  <strong>Walk-in</strong> — already started today
                </span>
              </div>
            </div>

            <div className="calendar-wrap">
              <Calendar
                tileContent={tileContent}
                showNeighboringMonth={false}
                showFixedNumberOfWeeks={false}
                locale="en-US"
                onClickDay={(value: Date) => openDayModal(value)}
              />
            </div>
          </div>
        </div>

        {/* ✅ DAY DETAILS MODAL */}
        <IonModal
          isOpen={isModalOpen}
          onDidDismiss={() => setIsModalOpen(false)}
          className="calendar-day-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>
                {selectedKey} • Details
              </IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setIsModalOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="calendar-day-modal-content">
            <div className="calendar-day-top">
              <IonButton
                className="receipt-btn"
                onClick={() => void loadDayDetails(selectedDate)}
                disabled={dayLoading}
              >
                {dayLoading ? "Loading..." : "Refresh Day"}
              </IonButton>
            </div>

            {dayLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                <IonSpinner name="crescent" />
              </div>
            ) : (
              <div className="calendar-day-sections">
                {/* RESERVATIONS */}
                <div className="calendar-day-section">
                  <div className="calendar-day-section-head">
                    <img src={reservationIcon} className="legend-icon" alt="Reservation" />
                    <h3 className="calendar-day-section-title">
                      Reservations ({dayReservations.length})
                    </h3>
                  </div>

                  {dayReservations.length === 0 ? (
                    <div className="calendar-day-empty">No reservations.</div>
                  ) : (
                    <div className="calendar-day-list">
                      {dayReservations.map((it) => (
                        <div key={`${it.source}-${it.id}`} className="calendar-day-item">
                          <div className="calendar-day-item-name">{it.full_name}</div>

                          <div className="calendar-day-item-meta">
                            <div>
                              <strong>Booked:</strong> {fmtDateTime(it.booked_at)}
                            </div>
                            <div>
                              <strong>Time In:</strong> {fmtTimeOnly(it.time_in)}{" "}
                              <span style={{ opacity: 0.7 }}>•</span>{" "}
                              <strong>Time Out:</strong> {fmtTimeOnly(it.time_out)}
                            </div>
                            <div>
                              <strong>Seat:</strong> {it.seat ?? "—"}
                            </div>

                            {it.source === "promo" && (
                              <div>
                                <strong>Area:</strong> {String(it.area ?? "—")}{" "}
                                <span style={{ opacity: 0.7 }}>•</span>{" "}
                                <strong>Status:</strong> {String(it.status ?? "—")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* WALK-INS */}
                <div className="calendar-day-section">
                  <div className="calendar-day-section-head">
                    <img src={walkInIcon} className="legend-icon" alt="Walk-in" />
                    <h3 className="calendar-day-section-title">
                      Walk-ins ({dayWalkIns.length})
                    </h3>
                  </div>

                  {dayWalkIns.length === 0 ? (
                    <div className="calendar-day-empty">No walk-ins.</div>
                  ) : (
                    <div className="calendar-day-list">
                      {dayWalkIns.map((it) => (
                        <div key={`${it.source}-${it.id}`} className="calendar-day-item">
                          <div className="calendar-day-item-name">{it.full_name}</div>

                          <div className="calendar-day-item-meta">
                            <div>
                              <strong>Booked:</strong> {fmtDateTime(it.booked_at)}
                            </div>
                            <div>
                              <strong>Time In:</strong> {fmtTimeOnly(it.time_in)}{" "}
                              <span style={{ opacity: 0.7 }}>•</span>{" "}
                              <strong>Time Out:</strong> {fmtTimeOnly(it.time_out)}
                            </div>
                            <div>
                              <strong>Seat:</strong> {it.seat ?? "—"}
                            </div>

                            {it.source === "promo" && (
                              <div>
                                <strong>Area:</strong> {String(it.area ?? "—")}{" "}
                                <span style={{ opacity: 0.7 }}>•</span>{" "}
                                <strong>Status:</strong> {String(it.status ?? "—")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Calendar;
