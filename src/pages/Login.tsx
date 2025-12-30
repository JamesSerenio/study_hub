import { useState } from "react";
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonItem,
  IonIcon,
} from "@ionic/react";
import { mailOutline, lockClosedOutline } from "ionicons/icons";

import studyHubLogo from "../assets/study_hub.png";
import leaves from "../assets/leave.png";

const Login: React.FC = () => {
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  return (
    <IonPage>
      <IonContent fullscreen className="login-content">

        {/* CORNER LEAVES */}
        <img src={leaves} className="leaf leaf-top-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-top-right" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-right" alt="leaf" />

        <div className="login-wrapper">
          <div className="login-box">

            {/* TITLE + LOGO */}
            <div className="login-header">
              <img
                src={studyHubLogo}
                alt="Study Hub Logo"
                className="login-logo"
              />
              <h2>Login</h2>
            </div>

            {/* EMAIL */}
            <IonItem
              lines="none"
              className={`input-item ${emailFocused ? "item-has-focus" : ""}`}
            >
              <IonIcon icon={mailOutline} className="input-icon" />
              <IonInput
                type="email"
                placeholder="Enter email"
                onIonFocus={() => setEmailFocused(true)}
                onIonBlur={() => setEmailFocused(false)}
              />
            </IonItem>

            {/* PASSWORD */}
            <IonItem
              lines="none"
              className={`input-item ${passwordFocused ? "item-has-focus" : ""}`}
            >
              <IonIcon icon={lockClosedOutline} className="input-icon" />
              <IonInput
                type="password"
                placeholder="Enter password"
                onIonFocus={() => setPasswordFocused(true)}
                onIonBlur={() => setPasswordFocused(false)}
              />
            </IonItem>

            <IonButton expand="block" className="login-btn">
              Login
            </IonButton>

          </div>
        </div>

      </IonContent>
    </IonPage>
  );
};

export default Login;
