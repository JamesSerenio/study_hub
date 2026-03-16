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

type PieName = "Walk-in" | "Reservation" | "Promo";

type PieRow = {
  name: PieName;
  value: number;
};

type LineRow = {
  day: string;
  total: number;
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
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" });
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
const PIE_COLORS: Record<PieName, string> = {
  "Walk-in": "#2f3b2f",
  Reservation: "#6a3fb5",
  Promo: "#c04b1a",
};

/**
 * ✅ Percent rule:
 * total = 1, part = 1 => 100%
 */
const pct = (part: number, total: number): number => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
};

const formatPct = (n: number): string => {
  if (!Number.isFinite(n)) return "0%";
  const rounded1 = Math.round(n * 10) / 10;
  const isInt = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;
  return `${isInt ? Math.round(rounded1) : rounded1}%`;
};

const isPieName = (v: unknown): v is PieName => v === "Walk-in" || v === "Reservation" || v === "Promo";

/** ✅ Legend raw item shape (strict, no any) */
type LegendItemRaw = {
  value?: unknown;   // label
  color?: unknown;   // string
  payload?: unknown; // original item, contains value
};

const toLegendItems = (
  payload: unknown
): Array<{ name: PieName; color: string; value: number }> => {
  if (!Array.isArray(payload)) return [];

  const out: Array<{ name: PieName; color: string; value: number }> = [];

  for (const raw of payload) {
    if (typeof raw !== "object" || raw === null) continue;

    const item = raw as LegendItemRaw;
    const nameStr = String(item.value ?? "");
    if (!isPieName(nameStr)) continue;

    const color = typeof item.color === "string" ? item.color : PIE_COLORS[nameStr];

    let v = 0;
    if (typeof item.payload === "object" && item.payload !== null) {
      const p = item.payload as Record<string, unknown>;
      const pv = p.value;

      if (typeof pv === "number" && Number.isFinite(pv)) v = pv;
      else if (typeof pv === "string") {
        const n = Number(pv);
        if (Number.isFinite(n)) v = n;
      }
    }

    out.push({ name: nameStr, color, value: v });
  }

  return out;
};

/** ✅ Instead of LegendProps (no payload), use our own props type */
type LegendContentProps = { payload?: unknown };

const Admin_Dashboard: React.FC = () => {
  const todayYYYYMMDD = useMemo(() => toYYYYMMDD(new Date()), []);

  const [selectedDate, setSelectedDate] = useState<string>(todayYYYYMMDD);
  const [openCalendar, setOpenCalendar] = useState<boolean>(false);

  const [totals, setTotals] = useState<Totals>({
    walkin: 0,
    reservation: 0,
    promo: 0,
    all: 0,
  });

  const [pulseKey, setPulseKey] = useState<number>(0);

  const [weekSeries, setWeekSeries] = useState<LineRow[]>([]);
  const [weekLoading, setWeekLoading] = useState<boolean>(false);

  const prettyDate = useMemo(() => formatPretty(selectedDate), [selectedDate]);

  const weekStart = useMemo(() => addDaysYYYYMMDD(selectedDate, -6), [selectedDate]);
  const weekRangeLabel = useMemo(() => {
    const a = formatPretty(weekStart);
    const b = formatPretty(selectedDate);
    return `${a} – ${b}`;
  }, [weekStart, selectedDate]);

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

    const startOfDay = new Date(`${dateYYYYMMDD}T00:00:00`);
    const endOfDay = new Date(`${dateYYYYMMDD}T23:59:59`);

    const promoQ = supabase
      .from("promo_bookings")
      .select("id", { count: "exact", head: true })
      .gte("start_at", startOfDay.toISOString())
      .lte("start_at", endOfDay.toISOString());

    const [walkinRes, reservationRes, promoRes] = await Promise.all([walkinQ, reservationQ, promoQ]);

    const walkin = walkinRes.count ?? 0;
    const reservation = reservationRes.count ?? 0;
    const promo = promoRes.count ?? 0;

    return { walkin, reservation, promo, all: walkin + reservation + promo };
  };

  useEffect(() => {
    let alive = true;

    const run = async (): Promise<void> => {
      const t = await fetchTotalsForDate(selectedDate);
      if (!alive) return;
      setTotals(t);
      setPulseKey((k) => k + 1);

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

    void run();
    return () => {
      alive = false;
    };
  }, [selectedDate]);

  const pieData: PieRow[] = useMemo(
    () => [
      { name: "Walk-in", value: totals.walkin },
      { name: "Reservation", value: totals.reservation },
      { name: "Promo", value: totals.promo },
    ],
    [totals.walkin, totals.reservation, totals.promo]
  );

  const pieTotal = useMemo(() => totals.walkin + totals.reservation + totals.promo, [totals.walkin, totals.reservation, totals.promo]);

  // ✅ percentages for cards = share of TOTAL ALL
  const walkinPct = useMemo(() => formatPct(pct(totals.walkin, totals.all)), [totals.walkin, totals.all]);
  const reservePct = useMemo(() => formatPct(pct(totals.reservation, totals.all)), [totals.reservation, totals.all]);
  const promoPct = useMemo(() => formatPct(pct(totals.promo, totals.all)), [totals.promo, totals.all]);

  // ✅ custom legend (name + percent)
  const BreakdownLegend: React.FC<LegendContentProps> = ({ payload }) => {
    const items = toLegendItems(payload);

    if (items.length === 0 || pieTotal <= 0) return null;

    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 14,
          flexWrap: "wrap",
          padding: "6px 10px 12px",
        }}
      >
        {items.map((item) => {
          const percentText = formatPct(pct(item.value, pieTotal));

          return (
            <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: item.color,
                  display: "inline-block",
                }}
              />
              <span style={{ fontWeight: 800, fontSize: 13 }}>{item.name}</span>
              <span style={{ fontWeight: 800, fontSize: 13, opacity: 0.9 }}>{percentText}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <IonPage>
      <IonHeader>{/* keep your toolbar if meron ka */}</IonHeader>

      <IonContent className="admin-dash-content">
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
                style={{ position: "relative" }}
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

                <div style={{ position: "absolute", right: 14, top: 14, textAlign: "right", opacity: 0.95 }}>
                  <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1 }}>{walkinPct}</div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>of total</div>
                </div>
              </motion.div>

              {/* RESERVATION */}
              <motion.div
                className="dash-total-card dash-total-card--reserve"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.03 }}
                style={{ position: "relative" }}
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

                <div style={{ position: "absolute", right: 14, top: 14, textAlign: "right", opacity: 0.95 }}>
                  <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1 }}>{reservePct}</div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>of total</div>
                </div>
              </motion.div>

              {/* PROMO */}
              <motion.div
                className="dash-total-card dash-total-card--promo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.06 }}
                style={{ position: "relative" }}
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

                <div style={{ position: "absolute", right: 14, top: 14, textAlign: "right", opacity: 0.95 }}>
                  <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1 }}>{promoPct}</div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>of total</div>
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

                  <button type="button" className="dash-date-btn" onClick={() => setOpenCalendar(true)} title="Set date">
                    <img className="dash-date-icon" src={iconCalendar} alt="Calendar" />
                    <span className="dash-date-text">{prettyDate}</span>
                  </button>
                </div>
              </motion.div>
            </div>
          </div>

          {/* ✅ CHARTS GRID */}
          <div className="dash-charts-grid">
            {/* LEFT: LINE */}
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

            {/* RIGHT: PIE */}
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

                      <Tooltip
                        formatter={(value: unknown, name: unknown) => {
                          const v = typeof value === "number" ? value : Number(value);
                          const label = String(name);
                          const pv = Number.isFinite(v) ? v : 0;
                          const percentText = formatPct(pct(pv, pieTotal));
                          return [`${pv} (${percentText})`, label];
                        }}
                      />

                      {/* ✅ IMPORTANT: pass payload safely from legend */}
                      <Legend
                        verticalAlign="bottom"
                        content={(p) => {
                          const payload = (typeof p === "object" && p !== null ? (p as Record<string, unknown>).payload : undefined) as
                            | unknown
                            | undefined;
                          return <BreakdownLegend payload={payload} />;
                        }}
                      />
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

          {/* ✅ CALENDAR MODAL */}
          <IonModal isOpen={openCalendar} onDidDismiss={() => setOpenCalendar(false)} className="dash-calendar-modal">
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
                  if (typeof val === "string" && val.length >= 10) setSelectedDate(val.slice(0, 10));
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
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Dashboard;
