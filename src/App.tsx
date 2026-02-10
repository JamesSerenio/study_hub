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

/**
 * ✅ IMPORTANT:
 * Sa system mo, end time = "time_out" (from Customer Lists screenshot).
 * If iba name mo, palitan mo lang ito.
 */
const END_COL = "time_out";

type CustomerSessionRow = {
  id: string;
  full_name: string;
  seat_number: string | string[] | null;

  // ✅ end time column (timestamptz)
  time_out: string | null;
};

const getRole = (): string => (localStorage.getItem("role") || "").toLowerCase();

const seatText = (seat: CustomerSessionRow["seat_number"]): string => {
  if (Array.isArray(seat)) return seat.join(", ");
  return seat ?? "";
};

/**
 * ✅ FIX:
 * Use CEIL so 4:59 => 5 minutes left
 */
const minutesLeftCeil = (endIso: string): number => {
  const end = new Date(endIso).getTime();
  const now = Date.now();
  const ms = end - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60000);
};

const App: React.FC = () => {
  const [showAlert, setShowAlert] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string>("");

  // ✅ staff guard
  const [role, setRole] = useState<string>(getRole());
  const isStaff = useMemo(() => role === "staff", [role]);

  /* avoid duplicate alerts: id-minute */
  const triggeredRef = useRef<Set<string>>(new Set());

  /* keep latest sessions in memory (staff only) */
  const sessionsRef = useRef<Map<string, CustomerSessionRow>>(new Map());

  // ✅ keep role updated if login changes localStorage role
  useEffect(() => {
    const id = window.setInterval(() => setRole(getRole()), 800);
    return () => window.clearInterval(id);
  }, []);

  const fireAlertIfNeeded = (session: CustomerSessionRow): void => {
    const endIso = session.time_out;
    if (!endIso) return;

    const mLeft = minutesLeftCeil(endIso);
    if (mLeft <= 0) return;
    if (!ALERT_MINUTES.includes(mLeft)) return;

    const key = `${session.id}-${mLeft}`;
    if (triggeredRef.current.has(key)) return;

    triggeredRef.current.add(key);

    setAlertMessage(`
      <h2>⏰ ${mLeft} MINUTE(S) LEFT</h2>
      <p>
        <strong>Customer:</strong> ${session.full_name}<br/>
        <strong>Seat:</strong> ${seatText(session.seat_number)}
      </p>
    `);

    setShowAlert(true);
  };

  const loadActiveSessions = async (): Promise<void> => {
    const nowIso = new Date().toISOString();

    // ✅ Only sessions that are still in the future
    // NOTE: If time_out can be null for OPEN sessions, we ignore those.
    const { data, error } = await supabase
      .from("customer_sessions")
      .select(`id, full_name, seat_number, ${END_COL}`)
      .not(END_COL, "is", null)
      .gt(END_COL, nowIso);

    if (error || !data) return;

    const rows = data as CustomerSessionRow[];

    const map = new Map<string, CustomerSessionRow>();
    rows.forEach((r) => map.set(r.id, r));
    sessionsRef.current = map;

    rows.forEach((r) => fireAlertIfNeeded(r));
  };

  /* ✅ REALTIME + LIGHT TICK (STAFF ONLY) */
  useEffect(() => {
    if (!isStaff) {
      setShowAlert(false);
      triggeredRef.current.clear();
      sessionsRef.current.clear();
      return;
    }

    void loadActiveSessions();

    const ch = supabase
      .channel("realtime_customer_sessions_end_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_sessions" },
        (payload: RealtimePostgresInsertPayload<CustomerSessionRow>) => {
          const row = payload.new;
          if (!row?.id) return;

          sessionsRef.current.set(row.id, row);
          fireAlertIfNeeded(row);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customer_sessions" },
        (payload: RealtimePostgresUpdatePayload<CustomerSessionRow>) => {
          const row = payload.new;
          if (!row?.id) return;

          sessionsRef.current.set(row.id, row);

          const endIso = row.time_out;
          if (!endIso) return;

          // remove if ended
          if (new Date(endIso).getTime() <= Date.now()) {
            sessionsRef.current.delete(row.id);
            return;
          }

          fireAlertIfNeeded(row);
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

    // ✅ tick every 10s to avoid skipping 5/3/1
    const tick = window.setInterval(() => {
      const now = Date.now();
      const list = Array.from(sessionsRef.current.values());

      list.forEach((s) => {
        const endIso = s.time_out;
        if (!endIso) return;

        if (new Date(endIso).getTime() <= now) {
          sessionsRef.current.delete(s.id);
          return;
        }

        fireAlertIfNeeded(s);
      });
    }, 10000);

    const onFocus = (): void => void loadActiveSessions();
    const onVis = (): void => {
      if (document.visibilityState === "visible") void loadActiveSessions();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      void supabase.removeChannel(ch);
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
