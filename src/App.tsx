import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonApp, IonRouterOutlet, setupIonicReact } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Route, Redirect } from "react-router-dom";
import type { RouteComponentProps } from "react-router-dom";

/* Pages */
import Login from "./pages/Login";
import Home from "./pages/Home";
import Book_Add from "./pages/Book_Add";

/* staff */
import StaffSalesReport from "./staff/staff_sales_report";
import Staff_menu from "./staff/Staff_menu";
import Staff_Dashboard from "./staff/Staff_Dashboard";
import Product_Item_Lists from "./staff/Product_Item_lists";
import Customer_Reservations from "./staff/Customer_Reservations";
import Customer_Lists from "./staff/Customer_Lists";
import Customer_Discount_List from "./staff/Customer_Discount_List";
import Customer_Calendar from "./staff/Customer_Calendar";
import Customer_Add_ons from "./staff/Customer_Add_ons";

/* admin */
import Admin_Add_Ons from "./admin/Admin_Add_Ons";
import Admin_Customer_Add_ons from "./admin/Admin_Customer_Add_ons";
import Admin_Customer_Discount_List from "./admin/Admin_Customer_Discount_List";
import Admin_customer_list from "./admin/Admin_customer_list";
import Admin_customer_reservation from "./admin/Admin_customer_reservation";
import Admin_Dashboard from "./admin/Admin_Dashboard";
import Admin_Item_Lists from "./admin/Admin_Item_Lists";
import Admin_menu from "./admin/Admin_menu";
import Admin_Packages from "./admin/Admin_Packages";
import Admin_Restock_Record from "./admin/Admin_Restock_Record";
import AdminSalesReport from "./admin/Admin_Sales_Report";
import Admin_Seat_Table from "./admin/Admin_Seat_Table";
import Admin_Staff_Expenses_Expired from "./admin/Admin_Staff_Expenses&Expired";

/* Components */
import TimeAlertModal from "./components/TimeAlertModal";

/* Supabase */
import { supabase } from "./utils/supabaseClient";

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
  time_ended: string;
};

const getRole = (): string => (localStorage.getItem("role") || "").toLowerCase();

type RoleAllow = "staff" | "admin" | "any" | "guest";

type GuardedRouteProps = {
  exact?: boolean;
  path: string;
  component: React.ComponentType<RouteComponentProps>;
  allow: RoleAllow[];
  role: string;
};

/** ✅ NO any, strict TS safe */
const GuardedRoute: React.FC<GuardedRouteProps> = ({
  component: Component,
  allow,
  role,
  ...rest
}) => {
  const isGuest = !role;

  const ok =
    allow.includes("any") ||
    (allow.includes("guest") && isGuest) ||
    (allow.includes("staff") && role === "staff") ||
    (allow.includes("admin") && role === "admin");

  return (
    <Route
      {...rest}
      render={(props: RouteComponentProps) =>
        ok ? <Component {...props} /> : <Redirect to={role ? "/home" : "/login"} />
      }
    />
  );
};

const App: React.FC = () => {
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");

  const [role, setRole] = useState<string>(getRole());
  const isStaff = useMemo(() => role === "staff", [role]);

  /* avoid duplicate alerts */
  const triggeredRef = useRef<Set<string>>(new Set());

  // keep role updated if login changes localStorage role
  useEffect(() => {
    const id = window.setInterval(() => setRole(getRole()), 700);
    return () => window.clearInterval(id);
  }, []);

  /* ⏰ SESSION CHECKER (STAFF ONLY) */
  useEffect(() => {
    if (!isStaff) {
      setShowAlert(false);
      triggeredRef.current.clear();
      return;
    }

    const intervalId = window.setInterval(async () => {
      const now = new Date();

      const { data, error } = await supabase
        .from("customer_sessions")
        .select("id, full_name, seat_number, time_ended")
        .gt("time_ended", now.toISOString());

      if (error || !data) return;

      const sessions = data as CustomerSessionRow[];

      sessions.forEach((session) => {
        const end = new Date(session.time_ended);
        const diffSec = Math.floor((end.getTime() - now.getTime()) / 1000);

        // trigger within a 30s window so we don't miss
        const matchMinute = ALERT_MINUTES.find((m) => {
          const target = m * 60;
          return diffSec >= target && diffSec < target + 30;
        });

        if (matchMinute === undefined) return;

        const key = `${session.id}-${matchMinute}`;
        if (triggeredRef.current.has(key)) return;
        triggeredRef.current.add(key);

        const seatText = Array.isArray(session.seat_number)
          ? session.seat_number.join(", ")
          : session.seat_number ?? "";

        setAlertMessage(`
          <h2>⏰ ${matchMinute} MINUTE(S) LEFT</h2>
          <p>
            <strong>Customer:</strong> ${session.full_name}<br/>
            <strong>Seat:</strong> ${seatText}
          </p>
        `);
        setShowAlert(true);
      });
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [isStaff]);

  return (
    <IonApp>
      {/* 🔔 ALERT MODAL (STAFF ONLY) */}
      <TimeAlertModal
        isOpen={showAlert}
        message={alertMessage}
        onClose={() => setShowAlert(false)}
        role={role}
      />

      <IonReactRouter>
        <IonRouterOutlet>
          {/* public */}
          <Route exact path="/login" component={Login} />
          <Route exact path="/book-add" component={Book_Add} />
          <Route exact path="/home" component={Home} />

          {/* staff */}
          <GuardedRoute exact path="/staff-menu" component={Staff_menu} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-dashboard" component={Staff_Dashboard} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-sales-report" component={StaffSalesReport} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-product-items" component={Product_Item_Lists} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-customer-reservations" component={Customer_Reservations} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-customer-lists" component={Customer_Lists} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-customer-discounts" component={Customer_Discount_List} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-customer-calendar" component={Customer_Calendar} allow={["staff"]} role={role} />
          <GuardedRoute exact path="/staff-customer-addons" component={Customer_Add_ons} allow={["staff"]} role={role} />

          {/* admin */}
          <GuardedRoute exact path="/admin-menu" component={Admin_menu} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-dashboard" component={Admin_Dashboard} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-seat-table" component={Admin_Seat_Table} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-packages" component={Admin_Packages} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-item-lists" component={Admin_Item_Lists} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-addons" component={Admin_Add_Ons} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-customer-addons" component={Admin_Customer_Add_ons} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-customer-discounts" component={Admin_Customer_Discount_List} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-customer-list" component={Admin_customer_list} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-customer-reservations" component={Admin_customer_reservation} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-restock-record" component={Admin_Restock_Record} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-sales-report" component={AdminSalesReport} allow={["admin"]} role={role} />
          <GuardedRoute exact path="/admin-expenses-expired" component={Admin_Staff_Expenses_Expired} allow={["admin"]} role={role} />

          {/* default */}
          <Route exact path="/">
            <Redirect to="/book-add" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
