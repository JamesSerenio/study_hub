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
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);

  const history = useHistory(); // For navigation

  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setToastMsg(error.message);
      setShowToast(true);
    } else if (data.user) {
      // Fetch the user's role from "profiles" table
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

      // Redirect based on role
      if (profile.role === "staff") {
        history.push("/staff-menu");
      } else if (profile.role === "admin") {
        history.push("/admin-menu");
      } else {
        history.push("/home");
      }
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen className="login-content" scrollY={false}>
        <img src={leaves} className="leaf leaf-top-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-top-right" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-right" alt="leaf" />

        <div className="login-wrapper">
          <div className="login-box">
            <div className="login-header">
              <img src={studyHubLogo} alt="Study Hub Logo" className="login-logo" />
              <h2>Login</h2>
            </div>

            <IonItem lines="none" className={`input-item ${emailFocused ? "item-has-focus" : ""}`}>
              <IonIcon icon={mailOutline} className="input-icon" />
              <IonInput
                type="email"
                placeholder="Enter email"
                value={email}
                onIonChange={(e) => setEmail(e.detail.value!)}
                onIonFocus={() => setEmailFocused(true)}
                onIonBlur={() => setEmailFocused(false)}
              />
            </IonItem>

            <IonItem lines="none" className={`input-item ${passwordFocused ? "item-has-focus" : ""}`}>
              <IonIcon icon={lockClosedOutline} className="input-icon" />
              <IonInput
                type="password"
                placeholder="Enter password"
                value={password}
                onIonChange={(e) => setPassword(e.detail.value!)}
                onIonFocus={() => setPasswordFocused(true)}
                onIonBlur={() => setPasswordFocused(false)}
              />
            </IonItem>

            <IonButton expand="block" className="login-btn" onClick={handleLogin}>
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