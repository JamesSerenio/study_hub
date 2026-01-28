import { useState } from "react";
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

const Login: React.FC = () => {
  const [emailFocused, setEmailFocused] = useState<boolean>(false);
  const [passwordFocused, setPasswordFocused] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [toastMsg, setToastMsg] = useState<string>("");
  const [showToast, setShowToast] = useState<boolean>(false);

  const history = useHistory();

  const handleLogin = async (): Promise<void> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setToastMsg(error.message);
      setShowToast(true);
      return;
    }

    if (!data.user) return;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      setToastMsg(profileError.message);
      setShowToast(true);
      return;
    }

    setToastMsg("Login successful!");
    setShowToast(true);

    if (profile.role === "staff") history.push("/staff-menu");
    else if (profile.role === "admin") history.push("/admin-menu");
    else history.push("/home");
  };

  return (
    <IonPage>
      <IonContent fullscreen className="login-content" scrollY={false}>
        {/* ✅ Leaves wrapper (angle) + inner img (float animation) */}
        <div className="leaf leaf-top-left"><img src={leaves} className="leaf-img" /></div>
        <div className="leaf leaf-top-right"><img src={leaves} className="leaf-img" /></div>
        <div className="leaf leaf-bottom-left"><img src={leaves} className="leaf-img" /></div>
        <div className="leaf leaf-bottom-right"><img src={leaves} className="leaf-img" /></div>
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
                placeholder="Enter password"
                value={password}
                onIonChange={(e) => setPassword(e.detail.value ?? "")}
                onIonFocus={() => setPasswordFocused(true)}
                onIonBlur={() => setPasswordFocused(false)}
              />
            </IonItem>

            <IonButton expand="block" className="login-btn" onClick={() => void handleLogin()}>
              Login
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
