import React, { useEffect, useRef, useState } from "react";
import { IonApp, IonRouterOutlet, setupIonicReact } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Route, Redirect } from "react-router-dom";

/* Pages */
import Login from "./pages/Login";
import Home from "./pages/Home";
import Staff_menu from "./staff/Staff_menu";
import Admin_menu from "./admin/Admin_menu";

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
const ALERT_MINUTES = [5, 3, 1];

const App: React.FC = () => {
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");

  /* 🧠 Track fired alerts (avoid repeat) */
  const triggeredRef = useRef<Set<string>>(new Set());

  /* 🔓 UNLOCK AUDIO (browser restriction fix) */
  useEffect(() => {
    const unlock = () => {
      const audio = new Audio("/assets/alarm.mp3");
      audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {});
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
  }, []);

  /* ⏰ GLOBAL SESSION CHECKER */
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = new Date();

      const { data, error } = await supabase
        .from("customer_sessions")
        .select("id, full_name, seat_number, time_ended")
        .gt("time_ended", now.toISOString());

      if (error || !data) return;

      data.forEach((session) => {
        const end = new Date(session.time_ended);
        const diffMinutes = Math.floor(
          (end.getTime() - now.getTime()) / 60000
        );

        if (!ALERT_MINUTES.includes(diffMinutes)) return;

        const key = `${session.id}-${diffMinutes}`;
        if (triggeredRef.current.has(key)) return;

        triggeredRef.current.add(key);

        /* ✅ HTML MESSAGE (for modal rendering) */
        setAlertMessage(`
          <h2>⏰ ${diffMinutes} MINUTE(S) LEFT</h2>
          <p>
            <strong>Customer:</strong> ${session.full_name}<br/>
            <strong>Seat:</strong> ${session.seat_number}
          </p>
        `);

        setShowAlert(true);
      });
    }, 30000); // every 30 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <IonApp>
      {/* 🔔 GLOBAL ALERT MODAL */}
      <TimeAlertModal
        isOpen={showAlert}
        message={alertMessage}
        onClose={() => setShowAlert(false)}
      />

      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/login" component={Login} />
          <Route exact path="/staff-menu" component={Staff_menu} />
          <Route exact path="/admin-menu" component={Admin_menu} />
          <Route exact path="/home" component={Home} />

          <Route exact path="/">
            <Redirect to="/login" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
