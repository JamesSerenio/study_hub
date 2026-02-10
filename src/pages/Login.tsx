// src/pages/Login.tsx
import React, { useState } from "react";
import { useHistory } from "react-router-dom";
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonItem,
  IonIcon,
  IonToast,
} from "@ionic/react";
import { mailOutline, lockClosedOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

import studyHubLogo from "../assets/study_hub.png";
import leaves from "../assets/leave.png";

type ProfileRow = {
  role: string;
};

const Login: React.FC = () => {
  const [emailFocused, setEmailFocused] = useState<boolean>(false);
  const [passwordFocused, setPasswordFocused] = useState<boolean>(false);

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [toastMsg, setToastMsg] = useState<string>("");
  const [showToast, setShowToast] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const history = useHistory();

  const isValidEmail = (v: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const showError = (msg: string): void => {
    setToastMsg(msg);
    setShowToast(true);
  };

  const handleLogin = async (): Promise<void> => {
    if (isLoading) return;

    const emailClean = email.trim().toLowerCase();
    const passwordClean = password;

    if (!isValidEmail(emailClean)) {
      showError("Invalid email format.");
      return;
    }

    if (!passwordClean) {
      showError("Password is required.");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailClean,
        password: passwordClean,
      });

      if (error) {
        showError(error.message);
        return;
      }

      if (!data.session || !data.user) {
        showError("Login failed. No session returned.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle<ProfileRow>();

      if (profileError) {
        showError(profileError.message);
        return;
      }

      const role = (profile?.role || "").toLowerCase();

      // ✅ IMPORTANT: store role so App.tsx can detect staff and run alerts
      localStorage.setItem("role", role);

      // ✅ optional (helpful for debugging / future use)
      localStorage.setItem("user_id", data.user.id);
      localStorage.setItem("email", emailClean);

      setToastMsg("Login successful!");
      setShowToast(true);

      if (role === "staff") history.replace("/staff-menu");
      else if (role === "admin") history.replace("/admin-menu");
      else history.replace("/home");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen className="login-content" scrollY={false}>
        {/* Leaves */}
        <div className="leaf leaf-top-left">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-top-right">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-bottom-left">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-bottom-right">
          <img src={leaves} className="leaf-img" alt="" />
        </div>

        <div className="login-wrapper">
          <div className="login-box">
            <div className="login-header">
              <img src={studyHubLogo} alt="Study Hub Logo" className="login-logo" />
              <h2>Login</h2>
            </div>

            <IonItem
              lines="none"
              className={`input-item ${emailFocused ? "item-has-focus" : ""}`}
            >
              <IonIcon icon={mailOutline} className="input-icon" />
              <IonInput
                type="email"
                inputMode="email"
                autocomplete="email"
                placeholder="Enter email"
                value={email}
                onIonChange={(e) => setEmail(e.detail.value ?? "")}
                onIonFocus={() => setEmailFocused(true)}
                onIonBlur={() => setEmailFocused(false)}
              />
            </IonItem>

            <IonItem
              lines="none"
              className={`input-item ${passwordFocused ? "item-has-focus" : ""}`}
            >
              <IonIcon icon={lockClosedOutline} className="input-icon" />
              <IonInput
                type="password"
                autocomplete="current-password"
                placeholder="Enter password"
                value={password}
                onIonChange={(e) => setPassword(e.detail.value ?? "")}
                onIonFocus={() => setPasswordFocused(true)}
                onIonBlur={() => setPasswordFocused(false)}
              />
            </IonItem>

            <IonButton
              expand="block"
              className="login-btn"
              disabled={isLoading}
              onClick={() => void handleLogin()}
            >
              {isLoading ? "Logging in..." : "Login"}
            </IonButton>
          </div>
        </div>

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMsg}
          duration={2000}
          color={toastMsg === "Login successful!" ? "success" : "danger"}
        />
      </IonContent>
    </IonPage>
  );
};

export default Login;
