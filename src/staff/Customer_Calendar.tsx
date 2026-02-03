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

import React, { useEffect, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { supabase } from "../utils/supabaseClient";

// swapped icons
import walkInIcon from "../assets/customer_reservation.png";
import reservationIcon from "../assets/customer.png";

// ✅ decor
import sDecor from "../assets/s.png";

type Area = "common_area" | "conference_room" | string;

interface CustomerSessionRow {
  date: string; // yyyy-mm-dd
  reservation: string; // "yes" | "no"
  reservation_date: string | null; // yyyy-mm-dd
  customer_type?: string | null;
}

interface PromoBookingRow {
  start_at: string; // ISO
  area: Area;
  status: string;
}

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

const Customer_Calendar: React.FC = () => {
  const [counts, setCounts] = useState<CountMap>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

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
        .select("date, reservation, reservation_date, customer_type");

      const promosReq = supabase
        .from("promo_bookings")
        .select("start_at, area, status");

      const [{ data: sessions, error: sErr }, { data: promos, error: pErr }] =
        await Promise.all([sessionsReq, promosReq]);

      if (sErr) console.error("customer_sessions error:", sErr.message);
      if (pErr) console.error("promo_bookings error:", pErr.message);

      const result: CountMap = {};

      // ✅ sessions (ignore promo)
      (sessions ?? []).forEach((s: CustomerSessionRow) => {
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

      (promos ?? []).forEach((p: PromoBookingRow) => {
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
          <div className="cal-icon-wrap cal-reservation" title={`Reservation: ${data.reservation}`}>
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
                <button className="receipt-btn" onClick={() => void loadCalendar()} disabled={loading}>
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
              />
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Calendar;
