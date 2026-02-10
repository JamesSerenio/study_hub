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

type CustomerSessionRow = {
  id: string;
  full_name: string;
  seat_number: string | string[] | null;
  time_ended: string; // timestamptz ISO
};

const getRole = (): string => (localStorage.getItem("role") || "").toLowerCase();

const seatText = (seat: CustomerSessionRow["seat_number"]): string => {
  if (Array.isArray(seat)) return seat.join(", ");
  return seat ?? "";
};

const minuteDiff = (endIso: string, now: Date): number => {
  const end = new Date(endIso);
  const ms = end.getTime() - now.getTime();
  return Math.floor(ms / 60000);
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
    const id = window.setInterval(() => {
      setRole(getRole());
    }, 800);
    return () => window.clearInterval(id);
  }, []);

  const fireAlertIfNeeded = (session: CustomerSessionRow): void => {
    const now = new Date();
    const diffMinutes = minuteDiff(session.time_ended, now);

    if (!ALERT_MINUTES.includes(diffMinutes)) return;

    const key = `${session.id}-${diffMinutes}`;
    if (triggeredRef.current.has(key)) return;

    triggeredRef.current.add(key);

    setAlertMessage(`
      <h2>⏰ ${diffMinutes} MINUTE(S) LEFT</h2>
      <p>
        <strong>Customer:</strong> ${session.full_name}<br/>
        <strong>Seat:</strong> ${seatText(session.seat_number)}
      </p>
    `);

    setShowAlert(true);
  };

  const loadActiveSessions = async (): Promise<void> => {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("id, full_name, seat_number, time_ended")
      .gt("time_ended", nowIso);

    if (error || !data) return;

    const rows = data as CustomerSessionRow[];

    const map = new Map<string, CustomerSessionRow>();
    rows.forEach((r) => map.set(r.id, r));
    sessionsRef.current = map;

    // check immediately
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

    // initial load
    void loadActiveSessions();

    // ✅ realtime subscribe (NO status callback — fixes your error)
    const ch = supabase
      .channel("realtime_customer_sessions_time_ended")
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

          // if ended, remove
          if (new Date(row.time_ended).getTime() <= Date.now()) {
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

    // ✅ lightweight tick every 15s
    const tick = window.setInterval(() => {
      const now = new Date();

      const current = Array.from(sessionsRef.current.values());
      current.forEach((s) => {
        if (new Date(s.time_ended).getTime() <= now.getTime()) {
          sessionsRef.current.delete(s.id);
          return;
        }
        fireAlertIfNeeded(s);
      });
    }, 15000);

    // ✅ refresh on focus/visible
    const onFocus = (): void => {
      void loadActiveSessions();
    };

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
