// src/pages/Customer_Calendar.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ Shows counts (numbers) on icons
// ✅ Reservation = TOP-LEFT (with count)
// ✅ Walk-in     = BOTTOM-RIGHT (with count)
// ✅ Removes blue tap highlight (keeps yellow current date)
// ✅ customer_sessions + promo_bookings logic
// ✅ FIX: hides neighboring month days (no 26–31 / no extra "1")
// ✅ FIX: Sunday-first calendar

import React, { useEffect, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { supabase } from "../utils/supabaseClient";

// swapped icons
import walkInIcon from "../assets/customer_reservation.png";
import reservationIcon from "../assets/customer.png";

type Area = "common_area" | "conference_room" | string;

interface CustomerSessionRow {
  date: string; // yyyy-mm-dd
  reservation: string; // "yes" | "no"
  reservation_date: string | null; // yyyy-mm-dd
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

type TileArgs = {
  date: Date;
  view: "month" | "year" | "decade" | "century";
};

const Customer_Calendar: React.FC = () => {
  const [counts, setCounts] = useState<CountMap>({});

  useEffect(() => {
    void loadCalendar();
  }, []);

  const loadCalendar = async (): Promise<void> => {
    const sessionsReq = supabase
      .from("customer_sessions")
      .select("date, reservation, reservation_date");

    const promosReq = supabase.from("promo_bookings").select("start_at, area, status");

    const [{ data: sessions, error: sErr }, { data: promos, error: pErr }] =
      await Promise.all([sessionsReq, promosReq]);

    if (sErr) console.error("customer_sessions error:", sErr.message);
    if (pErr) console.error("promo_bookings error:", pErr.message);

    const result: CountMap = {};

    // customer_sessions
    (sessions ?? []).forEach((s: CustomerSessionRow) => {
      if (s.reservation === "yes" && s.reservation_date) {
        addCount(result, s.reservation_date, "reservation");
      } else {
        addCount(result, s.date, "walkIn");
      }
    });

    // promo_bookings
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
        {/* Reservation (top-left) with number */}
        {showRes && (
          <div
            className="cal-icon-wrap cal-reservation"
            title={`Reservation: ${data.reservation}`}
          >
            <img src={reservationIcon} alt="Reservation" />
            <span className="cal-count">{data.reservation}</span>
          </div>
        )}

        {/* Walk-in (bottom-right) with number */}
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
    <div className="customer-calendar-page">
      <div className="customer-calendar-card">
        <h2 className="calendar-title">Customer Calendar</h2>

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
  );
};

export default Customer_Calendar;
