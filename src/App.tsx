// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonApp, IonRouterOutlet, setupIonicReact } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Route, Redirect } from "react-router-dom";

/* Pages */
import Login from "./pages/Login";
import Home from "./pages/Home";
import Staff_menu from "./staff/Staff_menu";
import Admin_menu from "./admin/Admin_menu";
import Book_Add from "./pages/Book_Add";
import Seat_Map from "./pages/Seat_Map";
import Add_Ons from "./pages/Add_Ons";

/* Components */
import TimeAlertModal from "./components/TimeAlertModal";

/* Supabase */
import { supabase } from "./utils/supabaseClient";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";

/* CSS */
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
import "@ionic/react/css/padding.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";
import "@ionic/react/css/palettes/dark.system.css";
import "./theme/variables.css";
import "./global.css";

setupIonicReact();

/* 🔔 ALERT TIMES */
const ALERT_MINUTES: number[] = [5, 3, 1];

const getRole = (): string => (localStorage.getItem("role") || "").toLowerCase();

const seatText = (seat: string | string[] | null | undefined): string => {
  if (Array.isArray(seat)) return seat.join(", ");
  return seat ?? "";
};

/** ✅ 4:59 => 5 minutes left */
const minutesLeftCeil = (endIso: string): number => {
  const end = new Date(endIso).getTime();
  const now = Date.now();
  const ms = end - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60000);
};

/* =========================
   DB TYPES (MATCH YOUR DB)
========================= */

// ✅ customer_sessions (walk-in / reservation / promo-link)
type CustomerSessionRow = {
  id: string;
  created_at: string | null;
  full_name: string;
  seat_number: string | string[] | null;

  // ✅ YOUR DB COLUMN
  time_ended: string | null;

  // ✅ yes/no
  reservation: string; // "yes" | "no"

  // ✅ promo link
  promo_booking_id: string | null;
};

// ✅ promo_bookings (extra safety)
type PromoBookingRow = {
  id: string;
  created_at: string;
  full_name: string;

  area: "common_area" | "conference_room";
  seat_number: string | null;

  start_at: string;
  end_at: string;

  status: string;
};

type AlertItem = {
  id: string;
  kind: "walkin" | "reservation" | "promo";
  full_name: string;
  seat_number: string;
  end_iso: string;
};

const kindLabel = (k: AlertItem["kind"]): string => {
  if (k === "walkin") return "WALK-IN";
  if (k === "reservation") return "RESERVATION";
  return "PROMO / MEMBERSHIP";
};

const App: React.FC = () => {
  const [showAlert, setShowAlert] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string>("");

  const [role, setRole] = useState<string>(getRole());
  const isStaff = useMemo(() => role === "staff", [role]);

  // prevent duplicates: "<kind>-<id>-<minute>"
  const triggeredRef = useRef<Set<string>>(new Set());

  // keep latest rows in memory
  const sessionsRef = useRef<Map<string, CustomerSessionRow>>(new Map());
  const promosRef = useRef<Map<string, PromoBookingRow>>(new Map());

  useEffect(() => {
    const id = window.setInterval(() => setRole(getRole()), 800);
    return () => window.clearInterval(id);
  }, []);

  const fireAlert = (item: AlertItem): void => {
    const mLeft = minutesLeftCeil(item.end_iso);
    if (!ALERT_MINUTES.includes(mLeft)) return;

    const key = `${item.kind}-${item.id}-${mLeft}`;
    if (triggeredRef.current.has(key)) return;
    triggeredRef.current.add(key);

    setAlertMessage(`
      <h2>⏰ ${mLeft} MINUTE(S) LEFT</h2>
      <p>
        <strong>Type:</strong> ${kindLabel(item.kind)}<br/>
        <strong>Customer:</strong> ${item.full_name}<br/>
        <strong>Seat:</strong> ${item.seat_number || "-"}
      </p>
    `);

    setShowAlert(true);
  };

  const tickCheckAll = (): void => {
    const now = Date.now();

    // customer_sessions
    Array.from(sessionsRef.current.values()).forEach((s) => {
      const endIso = s.time_ended;
      if (!endIso) return;

      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(endMs) || endMs <= now) {
        sessionsRef.current.delete(s.id);
        return;
      }

      const kind: AlertItem["kind"] =
        s.promo_booking_id
          ? "promo"
          : String(s.reservation ?? "").toLowerCase() === "yes"
          ? "reservation"
          : "walkin";

      fireAlert({
        id: s.id,
        kind,
        full_name: s.full_name,
        seat_number: seatText(s.seat_number),
        end_iso: endIso,
      });
    });

    // promo_bookings (extra safety)
    Array.from(promosRef.current.values()).forEach((p) => {
      const endMs = new Date(p.end_at).getTime();
      if (!Number.isFinite(endMs) || endMs <= now) {
        promosRef.current.delete(p.id);
        return;
      }

      fireAlert({
        id: p.id,
        kind: "promo",
        full_name: p.full_name,
        seat_number: p.area === "conference_room" ? "CONFERENCE ROOM" : (p.seat_number ?? "-"),
        end_iso: p.end_at,
      });
    });
  };

  const loadActiveCustomerSessions = async (): Promise<void> => {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("id, created_at, full_name, seat_number, time_ended, reservation, promo_booking_id")
      .not("time_ended", "is", null)
      .gt("time_ended", nowIso)
      .order("time_ended", { ascending: true })
      .limit(400);

    if (error || !data) {
      // optional debug:
      // console.log("loadActiveCustomerSessions error:", error?.message);
      return;
    }

    const rows = data as CustomerSessionRow[];
    const map = new Map<string, CustomerSessionRow>();
    rows.forEach((r) => map.set(r.id, r));
    sessionsRef.current = map;
  };

  const loadActivePromos = async (): Promise<void> => {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("promo_bookings")
      .select("id, created_at, full_name, seat_number, area, start_at, end_at, status")
      .gt("end_at", nowIso)
      .order("end_at", { ascending: true })
      .limit(400);

    if (error || !data) {
      // optional debug:
      // console.log("loadActivePromos error:", error?.message);
      return;
    }

    const rows = data as PromoBookingRow[];
    const map = new Map<string, PromoBookingRow>();
    rows.forEach((r) => map.set(r.id, r));
    promosRef.current = map;
  };

  useEffect(() => {
    if (!isStaff) {
      setShowAlert(false);
      triggeredRef.current.clear();
      sessionsRef.current.clear();
      promosRef.current.clear();
      return;
    }

    // ✅ initial load then immediate check
    (async () => {
      await loadActiveCustomerSessions();
      await loadActivePromos();
      tickCheckAll();
    })();

    // ✅ realtime: customer_sessions
    const chSessions = supabase
      .channel("rt_customer_sessions_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_sessions" },
        (payload: RealtimePostgresInsertPayload<CustomerSessionRow>) => {
          const row = payload.new;
          if (!row?.id) return;
          sessionsRef.current.set(row.id, row);
          tickCheckAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customer_sessions" },
        (payload: RealtimePostgresUpdatePayload<CustomerSessionRow>) => {
          const row = payload.new;
          if (!row?.id) return;
          sessionsRef.current.set(row.id, row);
          tickCheckAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "customer_sessions" },
        (payload: RealtimePostgresDeletePayload<CustomerSessionRow>) => {
          const oldRow = payload.old;
          if (oldRow?.id) sessionsRef.current.delete(oldRow.id);
        }
      )
      .subscribe();

    // ✅ realtime: promo_bookings
    const chPromos = supabase
      .channel("rt_promo_bookings_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "promo_bookings" },
        (payload: RealtimePostgresInsertPayload<PromoBookingRow>) => {
          const row = payload.new;
          if (!row?.id) return;
          promosRef.current.set(row.id, row);
          tickCheckAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "promo_bookings" },
        (payload: RealtimePostgresUpdatePayload<PromoBookingRow>) => {
          const row = payload.new;
          if (!row?.id) return;
          promosRef.current.set(row.id, row);
          tickCheckAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "promo_bookings" },
        (payload: RealtimePostgresDeletePayload<PromoBookingRow>) => {
          const oldRow = payload.old;
          if (oldRow?.id) promosRef.current.delete(oldRow.id);
        }
      )
      .subscribe();

    // ✅ tick every 2s (no skip)
    const tick = window.setInterval(() => {
      tickCheckAll();
    }, 2000);

    // ✅ refresh on focus/visible
    const refresh = (): void => {
      void loadActiveCustomerSessions();
      void loadActivePromos();
      window.setTimeout(() => tickCheckAll(), 150);
    };

    const onVis = (): void => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVis);
      void supabase.removeChannel(chSessions);
      void supabase.removeChannel(chPromos);
    };
  }, [isStaff]);

  return (
    <IonApp>
      <TimeAlertModal
        isOpen={showAlert}
        message={alertMessage}
        onClose={() => setShowAlert(false)}
        role={role}
      />

      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/add_ons" component={Add_Ons} />
          <Route exact path="/book-add" component={Book_Add} />
          <Route exact path="/seat_map" component={Seat_Map} />
          <Route exact path="/login" component={Login} />
          <Route exact path="/staff-menu" component={Staff_menu} />
          <Route exact path="/admin-menu" component={Admin_menu} />
          <Route exact path="/home" component={Home} />

          <Route exact path="/">
            <Redirect to="/book-add" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
