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

const minutesLeftCeil = (endIso: string): number => {
  const end = new Date(endIso).getTime();
  const now = Date.now();
  const ms = end - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60000);
};

const seatText = (seat: string | string[] | null | undefined): string => {
  if (Array.isArray(seat)) return seat.join(", ");
  return seat ?? "";
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toNum = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

type ProfileRow = {
  role: string | null;
};

type CustomerSessionRow = {
  id: string;
  created_at: string | null;
  full_name: string;
  seat_number: string | string[] | null;
  time_ended: string | null;
  reservation: string;
  promo_booking_id: string | null;
};

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

type AlertKind = "walkin" | "reservation" | "promo";

type AlertItem = {
  key: string;
  kind: AlertKind;
  id: string;
  full_name: string;
  seat_number: string;
  minutes_left: number;
  end_iso: string;
};

type OrderAlertKind = "add_ons" | "consignment";

type OrderAlertLine = {
  name: string;
  quantity: number;
  size: string;
  category: string;
};

type OrderAlertItem = {
  key: string;
  kind: OrderAlertKind;
  id: string;
  full_name: string;
  seat_number: string;
  created_at: string;
  lines: OrderAlertLine[];
};

type AddOnCatalogRow = {
  name?: string | null;
  category?: string | null;
  size?: string | null;
};

type ConsignmentCatalogRow = {
  item_name?: string | null;
  category?: string | null;
  size?: string | null;
};

type AddOnOrderItemRow = {
  quantity?: number | string | null;
  price?: number | string | null;
  add_ons?: AddOnCatalogRow | AddOnCatalogRow[] | null;
};

type ConsignmentOrderItemRow = {
  quantity?: number | string | null;
  price?: number | string | null;
  consignment?: ConsignmentCatalogRow | ConsignmentCatalogRow[] | null;
};

type AddOnOrderRow = {
  id: string;
  full_name: string | null;
  seat_number: string | null;
  created_at: string | null;
  addon_order_items?: AddOnOrderItemRow[] | null;
};

type ConsignmentOrderRow = {
  id: string;
  full_name: string | null;
  seat_number: string | null;
  created_at: string | null;
  consignment_order_items?: ConsignmentOrderItemRow[] | null;
};

const getRoleLocal = (): string =>
  (localStorage.getItem("role") || "").toLowerCase();

const firstObj = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
};

const App: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [orderAlerts, setOrderAlerts] = useState<OrderAlertItem[]>([]);
  const [showAlert, setShowAlert] = useState<boolean>(false);

  const [role, setRole] = useState<string>(getRoleLocal());
  const isStaff = useMemo(() => role === "staff", [role]);

  const triggeredRef = useRef<Set<string>>(new Set());
  const orderTriggeredRef = useRef<Set<string>>(new Set());

  const sessionsRef = useRef<Map<string, CustomerSessionRow>>(new Map());
  const promosRef = useRef<Map<string, PromoBookingRow>>(new Map());

  const syncRoleFromSupabase = async (): Promise<void> => {
    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;

    if (!user?.id) {
      localStorage.removeItem("role");
      setRole("");
      return;
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (error) {
      setRole(getRoleLocal());
      return;
    }

    const r = (profile?.role || "").toLowerCase();
    localStorage.setItem("role", r);
    setRole(r);
  };

  useEffect(() => {
    void syncRoleFromSupabase();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void syncRoleFromSupabase();
    });

    const onStorage = (e: StorageEvent): void => {
      if (e.key === "role") setRole(getRoleLocal());
    };

    window.addEventListener("storage", onStorage);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const addAlert = (a: AlertItem): void => {
    setAlerts((prev) => {
      if (prev.some((x) => x.key === a.key)) return prev;
      return [...prev, a].sort((x, y) => x.minutes_left - y.minutes_left);
    });

    setShowAlert(true);
  };

  const addOrderAlert = (a: OrderAlertItem): void => {
    setOrderAlerts((prev) => {
      if (prev.some((x) => x.key === a.key)) return prev;
      return [a, ...prev];
    });

    setShowAlert(true);
  };

  const fireAlert = (
    kind: AlertKind,
    id: string,
    full_name: string,
    seat_number: string,
    end_iso: string
  ): void => {
    const mLeft = minutesLeftCeil(end_iso);
    if (!ALERT_MINUTES.includes(mLeft)) return;

    const key = `${kind}-${id}-${mLeft}`;
    if (triggeredRef.current.has(key)) return;
    triggeredRef.current.add(key);

    addAlert({
      key,
      kind,
      id,
      full_name,
      seat_number,
      minutes_left: mLeft,
      end_iso,
    });
  };

  const buildAddOnLines = (rows: AddOnOrderItemRow[] | null | undefined): OrderAlertLine[] => {
    return (rows ?? [])
      .map((row) => {
        const catalog = firstObj(row.add_ons);
        const name = asString(catalog?.name).trim() || "Add-on Item";
        const quantity = Math.max(1, Math.floor(toNum(row.quantity)));
        const size = asString(catalog?.size).trim();
        const category = asString(catalog?.category).trim();
        return { name, quantity, size, category };
      })
      .filter((line) => line.name.trim().length > 0);
  };

  const buildConsignmentLines = (
    rows: ConsignmentOrderItemRow[] | null | undefined
  ): OrderAlertLine[] => {
    return (rows ?? [])
      .map((row) => {
        const catalog = firstObj(row.consignment);
        const name = asString(catalog?.item_name).trim() || "Consignment Item";
        const quantity = Math.max(1, Math.floor(toNum(row.quantity)));
        const size = asString(catalog?.size).trim();
        const category = asString(catalog?.category).trim();
        return { name, quantity, size, category };
      })
      .filter((line) => line.name.trim().length > 0);
  };

  const fetchAddOnOrderAlert = async (orderId: string): Promise<void> => {
    const key = `add_ons-${orderId}`;
    if (orderTriggeredRef.current.has(key)) return;

    const { data, error } = await supabase
      .from("addon_orders")
      .select(
        `
          id,
          full_name,
          seat_number,
          created_at,
          addon_order_items (
            quantity,
            price,
            add_ons (
              name,
              category,
              size
            )
          )
        `
      )
      .eq("id", orderId)
      .maybeSingle<AddOnOrderRow>();

    if (error || !data?.id) return;

    const lines = buildAddOnLines(data.addon_order_items);
    if (lines.length === 0) return;

    orderTriggeredRef.current.add(key);

    addOrderAlert({
      key,
      kind: "add_ons",
      id: data.id,
      full_name: asString(data.full_name).trim() || "Unknown Customer",
      seat_number: asString(data.seat_number).trim() || "-",
      created_at: asString(data.created_at),
      lines,
    });
  };

  const fetchConsignmentOrderAlert = async (orderId: string): Promise<void> => {
    const key = `consignment-${orderId}`;
    if (orderTriggeredRef.current.has(key)) return;

    const { data, error } = await supabase
      .from("consignment_orders")
      .select(
        `
          id,
          full_name,
          seat_number,
          created_at,
          consignment_order_items (
            quantity,
            price,
            consignment (
              item_name,
              category,
              size
            )
          )
        `
      )
      .eq("id", orderId)
      .maybeSingle<ConsignmentOrderRow>();

    if (error || !data?.id) return;

    const lines = buildConsignmentLines(data.consignment_order_items);
    if (lines.length === 0) return;

    orderTriggeredRef.current.add(key);

    addOrderAlert({
      key,
      kind: "consignment",
      id: data.id,
      full_name: asString(data.full_name).trim() || "Unknown Customer",
      seat_number: asString(data.seat_number).trim() || "-",
      created_at: asString(data.created_at),
      lines,
    });
  };

  const tickCheckAll = (): void => {
    const now = Date.now();

    Array.from(sessionsRef.current.values()).forEach((s) => {
      const endIso = s.time_ended;
      if (!endIso) return;

      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(endMs) || endMs <= now) {
        sessionsRef.current.delete(s.id);
        return;
      }

      const kind: AlertKind = s.promo_booking_id
        ? "promo"
        : String(s.reservation ?? "").toLowerCase() === "yes"
        ? "reservation"
        : "walkin";

      fireAlert(kind, s.id, s.full_name, seatText(s.seat_number), endIso);
    });

    Array.from(promosRef.current.values()).forEach((p) => {
      const endMs = new Date(p.end_at).getTime();
      if (!Number.isFinite(endMs) || endMs <= now) {
        promosRef.current.delete(p.id);
        return;
      }

      const seat =
        p.area === "conference_room" ? "CONFERENCE ROOM" : p.seat_number ?? "-";

      fireAlert("promo", p.id, p.full_name, seat, p.end_at);
    });
  };

  const loadActiveCustomerSessions = async (): Promise<void> => {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("customer_sessions")
      .select(
        "id, created_at, full_name, seat_number, time_ended, reservation, promo_booking_id"
      )
      .not("time_ended", "is", null)
      .gt("time_ended", nowIso)
      .order("time_ended", { ascending: true })
      .limit(400);

    if (error || !data) return;

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

    if (error || !data) return;

    const rows = data as PromoBookingRow[];
    const map = new Map<string, PromoBookingRow>();
    rows.forEach((r) => map.set(r.id, r));
    promosRef.current = map;
  };

  useEffect(() => {
    if (!isStaff) {
      setShowAlert(false);
      setAlerts([]);
      setOrderAlerts([]);
      triggeredRef.current.clear();
      orderTriggeredRef.current.clear();
      sessionsRef.current.clear();
      promosRef.current.clear();
      return;
    }

    let alive = true;

    (async () => {
      await loadActiveCustomerSessions();
      await loadActivePromos();
      if (alive) tickCheckAll();
    })();

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

    const chAddOnOrders = supabase
      .channel("rt_addon_orders_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "addon_orders" },
        (payload: RealtimePostgresInsertPayload<{ id: string }>) => {
          const row = payload.new;
          if (!row?.id) return;
          void fetchAddOnOrderAlert(row.id);
        }
      )
      .subscribe();

    const chConsignmentOrders = supabase
      .channel("rt_consignment_orders_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "consignment_orders" },
        (payload: RealtimePostgresInsertPayload<{ id: string }>) => {
          const row = payload.new;
          if (!row?.id) return;
          void fetchConsignmentOrderAlert(row.id);
        }
      )
      .subscribe();

    const tick = window.setInterval(() => tickCheckAll(), 1000);

    const refresh = (): void => {
      void loadActiveCustomerSessions();
      void loadActivePromos();
      window.setTimeout(() => tickCheckAll(), 200);
    };

    const onVis = (): void => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;

      window.clearInterval(tick);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVis);

      void supabase.removeChannel(chSessions);
      void supabase.removeChannel(chPromos);
      void supabase.removeChannel(chAddOnOrders);
      void supabase.removeChannel(chConsignmentOrders);
    };
  }, [isStaff]);

  const stopOne = (key: string): void => {
    setAlerts((prev) => prev.filter((x) => x.key !== key));
    setOrderAlerts((prev) => prev.filter((x) => x.key !== key));

    window.setTimeout(() => {
      setAlerts((currentTimeAlerts) => {
        setOrderAlerts((currentOrderAlerts) => {
          if (currentTimeAlerts.length === 0 && currentOrderAlerts.length === 0) {
            setShowAlert(false);
          }
          return currentOrderAlerts;
        });
        return currentTimeAlerts;
      });
    }, 0);
  };

  return (
    <IonApp>
      <TimeAlertModal
        isOpen={showAlert}
        role={role}
        alerts={alerts}
        orderAlerts={orderAlerts}
        onStopOne={stopOne}
        onClose={() => setShowAlert(false)}
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