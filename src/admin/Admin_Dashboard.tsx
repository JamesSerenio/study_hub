// src/pages/Admin_Dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonHeader,
  IonModal,
  IonDatetime,
  IonButtons,
  IonButton,
  IonSpinner,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import { motion, AnimatePresence } from "framer-motion";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

// ✅ icons
import iconWalkin from "../assets/list.png";
import iconReserve from "../assets/reserve.png";
import iconPromo from "../assets/discount.png";
import iconAll from "../assets/all.png";
import iconCalendar from "../assets/calendar.png";

type Totals = {
  walkin: number;
  reservation: number;
  promo: number;
  all: number;
};

type PieRow = {
  name: "Walk-in" | "Reservation" | "Promo";
  value: number;
};

type LineRow = {
  day: string;   // label
  total: number; // total all
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

const toYYYYMMDD = (d: Date): string => {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
};

const toISODateForIon = (yyyyMmDd: string): string => yyyyMmDd;

const formatPretty = (yyyyMmDd: string): string => {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
};

const formatShort = (yyyyMmDd: string): string => {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
};

const addDaysYYYYMMDD = (yyyyMmDd: string, delta: number): string => {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toYYYYMMDD(dt);
};

// ✅ smooth framer presets
const cardSpring = {
  type: "spring" as const,
  stiffness: 180,
  damping: 18,
  mass: 0.9,
};

const numberSpring = {
  type: "spring" as const,
  stiffness: 260,
  damping: 20,
  mass: 0.6,
};

// ✅ chart colors (fixed)
const PIE_COLORS: Record<PieRow["name"], string> = {
  "Walk-in": "#2f3b2f",
  Reservation: "#6a3fb5",
  Promo: "#c04b1a",
};

const Admin_Dashboard: React.FC = () => {
  const todayYYYYMMDD = useMemo(() => toYYYYMMDD(new Date()), []);

  // ✅ selected date (used for: totals cards, pie chart, and week-ending for line chart)
  const [selectedDate, setSelectedDate] = useState<string>(todayYYYYMMDD);
  const [openCalendar, setOpenCalendar] = useState<boolean>(false);

  const [totals, setTotals] = useState<Totals>({
    walkin: 0,
    reservation: 0,
    promo: 0,
    all: 0,
  });

  const [pulseKey, setPulseKey] = useState<number>(0);

  // ✅ line chart data
  const [weekSeries, setWeekSeries] = useState<LineRow[]>([]);
  const [weekLoading, setWeekLoading] = useState<boolean>(false);

  const prettyDate = useMemo(() => formatPretty(selectedDate), [selectedDate]);

  const weekStart = useMemo(() => addDaysYYYYMMDD(selectedDate, -6), [selectedDate]);
  const weekRangeLabel = useMemo(() => {
    const a = formatPretty(weekStart);
    const b = formatPretty(selectedDate);
    return `${a} – ${b}`;
  }, [weekStart, selectedDate]);

  // --- shared fetch (for a single date) ---
  const fetchTotalsForDate = async (dateYYYYMMDD: string): Promise<Totals> => {
    const walkinQ = supabase
      .from("customer_sessions")
      .select("id", { count: "exact", head: true })
      .eq("date", dateYYYYMMDD)
      .eq("reservation", "no");

    const reservationQ = supabase
      .from("customer_sessions")
      .select("id", { count: "exact", head: true })
      .eq("date", dateYYYYMMDD)
      .eq("reservation", "yes");

    // Promo: by start_at day range
    const startOfDay = new Date(`${dateYYYYMMDD}T00:00:00`);
    const endOfDay = new Date(`${dateYYYYMMDD}T23:59:59`);

    const promoQ = supabase
      .from("promo_bookings")
      .select("id", { count: "exact", head: true })
      .gte("start_at", startOfDay.toISOString())
      .lte("start_at", endOfDay.toISOString());

    const [walkinRes, reservationRes, promoRes] = await Promise.all([
      walkinQ,
      reservationQ,
      promoQ,
    ]);

    const walkin = walkinRes.count ?? 0;
    const reservation = reservationRes.count ?? 0;
    const promo = promoRes.count ?? 0;

    return {
      walkin,
      reservation,
      promo,
      all: walkin + reservation + promo,
    };
  };

  // ✅ load totals for selected date + week series (7 days)
  useEffect(() => {
    let alive = true;

    const run = async (): Promise<void> => {
      // 1) cards + pie totals for the selected date
      const t = await fetchTotalsForDate(selectedDate);
      if (!alive) return;
      setTotals(t);
      setPulseKey((k) => k + 1);

      // 2) week series line chart (7 days ending selectedDate)
      setWeekLoading(true);
      const days: string[] = Array.from({ length: 7 }, (_, i) => addDaysYYYYMMDD(selectedDate, i - 6));

      try {
        const results = await Promise.all(
          days.map(async (d) => {
            const tt = await fetchTotalsForDate(d);
            return { day: formatShort(d), total: tt.all };
          })
        );

        if (!alive) return;
        setWeekSeries(results);
      } finally {
        if (alive) setWeekLoading(false);
      }
    };

    run();

    return () => {
      alive = false;
    };
  }, [selectedDate]);

  // ✅ pie data only (three categories)
  const pieData: PieRow[] = useMemo(
    () => [
      { name: "Walk-in", value: totals.walkin },
      { name: "Reservation", value: totals.reservation },
      { name: "Promo", value: totals.promo },
    ],
    [totals.walkin, totals.reservation, totals.promo]
  );

  const pieTotal = useMemo(
    () => totals.walkin + totals.reservation + totals.promo,
    [totals.walkin, totals.reservation, totals.promo]
  );

  return (
    <IonPage>
      <IonHeader>{/* keep your toolbar if meron ka */}</IonHeader>

      <IonContent className="admin-dash-content" scrollY={true}>
        <div className="dash-wrap">
          {/* ✅ TOTALS */}
          <div className="dash-totals-wrap">
            <div className="dash-totals-row">
              {/* WALKIN */}
              <motion.div
                className="dash-total-card dash-total-card--walkin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={cardSpring}
              >
                <img className="dash-total-icon" src={iconWalkin} alt="Walk-in" />
                <div className="dash-total-meta">
                  <div className="dash-total-label">Walk-in</div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={`walkin-${pulseKey}-${totals.walkin}`}
                      className="dash-total-value"
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.92, opacity: 0 }}
                      transition={numberSpring}
                    >
                      {totals.walkin}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* RESERVATION */}
              <motion.div
                className="dash-total-card dash-total-card--reserve"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.03 }}
              >
                <img className="dash-total-icon" src={iconReserve} alt="Reservation" />
                <div className="dash-total-meta">
                  <div className="dash-total-label">Reservation</div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={`reserve-${pulseKey}-${totals.reservation}`}
                      className="dash-total-value"
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.92, opacity: 0 }}
                      transition={numberSpring}
                    >
                      {totals.reservation}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* PROMO */}
              <motion.div
                className="dash-total-card dash-total-card--promo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.06 }}
              >
                <img className="dash-total-icon" src={iconPromo} alt="Promo" />
                <div className="dash-total-meta">
                  <div className="dash-total-label">Promo</div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={`promo-${pulseKey}-${totals.promo}`}
                      className="dash-total-value"
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.92, opacity: 0 }}
                      transition={numberSpring}
                    >
                      {totals.promo}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* TOTAL ALL + CALENDAR */}
              <motion.div
                className="dash-total-card dash-total-card--all"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.09 }}
              >
                <img className="dash-total-icon" src={iconAll} alt="All" />
                <div className="dash-total-meta dash-total-meta--all">
                  <div className="dash-total-label">Total All</div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={`all-${pulseKey}-${totals.all}`}
                      className="dash-total-value"
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.92, opacity: 0 }}
                      transition={numberSpring}
                    >
                      {totals.all}
                    </motion.div>
                  </AnimatePresence>

                  <button
                    type="button"
                    className="dash-date-btn"
                    onClick={() => setOpenCalendar(true)}
                    title="Set date"
                  >
                    <img className="dash-date-icon" src={iconCalendar} alt="Calendar" />
                    <span className="dash-date-text">{prettyDate}</span>
                  </button>
                </div>
              </motion.div>
            </div>
          </div>

          {/* ✅ CHARTS GRID (LEFT line / RIGHT pie) */}
          <div className="dash-charts-grid">
            {/* LEFT: LINE CHART (7 days total all) */}
            <motion.div
              className="dash-chart-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...cardSpring, delay: 0.12 }}
            >
              <div className="dash-chart-head">
                <div>
                  <div className="dash-chart-title">Total All (7 days)</div>
                  <div className="dash-chart-sub">{weekRangeLabel}</div>
                </div>

                <button
                  type="button"
                  className="dash-chart-datebtn"
                  onClick={() => setOpenCalendar(true)}
                  title="Set week ending date"
                >
                  <img className="dash-date-icon" src={iconCalendar} alt="Calendar" />
                  <span className="dash-date-text">Set Date</span>
                </button>
              </div>

              {weekLoading ? (
                <div className="dash-chart-loading">
                  <IonSpinner name="crescent" />
                  <div className="dash-chart-loading-text">Loading...</div>
                </div>
              ) : (
                <div className="dash-line-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={weekSeries} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#0f5a4a"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={true}
                        animationDuration={700}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>

            {/* RIGHT: PIE CHART */}
            <motion.div
              className="dash-chart-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...cardSpring, delay: 0.14 }}
            >
              <div className="dash-chart-head">
                <div className="dash-chart-title">Breakdown</div>
                <div className="dash-chart-sub">{prettyDate}</div>
              </div>

              {pieTotal <= 0 ? (
                <div className="dash-chart-empty">No data for this date.</div>
              ) : (
                <div className="dash-chart-body">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={62}
                        outerRadius={96}
                        paddingAngle={2}
                        isAnimationActive={true}
                        animationDuration={700}
                      >
                        {pieData.map((entry) => (
                          <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[entry.name]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={40} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="dash-chart-center">
                    <div className="dash-chart-center-label">Total</div>
                    <AnimatePresence mode="popLayout">
                      <motion.div
                        key={`pieTotal-${pulseKey}-${pieTotal}`}
                        className="dash-chart-center-value"
                        initial={{ scale: 0.92, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.92, opacity: 0 }}
                        transition={numberSpring}
                      >
                        {pieTotal}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>
          </div>

          {/* ✅ CALENDAR MODAL (affects both charts + totals) */}
          <IonModal
            isOpen={openCalendar}
            onDidDismiss={() => setOpenCalendar(false)}
            className="dash-calendar-modal"
          >
            <div className="dash-calendar-card">
              <div className="dash-calendar-head">
                <div className="dash-calendar-title">Select Date</div>
                <IonButtons>
                  <IonButton className="dash-calendar-close" onClick={() => setOpenCalendar(false)}>
                    Close
                  </IonButton>
                </IonButtons>
              </div>

              <IonDatetime
                className="dash-calendar-datetime"
                presentation="date"
                value={toISODateForIon(selectedDate)}
                onIonChange={(e) => {
                  const val = e.detail.value;
                  if (typeof val === "string" && val.length >= 10) {
                    setSelectedDate(val.slice(0, 10));
                  }
                }}
              />

              <div className="dash-calendar-actions">
                <IonButton className="dash-calendar-today" onClick={() => setSelectedDate(todayYYYYMMDD)}>
                  Today
                </IonButton>
                <IonButton className="dash-calendar-done" onClick={() => setOpenCalendar(false)}>
                  Done
                </IonButton>
              </div>
            </div>
          </IonModal>

          {/* ...rest of your dashboard */}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Dashboard;
